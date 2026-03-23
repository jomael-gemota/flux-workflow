import { FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/database';
import { UnauthorizedError, ForbiddenError } from '../errors/ApiError';

interface ApiKeyRow {
    id: string;
    key: string;
    name: string;
}

export async function apiKeyAuth(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
        throw UnauthorizedError();
    }

    const db = getDatabase();
    const row = db
        .prepare('SELECT * FROM api_keys WHERE key = ?')
        .get(apiKey) as ApiKeyRow | undefined;

    if (!row) {
        throw ForbiddenError();
    }

    (request as any).apiKey = row;
}