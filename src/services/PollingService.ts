import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { WorkflowService } from './WorkflowService';
import { CredentialRepository } from '../repositories/CredentialRepository';
import { BasecampAuthService } from './BasecampAuthService';
import { SlackAuthService } from './SlackAuthService';
import { TeamsAuthService } from './TeamsAuthService';
import { GoogleAuthService } from './GoogleAuthService';
import { TriggerStateModel } from '../db/models/TriggerStateModel';

interface TriggerNodeConfig {
    triggerType: string;
    appType?: string;
    eventType?: string;
    credentialId?: string;
    pollIntervalMinutes?: number;
    projectId?: string;
    todolistId?: string;
    labelFilter?: string;
}

interface PollableNode {
    workflowId: string;
    nodeId: string;
    config: TriggerNodeConfig;
}

export class PollingService {
    private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();

    constructor(
        private workflowRepo: WorkflowRepository,
        private workflowService: WorkflowService,
        private credentialRepo: CredentialRepository,
        private basecampAuth: BasecampAuthService,
        private slackAuth: SlackAuthService,
        private teamsAuth: TeamsAuthService,
        private googleAuth: GoogleAuthService,
    ) {}

    async start(): Promise<void> {
        const { data: workflows } = await this.workflowRepo.findAll(1000);
        let count = 0;

        for (const workflow of workflows) {
            count += this.registerWorkflow(workflow.id, workflow.nodes ?? []);
        }

        // console.log(`[PollingService] Started ${count} polling trigger(s)`);
    }

    async refresh(workflowId: string): Promise<void> {
        this.unregisterWorkflow(workflowId);

        const workflow = await this.workflowRepo.findById(workflowId);
        if (!workflow) return;

        this.registerWorkflow(workflowId, workflow.nodes ?? []);
    }

    stop(): void {
        for (const [, interval] of this.intervals) clearInterval(interval);
        this.intervals.clear();
        // console.log('[PollingService] All polling triggers stopped');
    }

    // ── internals ────────────────────────────────────────────────────────

    private registerWorkflow(
        workflowId: string,
        nodes: Array<{ id: string; type: string; config: Record<string, unknown> }>,
    ): number {
        const pollableNodes: PollableNode[] = (nodes ?? [])
            .filter((n) => {
                if (n.type !== 'trigger') return false;
                const cfg = n.config as unknown as TriggerNodeConfig;
                return cfg.triggerType === 'app_event' || cfg.triggerType === 'email';
            })
            .map((n) => ({
                workflowId,
                nodeId: n.id,
                config: n.config as unknown as TriggerNodeConfig,
            }));

        for (const pn of pollableNodes) {
            this.registerPollable(pn);
        }

        return pollableNodes.length;
    }

    private unregisterWorkflow(workflowId: string): void {
        for (const [key, interval] of this.intervals) {
            if (key.startsWith(`${workflowId}::`)) {
                clearInterval(interval);
                this.intervals.delete(key);
            }
        }
    }

    private registerPollable(pn: PollableNode): void {
        const key = `${pn.workflowId}::${pn.nodeId}`;
        const existing = this.intervals.get(key);
        if (existing) clearInterval(existing);

        const intervalMs = ((pn.config.pollIntervalMinutes ?? 5) * 60_000);

        // Run the first poll immediately, then set up the interval
        this.poll(pn).catch((err) =>
            console.error(`[PollingService] Initial poll error ${key}:`, err)
        );

        const interval = setInterval(async () => {
            try {
                await this.poll(pn);
            } catch (err) {
                console.error(`[PollingService] Poll error ${key}:`, err);
            }
        }, intervalMs);

        this.intervals.set(key, interval);
    }

