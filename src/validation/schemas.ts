import { z } from 'zod';

export const WorkflowNodeSchema = z.object({
    id: z.string().min(1),
    type: z.enum(['trigger', 'llm', 'http', 'condition', 'switch', 'transform', 'output', 'gmail', 'gdrive', 'gdocs', 'gsheets', 'slack', 'teams', 'basecamp']),
    name: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    next: z.array(z.string()),
    retries: z.number().int().min(0).max(5).optional(),
    retryDelayMs: z.number().int().min(0).optional(),
    timeoutMs: z.number().int().min(100).optional(),
    disabled: z.boolean().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
});

const ViewportSchema = z.object({
    x: z.number(),
    y: z.number(),
    zoom: z.number().positive(),
});

export const WorkflowDefinitionSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
    entryNodeId: z.string().min(1),
    entryNodeIds: z.array(z.string().min(1)).min(1).optional(),
    nodes: z.array(WorkflowNodeSchema).min(1, 'Workflow must have at least one node'),
    schedule: z.string().optional(),
    viewport: ViewportSchema.optional(),
});

export const TriggerWorkflowSchema = z.object({
    workflowId: z.string().min(1, 'workflowId is required'),
    input: z.record(z.string(), z.unknown()).optional().default({}),
});

export const WebhookPayloadSchema = z.object({
    event: z.string().min(1, 'event is required'),
    data: z.record(z.string(), z.unknown()),
    timestamp: z.string().datetime('timestamp must be a valid ISO 8601 date'),
});

export const PaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export const CreateWorkflowSchema = WorkflowDefinitionSchema.extend({
    id: z.string().min(1).optional(),
});

export const UpdateWorkflowSchema = z.object({
    name: z.string().min(1).optional(),
    nodes: z.array(WorkflowNodeSchema).min(1).optional(),
    entryNodeId: z.string().min(1).optional(),
    // min(1) removed: a single-entry workflow sends a one-item array
    entryNodeIds: z.array(z.string().min(1)).optional(),
    viewport: ViewportSchema.optional(),
});

export const CursorPaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    cursor: z.string().optional(),
});

export const ExecutionQuerySchema = z.object({
    workflowId: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    cursor: z.string().optional(),
});

export const NodeTestSchema = z.object({
    context: z.record(z.string(), z.unknown()).optional(),
});

export const DeleteExecutionsSchema = z.object({
    ids:        z.array(z.string().min(1)).min(1).optional(),
    workflowId: z.string().min(1).optional(),
    deleteAll:  z.boolean().optional(),
});

export type TriggerWorkflowInput = z.infer<typeof TriggerWorkflowSchema>;
export type WebhookPayloadInput = z.infer<typeof WebhookPayloadSchema>;
export type WorkflowDefinitionInput = z.infer<typeof WorkflowDefinitionSchema>;
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof UpdateWorkflowSchema>;
export type CursorPaginationInput = z.infer<typeof CursorPaginationSchema>;