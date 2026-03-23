import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../middleware/auth';
import { WorkflowService } from '../services/WorkflowService';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import {
    TriggerWorkflowSchema,
    CreateWorkflowSchema,
    UpdateWorkflowSchema,
    CursorPaginationSchema,
} from '../validation/schemas';
import { toJsonSchema } from '../validation/toJsonSchema';
import { NotFoundError, BadRequestError } from '../errors/ApiError';
import crypto from 'crypto';

export async function workflowRoutes(
    fastify: FastifyInstance,
    options: { workflowService: WorkflowService; workflowRepo: WorkflowRepository }
): Promise<void> {
    const { workflowService, workflowRepo } = options;

    fastify.post(
        '/workflows',
        {
            preHandler: apiKeyAuth,
            schema: { body: toJsonSchema(CreateWorkflowSchema) },
        },
        async (request, reply) => {
            const body = CreateWorkflowSchema.parse(request.body);

            const workflow = {
                ...body,
                id: body.id ?? `wf-${crypto.randomUUID()}`,
                version: 1,
            };

            const { workflow: created, webhookSecret } = workflowRepo.create(workflow);

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
            const updated = workflowRepo.update(request.params.id, body);

            if (!updated) throw NotFoundError(`Workflow ${request.params.id}`);
            return reply.code(200).send(updated);
        }
    );

    fastify.delete<{ Params: { id: string } }>(
        '/workflows/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const deleted = workflowRepo.delete(request.params.id);
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
            const result = workflowRepo.findAll(query.limit, query.cursor ?? undefined);
            return reply.code(200).send(result);
        }
    );

    fastify.get<{ Params: { id: string } }>(
        '/workflows/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const workflow = workflowRepo.findById(request.params.id);
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
}