import { FastifyRequest, FastifyReply } from "fastify";
import crypto from 'crypto';
import { WorkflowRepository } from "../repositories/WorkflowRepository";
import { BadRequestError, UnauthorizedError } from "../errors/ApiError";

export function createHmacVerifier(workflowRepo: WorkflowRepository) {
    return async function verifyHmacSignature(
        request: FastifyRequest<{ Params: { workflowId: string } }>,
        _reply: FastifyReply
    ): Promise<void> {
        const { workflowId } = request.params;
        const signature = request.headers['x-webhook-signature'];

        if (!signature || typeof signature !== 'string') {
            throw UnauthorizedError();
        }

        const secret = workflowRepo.findWebhookSecret(workflowId);
        if (!secret) throw UnauthorizedError();

        const rawBody = JSON.stringify(request.body);
        const expected = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');

        const expectedBuffer = Buffer.from(`sha256=${expected}`);
        const receivedBuffer = Buffer.from(signature);

        if (
            expectedBuffer.length !== receivedBuffer.length ||
            !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
        ) {
            throw new (await import('../errors/ApiError')).ApiError(
                403,
                'Forbidden',
                'Invalid webhook signature.'
            );
        }
    };
}