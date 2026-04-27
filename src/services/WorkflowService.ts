import crypto from 'crypto';
import { WorkflowRunner } from '../engine/WorkflowRunner';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { ExecutionRepository } from '../repositories/ExecutionRepository';
import { ExecutionSummary } from '../types/api.types';
import { NodeResult } from '../types/workflow.types';
import { getWorkflowQueue } from '../queue/WorkflowQueue';
import { executionEventBus } from '../events/ExecutionEventBus';
import { EmailNotificationService } from './EmailNotificationService';

export class WorkflowService {
    constructor(
        private runner: WorkflowRunner,
        private workflowRepo: WorkflowRepository,
        private executionRepo: ExecutionRepository,
        private emailNotificationService?: EmailNotificationService,
    ) {}

    async trigger(
        workflowId: string,
        input: Record<string, unknown>,
        triggeredBy: 'api' | 'webhook' | 'replay' | 'manual' | 'schedule' = 'api',
        triggerNodeId?: string,
    ): Promise<ExecutionSummary> {
        const workflow = await this.workflowRepo.findById(workflowId);
        if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
        const nodeNamesById = Object.fromEntries(workflow.nodes.map((node) => [node.id, node.name]));

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
                await queue.add('run', { executionId, workflowId, input, triggeredBy, triggerNodeId });

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
            const result = await this.runner.run(workflow, input, triggerNodeId, (nodeResult) => {
                executionEventBus.emitNodeResult(executionId, nodeResult);
                this.executionRepo.appendNodeResult(executionId, nodeResult).catch(() => {});
            });
            const completedAt = new Date();

            const hasFailure = result.results.some(r => r.status === 'failure');
            const hasSuccess = result.results.some(r => r.status === 'success');
            const finalStatus: 'success' | 'partial' | 'failure' =
                hasFailure && hasSuccess ? 'partial' : hasFailure ? 'failure' : 'success';

            executionEventBus.emitComplete({ executionId, workflowId, status: finalStatus });
            await this.executionRepo.complete(executionId, finalStatus, result.results);

            if (finalStatus === 'failure' || finalStatus === 'partial' || finalStatus === 'success') {
                this.emailNotificationService?.notifyOnCompletion({
                    executionId,
                    workflowId,
                    workflowName: workflow.name,
                    workflowVersion: workflow.version,
                    status: finalStatus,
                    triggeredBy,
                    startedAt,
                    completedAt,
                    results: result.results,
                    nodeNamesById,
                }).catch((err) => console.error('[WorkflowService] Email notification error:', err));
            }

            return {
                executionId,
                workflowId,
                status: finalStatus,
                startedAt,
                completedAt,
                results: result.results,
            };
        } catch (err: unknown) {
            const completedAt = new Date();
            const message = err instanceof Error ? err.message : String(err);
            const syntheticResult: NodeResult = {
                nodeId: '__runner__',
                status: 'failure',
                output: null,
                error: message,
                durationMs: completedAt.getTime() - startedAt.getTime(),
            };
            executionEventBus.emitNodeResult(executionId, syntheticResult);
            executionEventBus.emitComplete({ executionId, workflowId, status: 'failure' });
            await this.executionRepo.complete(executionId, 'failure', [syntheticResult]);

            this.emailNotificationService?.notifyOnCompletion({
                executionId,
                workflowId,
                workflowName: workflow.name,
                workflowVersion: workflow.version,
                status: 'failure',
                triggeredBy,
                startedAt,
                completedAt,
                results: [syntheticResult],
                nodeNamesById,
            }).catch((err) => console.error('[WorkflowService] Email notification error:', err));

            return {
                executionId,
                workflowId,
                status: 'failure',
                startedAt,
                completedAt,
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