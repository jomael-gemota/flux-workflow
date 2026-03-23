export interface ApiErrorResponse {
    statusCode: number;
    error: string;
    message: string;
    requestId: string;
    timestamp: string;
    details?: unknown;
}

export class ApiError extends Error {
    constructor(
        public statusCode: number,
        public error: string,
        message: string,
        public details?: unknown
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export const NotFoundError = (resource: string) =>
    new ApiError(404, 'Not Found', `${resource} not found`);

export const BadRequestError = (message: string, details?: unknown) =>
    new ApiError(400, 'Bad Request', message, details);

export const UnauthorizedError = () =>
    new ApiError(401, 'Unauthorized', 'Missing API key. Provide it via x-api-key header.');

export const ForbiddenError = () =>
    new ApiError(403, 'Forbidden', 'Invalid API key.');