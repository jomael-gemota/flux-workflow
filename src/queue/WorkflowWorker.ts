import { Worker, Job } from 'bullmq';
import { WorkflowJobData, WORKFLOW_QUEUE_NAME } from './WorkflowQueue';
import { getRedisConnection } from './redisConnection';
import { WorkflowRunner } from '../engine/WorkflowRunner';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { ExecutionRepository } from '../repositories/ExecutionRepository';
import { NodeResult } from '../types/workflow.types';

export function createWorkflowWorker(
    runner: WorkflowRunner,
    workflowRepo: WorkflowRepository,
    executionRepo: ExecutionRepository
): Worker<WorkflowJobData> {
    const worker = new Worker<WorkflowJobData>(
        WORKFLOW_QUEUE_NAME,
        async (job: Job<WorkflowJobData>) => {
            const { executionId, workflowId, input } = job.data;

            const workflow = await workflowRepo.findById(workflowId);
            if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

            await executionRepo.markRunning(executionId);

            const { results } = await runner.run(workflow, input);

            const hasFailure = results.some(r => r.status === 'failure');
            const hasSuccess = results.some(r => r.status === 'success');
            const status = hasFailure && hasSuccess ? 'partial'
                : hasFailure ? 'failure'
                : 'success';

            await executionRepo.complete(executionId, status, results);
        },
        {
            connection: getRedisConnection(),
            concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
        }
    );

    worker.on('failed', async (job, err) => {
        if (job) {
            const syntheticResult: NodeResult = {
                nodeId: '__runner__',
                status: 'failure',
                output: null,
                error: err.message,
                durationMs: 0,
            };
            await executionRepo.complete(job.data.executionId, 'failure', [syntheticResult]).catch(() => {});
        }
        console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    });

    worker.on('completed', job => {
        console.log(`[Worker] Job ${job.id} completed (execution: ${job.data.executionId})`);
    });

    return worker;
}