    private async poll(pn: PollableNode): Promise<void> {
        const key = `${pn.workflowId}::${pn.nodeId}`;

        // Load or create state
        let state = await TriggerStateModel.findOne({
            workflowId: pn.workflowId,
            nodeId: pn.nodeId,
        });
        if (!state) {
            state = await TriggerStateModel.create({
                workflowId: pn.workflowId,
                nodeId: pn.nodeId,
                lastPollAt: new Date(),
                lastSeenId: '',
                metadata: {},
            });
            return; // First creation — skip triggering, start tracking from now
        }

        const since = state.lastPollAt;
        let newItems: Array<Record<string, unknown>> = [];
        let newLastSeenId = state.lastSeenId;

        try {
            if (pn.config.triggerType === 'app_event') {
                ({ items: newItems, lastSeenId: newLastSeenId } = await this.pollAppEvent(pn.config, since, state.lastSeenId));
            } else if (pn.config.triggerType === 'email') {
                ({ items: newItems, lastSeenId: newLastSeenId } = await this.pollEmail(pn.config, since, state.lastSeenId));
            }
        } catch (err) {
            console.error(`[PollingService] Adapter error ${key}:`, err);
            return;
        }

        if (newItems.length > 0) {
            try {
                await this.workflowService.trigger(
                    pn.workflowId,
                    {
                        items: newItems,
                        count: newItems.length,
                        polledAt: new Date().toISOString(),
                    },
                    'api',
                    pn.nodeId,
                );
                // console.log(`[PollingService] Triggered ${key} with ${newItems.length} new item(s)`);
            } catch (err) {
                console.error(`[PollingService] Trigger error ${key}:`, err);
            }
        }

        // Update state
        await TriggerStateModel.updateOne(
            { workflowId: pn.workflowId, nodeId: pn.nodeId },
            { $set: { lastPollAt: new Date(), lastSeenId: newLastSeenId } },
        );
    }

    // ── App Event Adapters ───────────────────────────────────────────────

    private async pollAppEvent(
        config: TriggerNodeConfig,
        since: Date,
        lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        switch (config.appType) {
            case 'basecamp': return this.pollBasecamp(config, since, lastSeenId);
            case 'slack':    return this.pollSlack(config, since, lastSeenId);
            case 'teams':    return this.pollTeams(config, since, lastSeenId);
            case 'gmail':    return this.pollGmail(config, since, lastSeenId);
            default:
                return { items: [], lastSeenId };
        }
    }

    private async pollBasecamp(
        config: TriggerNodeConfig,
        since: Date,
        lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        const { credentialId, projectId, todolistId, eventType } = config;
        if (!credentialId) return { items: [], lastSeenId };

        const token = await this.basecampAuth.getToken(credentialId);
        const accountId = await this.basecampAuth.getAccountId(credentialId);
        const baseUrl = `https://3.basecampapi.com/${accountId}`;
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'WorkflowAutomation (hello@example.com)',
            'Content-Type': 'application/json',
        };

        let url: string;
        if (eventType === 'new_todo' && todolistId) {
            url = `${baseUrl}/todolists/${todolistId}/todos.json`;
        } else if (eventType === 'new_message' && projectId) {
            url = `${baseUrl}/buckets/${projectId}/messages.json`;
        } else if (eventType === 'new_comment' && projectId) {
            url = `${baseUrl}/buckets/${projectId}/recordings/comments.json`;
        } else {
            return { items: [], lastSeenId };
        }

        const allItems = await this.fetchAllPages(url, headers);
        const sinceMs = since.getTime();
        const newItems = allItems.filter((item) => {
            const created = new Date(item.created_at as string).getTime();
            return created > sinceMs;
        });

        const newLastSeen = newItems.length > 0
            ? String(newItems[0].id ?? lastSeenId)
            : lastSeenId;

