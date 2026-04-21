import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';

type TriggerType = 'manual' | 'webhook' | 'cron' | 'app_event' | 'email';

interface TriggerConfig {
    triggerType: TriggerType;

    // webhook
    webhookMethod?: 'POST' | 'GET' | 'PUT';

    // cron
    cronExpression?: string;
    cronTimezone?: string;

    // app_event
    appType?: 'basecamp' | 'slack' | 'teams' | 'gmail' | 'gdrive' | 'gsheets';
    eventType?: string;
    credentialId?: string;
    pollIntervalMinutes?: number;
    // basecamp
    projectId?: string;
    todolistId?: string;
    // google drive
    fileId?: string;
    folderId?: string;
    // google sheets
    spreadsheetId?: string;
    sheetName?: string;
    // teams
    teamId?: string;
    channelId?: string;
    // slack
    slackChannelId?: string;

    // email (gmail)
    labelFilter?: string;
}

/**
 * The TriggerNode is a pass-through entry point: it outputs whatever
 * payload was injected into the execution context by the trigger source
 * (manual click, webhook request, cron tick, or polling service).
 */
export class TriggerNode implements NodeExecutor {
    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as TriggerConfig;
        const input = context.variables.input as Record<string, unknown> | undefined;

        return {
            triggerType: config.triggerType ?? 'manual',
            triggeredAt: context.startedAt.toISOString(),
            ...(input ?? {}),
        };
    }
}
