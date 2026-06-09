import cron, { ScheduledTask } from 'node-cron';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { WorkflowService } from '../services/WorkflowService';
import { CredentialRepository } from '../repositories/CredentialRepository';

interface TriggerNodeInfo {
    workflowId: string;
    nodeId: string;
    cronExpression: string;
}

export interface ScheduledTaskInfo {
    workflowId: string;
    nodeId: string;
    cronExpression: string;
    timezone?: string;
}

export class WorkflowScheduler {
    // key = "workflowId::nodeId"
    private tasks: Map<string, ScheduledTask> = new Map();
    // key = "workflowId::nodeId" → cronExpression
    private taskExpressions: Map<string, string> = new Map();
    // key = "workflowId::nodeId" → IANA timezone
    private taskTimezones: Map<string, string> = new Map();

    constructor(
        private workflowRepo: WorkflowRepository,
        private workflowService: WorkflowService,
        private credentialRepo?: CredentialRepository,
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
                this.taskExpressions.delete(key);
                this.taskTimezones.delete(key);
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
        nodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>,
    ): void {
        // Defensive: legacy / partially-saved trigger nodes may have no `config` object.
        const cronTriggers = (nodes ?? []).filter(
            (n) => n.type === 'trigger' && n.config?.triggerType === 'cron'
        );

        for (const node of cronTriggers) {
            const expr = node.config?.cronExpression as string | undefined;
            if (expr) {
                const timezone = node.config?.cronTimezone as string | undefined;
                this.registerTask(workflowId, node.id, expr, timezone);
            }
        }
    }

    private registerTask(workflowId: string, nodeId: string, cronExpression: string, timezone?: string): void {
        if (!cron.validate(cronExpression)) {
            console.warn(`[Scheduler] Invalid cron expression for ${workflowId}::${nodeId}: "${cronExpression}"`);
            return;
        }

        const tz = this.normalizeTimezone(timezone, `${workflowId}::${nodeId}`);

        const key = `${workflowId}::${nodeId}`;
        const existing = this.tasks.get(key);
        if (existing) {
            existing.stop();
        }

        this.taskExpressions.set(key, cronExpression);
        if (tz) {
            this.taskTimezones.set(key, tz);
        } else {
            this.taskTimezones.delete(key);
        }
        const task = cron.schedule(
            cronExpression,
            async () => {
                try {
                    // Pre-flight: skip (defer) the run instead of executing it
                    // against a credential that is known to need reconnection.
                    // The owner has already been alerted by CredentialHealthService;
                    // the run would only fail mid-workflow otherwise.
                    const deadEmail = await this.findReauthRequiredCredential(workflowId);
                    if (deadEmail) {
                        console.warn(
                            `[Scheduler] Skipping ${workflowId}::${nodeId} — credential "${deadEmail}" requires reconnection`,
                        );
                        return;
                    }

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
            },
            tz ? { timezone: tz } : undefined,
        );

        this.tasks.set(key, task);
    }

    /**
     * Returns the email of the first credential referenced by the workflow
     * whose status is `reauth_required`, or null when all are healthy.
     * Errors are swallowed (returns null) so a transient DB issue never
     * blocks a scheduled run.
     */
    private async findReauthRequiredCredential(workflowId: string): Promise<string | null> {
        if (!this.credentialRepo) return null;
        try {
            const workflow = await this.workflowRepo.findById(workflowId);
            if (!workflow) return null;

            const credentialIds = new Set<string>();
            for (const node of workflow.nodes ?? []) {
                const credId = (node.config as Record<string, unknown> | undefined)?.credentialId;
                if (typeof credId === 'string' && credId) credentialIds.add(credId);
            }

            for (const credId of credentialIds) {
                const cred = await this.credentialRepo.findById(credId);
                if (cred?.status === 'reauth_required') return cred.email;
            }
            return null;
        } catch {
            return null;
        }
    }

    /** Validate an IANA timezone; warn and fall back to server time if invalid. */
    private normalizeTimezone(timezone: string | undefined, key: string): string | undefined {
        const tz = timezone?.trim();
        if (!tz) return undefined;
        try {
            Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
            return tz;
        } catch {
            console.warn(`[Scheduler] Invalid timezone for ${key}: "${tz}" — using server time`);
            return undefined;
        }
    }

    register(workflowId: string, cronExpression: string): void {
        this.registerTask(workflowId, '__schedule__', cronExpression);
    }

    unregister(workflowId: string): void {
        for (const [key, task] of this.tasks) {
            if (key.startsWith(`${workflowId}::`)) {
                task.stop();
                this.tasks.delete(key);
                this.taskExpressions.delete(key);
                this.taskTimezones.delete(key);
            }
        }
    }

    stop(): void {
        for (const [, task] of this.tasks) {
            task.stop();
        }
        this.tasks.clear();
        this.taskExpressions.clear();
        this.taskTimezones.clear();
        // console.log('[Scheduler] All scheduled tasks stopped');
    }

    /** Returns all currently registered scheduled tasks with their cron expressions. */
    getScheduledTasks(): ScheduledTaskInfo[] {
        const result: ScheduledTaskInfo[] = [];
        for (const [key, cronExpression] of this.taskExpressions) {
            const separatorIdx = key.indexOf('::');
            if (separatorIdx === -1) continue;
            result.push({
                workflowId: key.slice(0, separatorIdx),
                nodeId: key.slice(separatorIdx + 2),
                cronExpression,
                timezone: this.taskTimezones.get(key),
            });
        }
        return result;
    }
}
