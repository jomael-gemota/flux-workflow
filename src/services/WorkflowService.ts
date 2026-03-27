import crypto from 'crypto';
import { WorkflowRunner } from '../engine/WorkflowRunner';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { ExecutionRepository } from '../repositories/ExecutionRepository';
import { ExecutionSummary } from '../types/api.types';
import { NodeResult } from '../types/workflow.types';
import { getWorkflowQueue } from '../queue/WorkflowQueue';

export class WorkflowService {
    constructor(
        private runner: WorkflowRunner,
        private workflowRepo: WorkflowRepository,
        private executionRepo: ExecutionRepository
    ) {}

    async trigger(
        workflowId: string,
        input: Record<string, unknown>,
        triggeredBy: 'api' | 'webhook' | 'replay' | 'manual' = 'api'
    ): Promise<ExecutionSummary> {
        const workflow = await this.workflowRepo.findById(workflowId);
        if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

        const startedAt = new Date();
        const executionId = crypto.randomUUID();

        await this.executionRepo.createPending(
            executionId,
            workflowId,
            workflow.version,
            input,
            triggeredBy
        );

        // When Redis is reachable, enqueue for async processing by the worker.
        // Fall back to synchronous in-process execution if Redis is not configured
        // or the connection fails, so the platform works without a Redis dependency.
        if (process.env.REDIS_URL) {
            try {
                const queue = getWorkflowQueue();
                await queue.add('run', { executionId, workflowId, input, triggeredBy });

                return {
                    executionId,
                    workflowId,
                    status: 'pending' as const,
                    startedAt,
                    completedAt: startedAt,
                    results: [],
                };
            } catch (redisErr) {
                console.warn('⚠️  Redis unavailable, falling back to synchronous execution:', (redisErr as Error).message);
            }
        }

        // Synchronous fallback
        await this.executionRepo.markRunning(executionId);

        try {
            const result = await this.runner.run(workflow, input);
            const completedAt = new Date();

            const hasFailure = result.results.some(r => r.status === 'failure');
            const hasSuccess = result.results.some(r => r.status === 'success');
            const finalStatus: 'success' | 'partial' | 'failure' =
                hasFailure && hasSuccess ? 'partial' : hasFailure ? 'failure' : 'success';

            await this.executionRepo.complete(executionId, finalStatus, result.results);

            return {
                executionId,
                workflowId,
                status: finalStatus,
                startedAt,
                completedAt,
                results: result.results,
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const syntheticResult: NodeResult = {
                nodeId: '__runner__',
                status: 'failure',
                output: null,
                error: message,
                durationMs: Date.now() - startedAt.getTime(),
            };
            await this.executionRepo.complete(executionId, 'failure', [syntheticResult]);
            return {
                executionId,
                workflowId,
                status: 'failure',
                startedAt,
                completedAt: new Date(),
                results: [syntheticResult],
            };
        }
    }

    async replay(executionId: string): Promise<ExecutionSummary> {
        const original = await this.executionRepo.findInput(executionId);
        if (!original) throw new Error(`Execution ${executionId} not found`);

        const { input, workflowId } = original as { input: Record<string, unknown>; workflowId: string };

        return this.trigger(workflowId, input, 'replay');
    }
}