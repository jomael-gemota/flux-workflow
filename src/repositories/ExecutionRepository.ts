import crypto from 'crypto';
import { ExecutionModel, ExecutionStatus } from '../db/models/ExecutionModel';
import { ExecutionSummary, PaginatedResponse } from '../types/api.types';
import { NodeResult } from '../types/workflow.types';

export interface NodeTestResult {
    nodeId: string;
    status: 'success' | 'failure';
    output: unknown;
    error?: string;
    durationMs: number;
    ranAt: Date;
}

export class ExecutionRepository {

    async createPending(
        executionId: string,
        workflowId: string,
        workflowVersion: number,
        input: unknown,
        triggeredBy: 'api' | 'webhook' | 'replay' | 'manual' = 'api'
    ): Promise<void> {
        await ExecutionModel.create({
            executionId,
            workflowId,
            workflowVersion,
            status: 'pending',
            input,
            results: [],
            logs: [],
            startedAt: new Date(),
            triggeredBy,
        });
    }

    async markRunning(executionId: string): Promise<void> {
        await ExecutionModel.updateOne(
            { executionId },
            { $set: { status: 'running' } }
        );
    }

    async complete(
        executionId: string,
        status: ExecutionStatus,
        results: NodeResult[]
    ): Promise<void> {
        const logs = results.map(r => ({
            nodeId: r.nodeId,
            status: r.status,
            output: r.output,
            error: r.error,
            durationMs: r.durationMs,
            executedAt: new Date(),
        }));

        await ExecutionModel.updateOne(
            { executionId },
            {
                $set: {
                status,
                results,
                logs,
                completedAt: new Date(),
                },
            }
        );
    }

    async findById(id: string): Promise<ExecutionSummary | null> {
        const doc = await ExecutionModel.findOne({ executionId: id });
        if (!doc) return null;
        return this.docToSummary(doc);
    }

    async findInput(executionId: string): Promise<unknown | null> {
        const doc = await ExecutionModel
            .findOne({ executionId })
            .select('input workflowId workflowVersion');
        if (!doc) return null;
        return { input: doc.input, workflowId: doc.workflowId };
    }

    async findByWorkflowIdPaginated(
        workflowId: string,
        limit: number,
        cursor?: string
    ): Promise<PaginatedResponse<ExecutionSummary>> {
        const query = cursor
            ? { workflowId, startedAt: { $lt: new Date(cursor) } }
            : { workflowId };

        const docs = await ExecutionModel
            .find(query)
            .sort({ startedAt: -1 })
            .limit(limit + 1);

        const hasMore = docs.length > limit;
        const data = docs.slice(0, limit).map(this.docToSummary);
        const nextCursor = hasMore
            ? docs[limit - 1].startedAt.toISOString()
            : null;

        return { data, pagination: { hasMore, nextCursor, limit } };
    }

    async saveNodeTestResult(
        workflowId: string,
        nodeId: string,
        result: NodeTestResult
    ): Promise<void> {
        // Upsert: keep only the most recent test result per (workflowId, nodeId) pair
        await ExecutionModel.findOneAndUpdate(
            { workflowId, testNodeId: nodeId, triggeredBy: 'node-test' },
            {
                $set: {
                    executionId: crypto.randomUUID(),
                    workflowId,
                    workflowVersion: 0,
                    status: result.status,
                    input: null,
                    results: [result],
                    logs: [{
                        nodeId,
                        status: result.status,
                        output: result.output,
                        error: result.error,
                        durationMs: result.durationMs,
                        executedAt: result.ranAt,
                    }],
                    startedAt: result.ranAt,
                    completedAt: result.ranAt,
                    triggeredBy: 'node-test',
                    testNodeId: nodeId,
                },
            },
            { upsert: true }
        );
    }

    async deleteById(id: string): Promise<boolean> {
        const result = await ExecutionModel.deleteOne({ executionId: id });
        return result.deletedCount > 0;
    }

    async deleteManyByIds(ids: string[]): Promise<number> {
        const result = await ExecutionModel.deleteMany({ executionId: { $in: ids } });
        return result.deletedCount;
    }

    async deleteAllByWorkflowId(workflowId: string): Promise<number> {
        const result = await ExecutionModel.deleteMany({ workflowId });
        return result.deletedCount;
    }

    async findAllNodeTestResults(
        workflowId: string
    ): Promise<Record<string, NodeTestResult>> {
        const docs = await ExecutionModel.find({
            workflowId,
            triggeredBy: 'node-test',
        }).sort({ startedAt: -1 });

        const map: Record<string, NodeTestResult> = {};
        for (const doc of docs) {
            if (!doc.testNodeId || map[doc.testNodeId]) continue;
            const r = (doc.results as NodeTestResult[])[0];
            if (r) map[doc.testNodeId] = r;
        }
        return map;
    }

    private docToSummary(doc: InstanceType<typeof ExecutionModel>): ExecutionSummary {
        return {
            executionId: doc.executionId,
            workflowId: doc.workflowId,
            status: doc.status as ExecutionSummary['status'],
            results: doc.results,
            startedAt: doc.startedAt,
            completedAt: doc.completedAt ?? new Date(),
        };
    }
}