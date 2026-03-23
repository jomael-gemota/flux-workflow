import { FastifyInstance, FastifyError } from 'fastify';
import { ApiError, ApiErrorResponse } from './ApiError';

interface FastifyValidationError {
    validation: unknown[],
    statusCode?: number,
    message: string,
    name: string,
}

interface FastifyHttpError {
    statusCode: number;
    message: string;
    name: string; 
}

function isValidationError(error: unknown): error is FastifyValidationError {
    return (
        typeof error === 'object' &&
        error !== null &&
        'validation' in error &&
        Array.isArray((error as FastifyValidationError).validation)
    );
}

function isHttpError(error: unknown): error is FastifyHttpError {
    return (
        typeof error == 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof (error as FastifyHttpError).statusCode === 'number'
    );
}

export function registerErrorHandler(fastify: FastifyInstance): void {
    fastify.setErrorHandler((error, request, reply) => {
        const requestId = request.id as string;
        const timestamp = new Date().toISOString();

        if (error instanceof ApiError) {
            const response: ApiErrorResponse = {
                statusCode: error.statusCode,
                error: error.error,
                message: error.message,
                requestId,
                timestamp,
                details: error.details,
            };
            return reply.code(error.statusCode).send(response);
        }

        if (isValidationError(error)) {
            const response: ApiErrorResponse = {
                statusCode: 400,
                error: 'Validation Error',
                message: 'Request validation failed',
                requestId,
                timestamp,
                details: error.validation,
            };
            return reply.code(400).send(response);
        }

        if (isHttpError(error)) {
            const response: ApiErrorResponse = {
                statusCode: (error as FastifyError).statusCode!,
                error: error.name,
                message: error.message,
                requestId,
                timestamp,
            };
            return reply.code((error as FastifyError).statusCode!).send(response);
        }

        fastify.log.error({ requestId, err: error }, 'Unhandled error');

        const response: ApiErrorResponse = {
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'An unexpected error occurred',
            requestId,
            timestamp,
        };
        return reply.code(500).send(response);
    });
}