import { Schema, model, Document } from 'mongoose';

export type ExecutionStatus = 'pending' | 'running' | 'success' | 'failure' | 'partial';

export interface ExecutionLogEntry {
    nodeId: string;
    status: 'success' | 'failure' | 'skipped';
    output: unknown;
    /** Node config with all {{}} expressions resolved at execution time */
    resolvedInput?: unknown;
    error?: string;
    durationMs: number;
    executedAt: Date;
}

export interface ExecutionDocument extends Document {
    executionId: string;
    workflowId: string;
    workflowVersion: number;
    status: ExecutionStatus;
    input: unknown;
    results: unknown[];
    logs: ExecutionLogEntry[];
    startedAt: Date;
    completedAt?: Date;
    triggeredBy: 'api' | 'webhook' | 'replay' | 'manual' | 'node-test' | 'step-run';
    testNodeId?: string;
}

const ExecutionLogSchema = new Schema<ExecutionLogEntry>(
    {
        nodeId: { type: String, required: true },
        status: { type: String, enum: ['success', 'failure', 'skipped'], required: true },
        output: { type: Schema.Types.Mixed },
        resolvedInput: { type: Schema.Types.Mixed },
        error: { type: String },
        durationMs: { type: Number, required: true },
        executedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const ExecutionSchema = new Schema<ExecutionDocument>(
    {
        executionId: { type: String, required: true, unique: true, index: true },
        workflowId: { type: String, required: true, index: true },
        workflowVersion: { type: Number, required: true },
        status: {
            type: String,
            enum: ['pending', 'running', 'success', 'failure', 'partial'],
            default: 'pending',
        },
        input: { type: Schema.Types.Mixed },
        results: [{ type: Schema.Types.Mixed }],
        logs: [ExecutionLogSchema],
        startedAt: { type: Date, required: true },
        completedAt: { type: Date },
        triggeredBy: {
            type: String,
            enum: ['api', 'webhook', 'replay', 'manual', 'schedule', 'node-test', 'step-run'],
            default: 'api',
        },
        testNodeId: { type: String },
    },
    { timestamps: true }
);

ExecutionSchema.index({ workflowId: 1, startedAt: -1 });

export const ExecutionModel = model<ExecutionDocument>('Execution', ExecutionSchema);