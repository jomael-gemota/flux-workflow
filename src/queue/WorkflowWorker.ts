import { Worker, Job } from 'bullmq';
import { WorkflowJobData, WORKFLOW_QUEUE_NAME } from './WorkflowQueue';
import { getRedisConnection } from './redisConnection';
import { WorkflowRunner } from '../engine/WorkflowRunner';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { ExecutionRepository } from '../repositories/ExecutionRepository';
import { NodeResult } from '../types/workflow.types';
import { executionEventBus } from '../events/ExecutionEventBus';
import { EmailNotificationService } from '../services/EmailNotificationService';

export function createWorkflowWorker(
    runner: WorkflowRunner,
    workflowRepo: WorkflowRepository,
    executionRepo: ExecutionRepository,
    emailNotificationService: EmailNotificationService,
): Worker<WorkflowJobData> {
    const worker = new Worker<WorkflowJobData>(
        WORKFLOW_QUEUE_NAME,
        async (job: Job<WorkflowJobData>) => {
            const { executionId, workflowId, input, triggerNodeId, triggeredBy } = job.data;

            const workflow = await workflowRepo.findById(workflowId);
            if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
            const nodeNamesById = Object.fromEntries(workflow.nodes.map((node) => [node.id, node.name]));

            await executionRepo.markRunning(executionId);
            const startedAt = new Date();

            const { results } = await runner.run(workflow, input, triggerNodeId, (nodeResult) => {
                executionEventBus.emitNodeResult(executionId, nodeResult);
                executionRepo.appendNodeResult(executionId, nodeResult).catch(() => {});
            });

            const completedAt = new Date();
            const hasFailure = results.some(r => r.status === 'failure');
            const hasSuccess = results.some(r => r.status === 'success');
            const status = hasFailure && hasSuccess ? 'partial'
                : hasFailure ? 'failure'
                : 'success';

            executionEventBus.emitComplete({ executionId, workflowId, status });
            await executionRepo.complete(executionId, status, results);

            if (status === 'failure' || status === 'partial' || status === 'success') {
                emailNotificationService.notifyOnCompletion({
                    executionId,
                    workflowId,
                    workflowName: workflow.name,
                    workflowVersion: workflow.version,
                    status,
                    triggeredBy: triggeredBy ?? 'api',
                    startedAt,
                    completedAt,
                    results,
                    nodeNamesById,
                }).catch((err) => console.error('[Worker] Email notification error:', err));
            }
        },
        {
            connection: getRedisConnection(),
            concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
        }
    );

    worker.on('failed', async (job, err) => {
        if (job) {
            const completedAt = new Date();
            const syntheticResult: NodeResult = {
                nodeId: '__runner__',
                status: 'failure',
                output: null,
                error: err.message,
                durationMs: 0,
            };
            executionEventBus.emitNodeResult(job.data.executionId, syntheticResult);
            executionEventBus.emitComplete({ executionId: job.data.executionId, workflowId: job.data.workflowId, status: 'failure' });
            await executionRepo.complete(job.data.executionId, 'failure', [syntheticResult]).catch(() => {});

            // Best-effort notification for hard job failures (workflow not found, etc.)
            const workflow = await workflowRepo.findById(job.data.workflowId).catch(() => null);
            if (workflow) {
                emailNotificationService.notifyOnCompletion({
                    executionId: job.data.executionId,
                    workflowId: job.data.workflowId,
                    workflowName: workflow.name,
                    workflowVersion: workflow.version,
                    status: 'failure',
                    triggeredBy: job.data.triggeredBy ?? 'api',
                    startedAt: completedAt,
                    completedAt,
                    results: [syntheticResult],
                    nodeNamesById: Object.fromEntries(workflow.nodes.map((node) => [node.id, node.name])),
                }).catch(() => {});
            }
        }
        console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    });

    worker.on('completed', _job => {
        // console.log(`[Worker] Job ${_job.id} completed (execution: ${_job.data.executionId})`);
    });

    return worker;
}
