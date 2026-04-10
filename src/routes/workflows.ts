import { FastifyInstance, FastifyRequest } from 'fastify';
import { apiKeyAuth } from '../middleware/auth';

/** Extracts the authenticated user's MongoDB id from a JWT-authenticated request.
 *  Returns undefined for API-key authenticated requests (no user context). */
function getRequestUserId(request: FastifyRequest): string | undefined {
    return (request as any).user?.sub ?? undefined;
}
import { WorkflowService } from '../services/WorkflowService';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { ExecutionRepository } from '../repositories/ExecutionRepository';
import { NodeExecutorRegistry } from '../engine/NodeExecutorRegistry';
import { WorkflowScheduler } from '../scheduler/WorkflowScheduler';
import {
    TriggerWorkflowSchema,
    CreateWorkflowSchema,
    UpdateWorkflowSchema,
    CursorPaginationSchema,
    NodeTestSchema,
} from '../validation/schemas';
import { toJsonSchema } from '../validation/toJsonSchema';
import { NotFoundError, BadRequestError } from '../errors/ApiError';
import { ExecutionContext } from '../types/workflow.types';
import crypto from 'crypto';

export async function workflowRoutes(
    fastify: FastifyInstance,
    options: {
        workflowService: WorkflowService;
        workflowRepo: WorkflowRepository;
        executionRepo: ExecutionRepository;
        registry: NodeExecutorRegistry;
        scheduler?: WorkflowScheduler;
        onWorkflowUpdated?: (workflowId: string) => Promise<void>;
    }
): Promise<void> {
    const { workflowService, workflowRepo, executionRepo, registry, scheduler, onWorkflowUpdated } = options;

    fastify.post(
        '/workflows',
        {
            preHandler: apiKeyAuth,
            schema: { body: toJsonSchema(CreateWorkflowSchema) },
        },
        async (request, reply) => {
            const body = CreateWorkflowSchema.parse(request.body);
            const userId = getRequestUserId(request);

            const workflow = {
                ...body,
                id: body.id ?? `wf-${crypto.randomUUID()}`,
                version: 1,
            };

            const { workflow: created, webhookSecret } = await workflowRepo.create(workflow, userId);

            return reply.code(201).send({
                ...created,
                webhookSecret,
                note: 'Save your webhookSecret — it will not be shown again.',
            });
        }
    );

    fastify.put<{ Params: { id: string } }>(
        '/workflows/:id',
        {
            preHandler: apiKeyAuth,
            schema: { body: toJsonSchema(UpdateWorkflowSchema) },
        },
        async (request, reply) => {
            const body = UpdateWorkflowSchema.parse(request.body);
            const userId = getRequestUserId(request);
            const updated = await workflowRepo.update(request.params.id, body, userId);

            if (!updated) throw NotFoundError(`Workflow ${request.params.id}`);

            // Refresh scheduler/polling after workflow changes
            if (scheduler) await scheduler.refresh(request.params.id).catch(() => {});
            if (onWorkflowUpdated) await onWorkflowUpdated(request.params.id).catch(() => {});

            return reply.code(200).send(updated);
        }
    );

    fastify.delete<{ Params: { id: string } }>(
        '/workflows/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            const deleted = await workflowRepo.delete(request.params.id, userId);
            if (!deleted) throw NotFoundError(`Workflow ${request.params.id}`);
            return reply.code(200).send({ deleted: true, id: request.params.id });
        }
    );

    fastify.get(
        '/workflows',
        {
            preHandler: apiKeyAuth,
            schema: { querystring: toJsonSchema(CursorPaginationSchema) },
        },
        async (request, reply) => {
            const query = CursorPaginationSchema.parse(request.query);
            const userId = getRequestUserId(request);
            const result = await workflowRepo.findAll(query.limit, query.cursor ?? undefined, userId);
            return reply.code(200).send(result);
        }
    );

    fastify.get<{ Params: { id: string } }>(
        '/workflows/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            const workflow = await workflowRepo.findById(request.params.id, userId);
            if (!workflow) throw NotFoundError(`Workflow ${request.params.id}`);
            return reply.code(200).send(workflow);
        }
    );

    fastify.post(
        '/workflows/trigger',
        {
            preHandler: apiKeyAuth,
            schema: { body: toJsonSchema(TriggerWorkflowSchema) },
        },
        async (request, reply) => {
            const body = TriggerWorkflowSchema.parse(request.body);
            try {
                const summary = await workflowService.trigger(body.workflowId, body.input);
                return reply.code(200).send(summary);
            } catch {
                throw NotFoundError(`Workflow ${body.workflowId}`);
            }
        }
    );

    fastify.get<{ Params: { id: string } }>(
        '/workflows/:id/versions',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            const workflow = await workflowRepo.findById(request.params.id, userId);
            if (!workflow) throw NotFoundError(`Workflow ${request.params.id}`);

            const versions = await workflowRepo.findVersionHistory(request.params.id);
            return reply.code(200).send({ workflowId: request.params.id, versions });
        }
    );

    fastify.post<{ Params: { id: string }; Body: { version: number } }>(
        '/workflows/:id/restore',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const { version } = request.body as { version: number };
            if (typeof version !== 'number') throw BadRequestError('version is required');
            const userId = getRequestUserId(request);

            const restored = await workflowRepo.restoreVersion(request.params.id, version, userId);
            if (!restored) throw NotFoundError(`Workflow ${request.params.id} version ${version}`);

            if (scheduler) await scheduler.refresh(request.params.id).catch(() => {});
            if (onWorkflowUpdated) await onWorkflowUpdated(request.params.id).catch(() => {});

            return reply.code(200).send(restored);
        }
    );

    // ── Node test routes ──────────────────────────────────────────────────────

    fastify.post<{ Params: { id: string; nodeId: string } }>(
        '/workflows/:id/nodes/:nodeId/test',
        {
            preHandler: apiKeyAuth,
            schema: { body: toJsonSchema(NodeTestSchema) },
        },
        async (request, reply) => {
            const { context } = NodeTestSchema.parse(request.body);
            const userId = getRequestUserId(request);

            const workflow = await workflowRepo.findById(request.params.id, userId);
            if (!workflow) throw NotFoundError(`Workflow ${request.params.id}`);

            const node = workflow.nodes.find(n => n.id === request.params.nodeId);
            if (!node) throw NotFoundError(`Node ${request.params.nodeId} in workflow ${request.params.id}`);

            const executor = registry.get(node.type);

            // Inject persisted test results from other nodes so that expressions like
            // {{nodes.http-node-id.body}} resolve correctly when testing downstream nodes.
            const savedTestResults = await executionRepo.findAllNodeTestResults(workflow.id);
            const injectedVars: Record<string, unknown> = {};
            for (const [nid, result] of Object.entries(savedTestResults)) {
                if (nid !== node.id && result.status === 'success') {
                    injectedVars[nid] = result.output;
                }
            }

            const execContext: ExecutionContext = {
                workflowId: workflow.id,
                executionId: crypto.randomUUID(),
                variables: { ...injectedVars, ...(context ?? {}) },
                startedAt: new Date(),
            };

            const ranAt = new Date();
            const start = Date.now();

            try {
                const output = await executor.execute(node, execContext);
                const durationMs = Date.now() - start;
                const result = { nodeId: node.id, status: 'success' as const, output, durationMs, ranAt };

                await executionRepo.saveNodeTestResult(workflow.id, node.id, result);
                return reply.code(200).send(result);
            } catch (err: unknown) {
                const durationMs = Date.now() - start;
                const error = err instanceof Error ? err.message : String(err);
                const result = { nodeId: node.id, status: 'failure' as const, output: null, error, durationMs, ranAt };

                await executionRepo.saveNodeTestResult(workflow.id, node.id, result);
                return reply.code(200).send(result);
            }
        }
    );

    fastify.get<{ Params: { id: string } }>(
        '/workflows/:id/node-test-results',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            const workflow = await workflowRepo.findById(request.params.id, userId);
            if (!workflow) throw NotFoundError(`Workflow ${request.params.id}`);

            const results = await executionRepo.findAllNodeTestResults(request.params.id);
            return reply.code(200).send(results);
        }
    );
}