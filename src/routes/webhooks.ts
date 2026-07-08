import { FastifyInstance } from 'fastify';
import { WorkflowService } from '../services/WorkflowService';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { WebhookPayloadSchema } from '../validation/schemas';
import { toJsonSchema } from '../validation/toJsonSchema';
import { NotFoundError } from '../errors/ApiError';
import { createHmacVerifier } from '../middleware/hmac';
import { webhookCaptureRegistry } from '../services/WebhookCaptureRegistry';
import { executionEventBus } from '../events/ExecutionEventBus';

export async function webhookRoutes(
    fastify: FastifyInstance,
    options: { workflowService: WorkflowService; workflowRepo: WorkflowRepository }
): Promise<void> {
    const { workflowService, workflowRepo } = options;
    const verifyHmac = createHmacVerifier(workflowRepo);

    // Legacy HMAC-signed webhook (backward compatible)
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
                }, 'webhook');

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

    // Trigger-node-specific webhook: routes to a specific trigger node
    fastify.all<{ Params: { workflowId: string; nodeId: string } }>(
        '/webhooks/:workflowId/trigger/:nodeId',
        async (request, reply) => {
            const { workflowId, nodeId } = request.params;

            const workflow = await workflowRepo.findById(workflowId);
            if (!workflow) throw NotFoundError(`Workflow ${workflowId}`);

            const triggerNode = workflow.nodes.find(
                (n: { id: string; type: string }) => n.id === nodeId && n.type === 'trigger'
            );
            if (!triggerNode) throw NotFoundError(`Trigger node ${nodeId} in workflow ${workflowId}`);

            const payload = {
                method: request.method,
                headers: request.headers as Record<string, unknown>,
                query: request.query as Record<string, unknown>,
                body: (request.body ?? {}) as Record<string, unknown>,
                receivedAt: new Date().toISOString(),
            };

            // If a "listen for webhook" capture session is armed for this node,
            // capture the payload (buffer + push over the SSE bus) and return 200
            // WITHOUT executing the workflow, to avoid firing downstream side
            // effects during a test. Only the first hit is captured; the SSE
            // handler clears the session so subsequent hits execute normally.
            if (webhookCaptureRegistry.markCaptured(workflowId, nodeId, payload)) {
                executionEventBus.emitWebhookCaptured(workflowId, nodeId, payload);
                return reply.code(200).send({ received: true, captured: true });
            }

            try {
                const summary = await workflowService.trigger(
                    workflowId, payload, 'webhook', nodeId,
                );
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