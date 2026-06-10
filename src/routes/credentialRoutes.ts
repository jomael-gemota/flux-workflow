import { FastifyInstance, FastifyRequest } from 'fastify';
import { apiKeyAuth } from '../middleware/auth';
import { CredentialRepository } from '../repositories/CredentialRepository';
import { CredentialNotificationService } from '../services/CredentialNotificationService';
import { NotFoundError } from '../errors/ApiError';

function getRequestUserId(request: FastifyRequest): string | undefined {
    return (request as any).user?.sub ?? undefined;
}

export async function credentialRoutes(
    fastify: FastifyInstance,
    options: { credentialRepo: CredentialRepository; credentialNotifier: CredentialNotificationService }
): Promise<void> {
    const { credentialRepo, credentialNotifier } = options;

    /** List credentials belonging to the requesting user (JWT) or all (API key) */
    fastify.get('/credentials', { preHandler: apiKeyAuth }, async (request, reply) => {
        const userId = getRequestUserId(request);
        const list = await credentialRepo.findAll(userId);
        return reply.code(200).send(list);
    });

    /** Delete (disconnect) a credential — scoped to the requesting user */
    fastify.delete<{ Params: { id: string } }>(
        '/credentials/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);

            // Capture the credential details before deletion so the owner can be
            // emailed a disconnect notification. Owner-scoped: a JWT user may only
            // see/delete their own credential.
            const cred = await credentialRepo.findById(request.params.id);
            if (!cred || (userId && cred.userId !== userId)) {
                throw NotFoundError(`Credential ${request.params.id}`);
            }

            const deleted = await credentialRepo.deleteById(request.params.id, userId);
            if (!deleted) throw NotFoundError(`Credential ${request.params.id}`);

            credentialNotifier
                .notify({
                    event:        'disconnected',
                    provider:     cred.provider,
                    label:        cred.label,
                    accountEmail: cred.email,
                    ownerUserId:  cred.userId,
                })
                .catch((e) => fastify.log.error(e, 'Credential disconnect notification failed'));

            return reply.code(200).send({ deleted: true, id: request.params.id });
        }
    );
}
