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
import { TriggerTestService } from '../services/TriggerTestService';
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
import { buildVarsMap } from '../engine/ExpressionResolver';
import { webhookCaptureRegistry } from '../services/WebhookCaptureRegistry';
import { executionEventBus } from '../events/ExecutionEventBus';
import { ApiKeyModel } from '../db/models/ApiKeyModel';
import crypto from 'crypto';

const WEBHOOK_CAPTURE_TTL_MS = 60_000;

export async function workflowRoutes(
    fastify: FastifyInstance,
    options: {
        workflowService: WorkflowService;
        workflowRepo: WorkflowRepository;
        executionRepo: ExecutionRepository;
        registry: NodeExecutorRegistry;
        scheduler?: WorkflowScheduler;
        onWorkflowUpdated?: (workflowId: string) => Promise<void>;
        triggerTestService?: TriggerTestService;
    }
): Promise<void> {
    const { workflowService, workflowRepo, executionRepo, registry, scheduler, onWorkflowUpdated, triggerTestService } = options;

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

            // When a user clicks "Run Workflow" on an app_event trigger (e.g. new
            // spreadsheet row, Drive change) no input payload is sent from the UI.
            // In that case we fetch the most recent live sample from the source —
            // the same data the polling service would have provided — so that all
            // downstream nodes receive real field values to work with.
            let resolvedInput: Record<string, unknown> = body.input ?? {};
            if (Object.keys(resolvedInput).length === 0 && triggerTestService) {
                const wf = await workflowRepo.findById(body.workflowId);
                const triggerNode = wf?.nodes.find(n => n.type === 'trigger');
                const cfg = (triggerNode?.config ?? {}) as Record<string, unknown>;
                if (cfg.triggerType === 'app_event' && cfg.appType) {
                    resolvedInput = await triggerTestService
                        .fetchLatestSample(cfg as any)
                        .catch(() => ({}));
                }
            }

            try {
                const summary = await workflowService.trigger(
                    body.workflowId,
                    resolvedInput,
                    'manual',
                );
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

            // For trigger nodes configured as app_event, fetch a real live sample
            // from the source so the test output contains actual data fields.
            let triggerSample: Record<string, unknown> = {};
            if (node.type === 'trigger' && triggerTestService) {
                const cfg = (node.config ?? {}) as Record<string, unknown>;
                triggerSample = await triggerTestService.fetchLatestSample(cfg as any).catch(() => ({}));
            }

            // Allow the caller to supply a sample input for trigger nodes (e.g. a
            // mock webhook payload). Only applies when no live sample was fetched.
            const callerInput = context?.input as Record<string, unknown> | undefined;
            const resolvedInput: Record<string, unknown> =
                Object.keys(triggerSample).length > 0
                    ? triggerSample
                    : (callerInput && typeof callerInput === 'object' ? callerInput : triggerSample);

            const execContext: ExecutionContext = {
                workflowId: workflow.id,
                executionId: crypto.randomUUID(),
                variables: { ...injectedVars, ...(context ?? {}), input: resolvedInput },
                vars: buildVarsMap(workflow.variables),
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

    // ── Webhook "listen for real webhook" capture session ──────────────────────

    fastify.post<{ Params: { id: string; nodeId: string } }>(
        '/workflows/:id/nodes/:nodeId/webhook-capture/start',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);

            const workflow = await workflowRepo.findById(request.params.id, userId);
            if (!workflow) throw NotFoundError(`Workflow ${request.params.id}`);

            const node = workflow.nodes.find(n => n.id === request.params.nodeId);
            if (!node) throw NotFoundError(`Node ${request.params.nodeId} in workflow ${request.params.id}`);

            const cfg = (node.config ?? {}) as Record<string, unknown>;
            if (node.type !== 'trigger' || cfg.triggerType !== 'webhook') {
                throw BadRequestError(`Node ${request.params.nodeId} is not a webhook trigger`);
            }

            const captureId = crypto.randomUUID();
            const session = webhookCaptureRegistry.arm(workflow.id, node.id, captureId, WEBHOOK_CAPTURE_TTL_MS);
            return reply.code(200).send({ captureId: session.captureId, expiresAt: session.expiresAt });
        }
    );

    // SSE: stream the next captured webhook payload back to the browser.
    // EventSource cannot send custom headers, so auth is passed via query params.
    fastify.get<{
        Params: { id: string; nodeId: string; captureId: string };
        Querystring: { token?: string; apiKey?: string };
    }>(
        '/workflows/:id/nodes/:nodeId/webhook-capture/:captureId/events',
        async (request, reply) => {
            const { token, apiKey } = request.query;

            if (token) {
                try {
                    const decoded = (fastify as any).jwt.verify(token) as { status?: string };
                    if (decoded.status && decoded.status !== 'approved') {
                        return reply.code(403).send({ message: 'Account pending approval' });
                    }
                } catch {
                    return reply.code(401).send({ message: 'Invalid or expired token' });
                }
            } else if (apiKey) {
                const doc = await ApiKeyModel.findOne({ key: apiKey });
                if (!doc) return reply.code(403).send({ message: 'Invalid API key' });
            } else {
                return reply.code(401).send({ message: 'Authentication required' });
            }

            const { id: workflowId, nodeId, captureId } = request.params;

            const session = webhookCaptureRegistry.get(workflowId, nodeId);
            if (!session || session.captureId !== captureId) {
                return reply.code(404).send({ message: 'No active webhook capture session' });
            }

            // Hijack the raw response so Fastify doesn't auto-close it
            reply.hijack();
            const raw = reply.raw;

            raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            });

            const send = (event: string, data: unknown) => {
                try {
                    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                } catch { /* client already disconnected */ }
            };

            // A hit may have landed between arming and this subscription — replay
            // the buffered payload and close immediately.
            if (session.capturedPayload !== null) {
                send('captured', session.capturedPayload);
                webhookCaptureRegistry.clear(workflowId, nodeId);
                raw.end();
                return;
            }

            let closed = false;

            const cleanup = () => {
                if (closed) return;
                closed = true;
                clearInterval(heartbeat);
                clearTimeout(timeout);
                unsub();
                webhookCaptureRegistry.clear(workflowId, nodeId);
            };

            const unsub = executionEventBus.onWebhookCaptured(workflowId, nodeId, (payload) => {
                if (closed) return;
                send('captured', payload);
                cleanup();
                raw.end();
            });

            // Auto-close when the capture window elapses without a hit.
            const remaining = Math.max(1_000, session.expiresAt - Date.now());
            const timeout = setTimeout(() => {
                if (closed) return;
                send('timeout', { message: 'No webhook received within the capture window' });
                cleanup();
                raw.end();
            }, remaining);

            // Keep-alive heartbeat (prevents proxies/load-balancers from closing idle connections)
            const heartbeat = setInterval(() => {
                if (closed) return;
                try { raw.write(': heartbeat\n\n'); } catch { cleanup(); }
            }, 15_000);

            request.raw.on('close', cleanup);
            request.raw.on('error', cleanup);
        }
    );

    // ── Single-node step run (append-only, permanent in execution log) ──────────

    fastify.post<{ Params: { id: string; nodeId: string } }>(
        '/workflows/:id/nodes/:nodeId/run',
        {
            preHandler: apiKeyAuth,
            schema: { body: { type: 'object' } },
        },
        async (request, reply) => {
            const userId = getRequestUserId(request);

            const workflow = await workflowRepo.findById(request.params.id, userId);
            if (!workflow) throw NotFoundError(`Workflow ${request.params.id}`);

            const node = workflow.nodes.find(n => n.id === request.params.nodeId);
            if (!node) throw NotFoundError(`Node ${request.params.nodeId} in workflow ${request.params.id}`);

            const executor = registry.get(node.type);

            // Inject other nodes' most-recent test outputs so expressions resolve
            const savedTestResults = await executionRepo.findAllNodeTestResults(workflow.id);
            const injectedVars: Record<string, unknown> = {};
            for (const [nid, result] of Object.entries(savedTestResults)) {
                if (nid !== node.id && result.status === 'success') {
                    injectedVars[nid] = result.output;
                }
            }

            const executionId = crypto.randomUUID();
            const execContext: ExecutionContext = {
                workflowId: workflow.id,
                executionId,
                variables: { ...injectedVars },
                vars: buildVarsMap(workflow.variables),
                startedAt: new Date(),
            };

            const start = Date.now();

            try {
                const output = await executor.execute(node, execContext);
                const durationMs = Date.now() - start;
                await executionRepo.createStepRun(executionId, workflow.id, workflow.version, node.id, {
                    status: 'success',
                    output,
                    durationMs,
                });
            } catch (err: unknown) {
                const durationMs = Date.now() - start;
                const error = err instanceof Error ? err.message : String(err);
                await executionRepo.createStepRun(executionId, workflow.id, workflow.version, node.id, {
                    status: 'failure',
                    output: null,
                    error,
                    durationMs,
                });
            }

            const summary = await executionRepo.findById(executionId);
            return reply.code(200).send(summary);
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

    /**
     * GET /workflows/:id/last-run-results
     * Returns per-node outputs from the most recent successful full execution
     * (not node-test or step-run).  Same shape as /node-test-results so the
     * frontend can merge them into the variable-picker transparently.
     */
    fastify.get<{ Params: { id: string } }>(
        '/workflows/:id/last-run-results',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            const workflow = await workflowRepo.findById(request.params.id, userId);
            if (!workflow) throw NotFoundError(`Workflow ${request.params.id}`);

            const results = await executionRepo.findLastRunResults(request.params.id);
            return reply.code(200).send(results);
        }
    );
}