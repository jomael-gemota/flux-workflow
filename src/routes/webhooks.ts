import { FastifyInstance } from 'fastify';
import { WorkflowService } from '../services/WorkflowService';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { WebhookPayloadSchema } from '../validation/schemas';
import { toJsonSchema } from '../validation/toJsonSchema';
import { NotFoundError } from '../errors/ApiError';
import { createHmacVerifier } from '../middleware/hmac';

export async function webhookRoutes(
    fastify: FastifyInstance,
    options: { workflowService: WorkflowService; workflowRepo: WorkflowRepository }
): Promise<void> {
    const { workflowService, workflowRepo } = options;
    const verifyHmac = createHmacVerifier(workflowRepo);

    fastify.post<{ Params: { workflowId: string } }>(
        '/webhooks/:workflowId',
        {
            preHandler: verifyHmac,
            schema: { body: toJsonSchema(WebhookPayloadSchema) },
        },
        async (request, reply) => {
            const body = WebhookPayloadSchema.parse(request.body);
            const { workflowId } = request.params;

            try {
                const summary = await workflowService.trigger(workflowId, {
                    event: body.event,
                    data: body.data,
                    receivedAt: new Date().toISOString(),
                });

                return reply.code(200).send({
                    received: true,
                    executionId: summary.executionId,
                    status: summary.status,
                });
            } catch {
                throw NotFoundError(`Workflow ${workflowId}`);
            }
        }
    );
}