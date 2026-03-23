import { z } from 'zod';

export function toJsonSchema(schema: z.ZodTypeAny): object {
    return z.toJSONSchema(schema, {
        target: 'draft-07',
    });
}