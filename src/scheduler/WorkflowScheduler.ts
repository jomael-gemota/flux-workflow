import cron, { ScheduledTask } from 'node-cron';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { WorkflowService } from '../services/WorkflowService';

interface TriggerNodeInfo {
    workflowId: string;
    nodeId: string;
    cronExpression: string;
}

export class WorkflowScheduler {
    // key = "workflowId::nodeId"
    private tasks: Map<string, ScheduledTask> = new Map();

    constructor(
        private workflowRepo: WorkflowRepository,
        private workflowService: WorkflowService
    ) {}

    async start(): Promise<void> {
        const { data: workflows } = await this.workflowRepo.findAll(1000);

        for (const workflow of workflows) {
            this.registerWorkflow(workflow.id, workflow.nodes);

            // Backward compat: also register top-level schedule if present
            if (workflow.schedule) {
                this.registerTask(workflow.id, '__schedule__', workflow.schedule);
            }
        }

        // console.log(`[Scheduler] Started ${this.tasks.size} scheduled task(s)`);
    }

    /** Re-scan a single workflow's trigger nodes and update cron tasks. */
    async refresh(workflowId: string): Promise<void> {
        // Remove all existing tasks for this workflow
        for (const [key, task] of this.tasks) {
            if (key.startsWith(`${workflowId}::`)) {
                task.stop();
                this.tasks.delete(key);
            }
        }

        const workflow = await this.workflowRepo.findById(workflowId);
        if (!workflow) return;

        this.registerWorkflow(workflowId, workflow.nodes);

        if (workflow.schedule) {
            this.registerTask(workflowId, '__schedule__', workflow.schedule);
        }
    }

    private registerWorkflow(
        workflowId: string,
        nodes: Array<{ id: string; type: string; config: Record<string, unknown> }>,
    ): void {
        const cronTriggers = (nodes ?? []).filter(
            (n) => n.type === 'trigger' && (n.config as Record<string, unknown>).triggerType === 'cron'
        );

        for (const node of cronTriggers) {
            const expr = (node.config as Record<string, unknown>).cronExpression as string | undefined;
            if (expr) {
                this.registerTask(workflowId, node.id, expr);
            }
        }
    }

    private registerTask(workflowId: string, nodeId: string, cronExpression: string): void {
        if (!cron.validate(cronExpression)) {
            console.warn(`[Scheduler] Invalid cron expression for ${workflowId}::${nodeId}: "${cronExpression}"`);
            return;
        }

        const key = `${workflowId}::${nodeId}`;
        const existing = this.tasks.get(key);
        if (existing) {
            existing.stop();
        }

        const task = cron.schedule(cronExpression, async () => {
            try {
                const triggerNodeId = nodeId === '__schedule__' ? undefined : nodeId;
                await this.workflowService.trigger(
                    workflowId,
                    { scheduledAt: new Date().toISOString() },
                    'schedule',
                    triggerNodeId,
                );
                // console.log(`[Scheduler] Triggered ${workflowId}::${nodeId}`);
            } catch (err) {
                console.error(`[Scheduler] Failed to trigger ${workflowId}::${nodeId}:`, err);
            }
        });

        this.tasks.set(key, task);
    }

    register(workflowId: string, cronExpression: string): void {
        this.registerTask(workflowId, '__schedule__', cronExpression);
    }

    unregister(workflowId: string): void {
        for (const [key, task] of this.tasks) {
            if (key.startsWith(`${workflowId}::`)) {
                task.stop();
                this.tasks.delete(key);
            }
        }
    }

    stop(): void {
        for (const [, task] of this.tasks) {
            task.stop();
        }
        this.tasks.clear();
        // console.log('[Scheduler] All scheduled tasks stopped');
    }
}