        return { items: newItems, lastSeenId: newLastSeen };
    }

    private async pollSlack(
        config: TriggerNodeConfig,
        since: Date,
        _lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        const { credentialId } = config;
        if (!credentialId) return { items: [], lastSeenId: _lastSeenId };

        const token = await this.slackAuth.getToken(credentialId);
        const oldest = String(since.getTime() / 1000);

        // We need a channel to poll — store it in metadata or config
        // For now, poll general conversations list for new messages
        const res = await fetch('https://slack.com/api/conversations.list', {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { items: [], lastSeenId: _lastSeenId };
        const data = await res.json() as { channels?: Array<{ id: string; updated: number }> };
        const channels = data.channels ?? [];

        const newItems: Array<Record<string, unknown>> = [];
        let latestTs = _lastSeenId;

        for (const ch of channels.slice(0, 5)) {
            const histRes = await fetch(
                `https://slack.com/api/conversations.history?channel=${ch.id}&oldest=${oldest}&limit=20`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!histRes.ok) continue;
            const histData = await histRes.json() as { messages?: Array<Record<string, unknown>> };
            const messages = histData.messages ?? [];
            for (const msg of messages) {
                newItems.push({ ...msg, _channel: ch.id });
                const ts = msg.ts as string;
                if (ts && ts > latestTs) latestTs = ts;
            }
        }

        return { items: newItems, lastSeenId: latestTs };
    }

    private async pollTeams(
        config: TriggerNodeConfig,
        since: Date,
        _lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        const { credentialId } = config;
        if (!credentialId) return { items: [], lastSeenId: _lastSeenId };

        const token = await this.teamsAuth.getToken(credentialId);
        const sinceISO = since.toISOString();

        const res = await fetch(
            `https://graph.microsoft.com/v1.0/me/chats/getAllMessages?$filter=lastModifiedDateTime gt ${sinceISO}&$top=50`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            },
        );

        if (!res.ok) return { items: [], lastSeenId: _lastSeenId };
        const data = await res.json() as { value?: Array<Record<string, unknown>> };
        const messages = data.value ?? [];

        const newLastSeen = messages.length > 0
            ? String(messages[0].id ?? _lastSeenId)
            : _lastSeenId;

        return { items: messages, lastSeenId: newLastSeen };
    }

    private async pollGmail(
        config: TriggerNodeConfig,
        since: Date,
        _lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        return this.pollEmail(config, since, _lastSeenId);
    }

    // ── Email (Gmail) Adapter ────────────────────────────────────────────

    private async pollEmail(
        config: TriggerNodeConfig,
        since: Date,
        _lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        const { credentialId, labelFilter } = config;
        if (!credentialId) return { items: [], lastSeenId: _lastSeenId };

        const client = await this.googleAuth.getAuthenticatedClient(credentialId);
        const token = (await client.getAccessToken()).token;
        if (!token) return { items: [], lastSeenId: _lastSeenId };

        const afterEpoch = Math.floor(since.getTime() / 1000);
        const query = `after:${afterEpoch}${labelFilter ? ` label:${labelFilter}` : ''}`;

        const listRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
            { headers: { Authorization: `Bearer ${token}` } },
        );

        if (!listRes.ok) return { items: [], lastSeenId: _lastSeenId };
        const listData = await listRes.json() as { messages?: Array<{ id: string }> };
        const messageIds = (listData.messages ?? []).map((m) => m.id);

        // Filter out already-seen messages
        const newIds = _lastSeenId
            ? messageIds.filter((id) => id > _lastSeenId)
            : messageIds;

        const items: Array<Record<string, unknown>> = [];
        for (const id of newIds.slice(0, 10)) {
            const msgRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (msgRes.ok) {
                items.push(await msgRes.json() as Record<string, unknown>);
            }
        }

        const newLastSeen = newIds.length > 0 ? newIds[0] : _lastSeenId;
        return { items, lastSeenId: newLastSeen };
    }

    // ── Pagination helper ────────────────────────────────────────────────

    private async fetchAllPages(
        startUrl: string,
        headers: Record<string, string>,
    ): Promise<Array<Record<string, unknown>>> {
        const results: Array<Record<string, unknown>> = [];
        let nextUrl: string | null = startUrl;

        while (nextUrl) {
            const res: Response = await fetch(nextUrl, { headers });
            if (!res.ok) break;
            const page = await res.json() as Array<Record<string, unknown>>;
            results.push(...page);

            const linkHeader: string = res.headers.get('Link') ?? '';
            const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            nextUrl = nextMatch ? nextMatch[1] : null;
        }

        return results;
    }
}
