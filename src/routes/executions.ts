import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../middleware/auth';
import { ExecutionRepository } from '../repositories/ExecutionRepository';
import { WorkflowService } from '../services/WorkflowService';
import { ExecutionQuerySchema, DeleteExecutionsSchema } from '../validation/schemas';
import { toJsonSchema } from '../validation/toJsonSchema';
import { NotFoundError, BadRequestError } from '../errors/ApiError';

export async function executionRoutes(
    fastify: FastifyInstance,
    options: {
        executionRepo: ExecutionRepository;
        workflowService: WorkflowService;
    }
): Promise<void> {
    const { executionRepo, workflowService } = options;

    fastify.get<{ Params: { id: string } }>(
        '/executions/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const execution = await executionRepo.findById(request.params.id);
            if (!execution) throw NotFoundError(`Execution ${request.params.id}`);
            return reply.code(200).send(execution);
        }
    );

    fastify.get<{ Querystring: { workflowId: string; limit?: number; cursor?: string } }>(
        '/executions',
        {
            preHandler: apiKeyAuth,
            schema: { querystring: toJsonSchema(ExecutionQuerySchema) },
        },
        async (request, reply) => {
            const { workflowId, limit = 20, cursor } = request.query;

            const result = await executionRepo.findByWorkflowIdPaginated(
                workflowId,
                limit,
                cursor
            );
            return reply.code(200).send(result);
        }
    );

    fastify.post<{ Params: { id: string } }>(
        '/executions/:id/replay',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            try {
                const summary = await workflowService.replay(request.params.id);
                return reply.code(200).send(summary);
            } catch {
                throw NotFoundError(`Execution ${request.params.id}`);
            }
        }
    );

    // ── Delete a single execution ──────────────────────────────────────────
    fastify.delete<{ Params: { id: string } }>(
        '/executions/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const deleted = await executionRepo.deleteById(request.params.id);
            if (!deleted) throw NotFoundError(`Execution ${request.params.id}`);
            return reply.code(200).send({ deleted: true, id: request.params.id });
        }
    );

    // ── Bulk delete: by IDs or all for a workflow ──────────────────────────
    fastify.delete<{ Body: { ids?: string[]; workflowId?: string; deleteAll?: boolean } }>(
        '/executions',
        {
            preHandler: apiKeyAuth,
            schema: { body: toJsonSchema(DeleteExecutionsSchema) },
        },
        async (request, reply) => {
            const { ids, workflowId, deleteAll } = request.body ?? {};

            if (ids && ids.length > 0) {
                const count = await executionRepo.deleteManyByIds(ids);
                return reply.code(200).send({ deleted: count });
            }

            if (workflowId && deleteAll === true) {
                const count = await executionRepo.deleteAllByWorkflowId(workflowId);
                return reply.code(200).send({ deleted: count });
            }

            throw BadRequestError('Provide either "ids" array or "workflowId" + "deleteAll": true');
        }
    );
}