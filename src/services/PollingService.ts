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
    // email
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
            case 'gdrive':   return this.pollGDrive(config, since, lastSeenId);
            case 'gsheets':  return this.pollGSheets(config, since, lastSeenId);
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
        lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        const { credentialId, eventType, slackChannelId } = config;
        if (!credentialId) return { items: [], lastSeenId };

        const token = await this.slackAuth.getToken(credentialId);
        const oldest = String(since.getTime() / 1000);
        const authHdr = { Authorization: `Bearer ${token}` };

        // ── New user joined ──────────────────────────────────────────────
        if (eventType === 'new_user') {
            const res = await fetch('https://slack.com/api/users.list', { headers: authHdr });
            if (!res.ok) return { items: [], lastSeenId };
            const data = await res.json() as { members?: Array<Record<string, unknown>> };
            const users = (data.members ?? []).filter((u) => {
                const updated = (u.updated as number) ?? 0;
                return updated > since.getTime() / 1000 && !u.is_bot && u.id !== 'USLACKBOT';
            });
            const newLastSeen = users.length > 0 ? String(users[0].id ?? lastSeenId) : lastSeenId;
            return { items: users, lastSeenId: newLastSeen };
        }

        // ── New public channel created ───────────────────────────────────
        if (eventType === 'new_public_channel') {
            const res = await fetch(
                `https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200`,
                { headers: authHdr },
            );
            if (!res.ok) return { items: [], lastSeenId };
            const data = await res.json() as { channels?: Array<Record<string, unknown>> };
            const channels = (data.channels ?? []).filter((ch) => {
                const created = (ch.created as number) ?? 0;
                return created > since.getTime() / 1000;
            });
            const newLastSeen = channels.length > 0 ? String(channels[0].id ?? lastSeenId) : lastSeenId;
            return { items: channels, lastSeenId: newLastSeen };
        }

        // ── File made public ─────────────────────────────────────────────
        if (eventType === 'file_public') {
            const res = await fetch(
                `https://slack.com/api/files.list?ts_from=${oldest}&types=all&count=20`,
                { headers: authHdr },
            );
            if (!res.ok) return { items: [], lastSeenId };
            const data = await res.json() as { files?: Array<Record<string, unknown>> };
            const files = (data.files ?? []).filter((f) => f.is_public === true);
            const newLastSeen = files.length > 0 ? String(files[0].id ?? lastSeenId) : lastSeenId;
            return { items: files, lastSeenId: newLastSeen };
        }

        // ── File shared ──────────────────────────────────────────────────
        if (eventType === 'file_shared') {
            const res = await fetch(
                `https://slack.com/api/files.list?ts_from=${oldest}&types=all&count=20`,
                { headers: authHdr },
            );
            if (!res.ok) return { items: [], lastSeenId };
            const data = await res.json() as { files?: Array<Record<string, unknown>> };
            const files = data.files ?? [];
            const newLastSeen = files.length > 0 ? String(files[0].id ?? lastSeenId) : lastSeenId;
            return { items: files, lastSeenId: newLastSeen };
        }

        // ── Message-based events (any_event, new_message, app_mention, reaction_added) ──
        // Resolve which channels to scan
        let channelIds: string[] = [];
        if (slackChannelId) {
            channelIds = [slackChannelId];
        } else {
            const listRes = await fetch(
                'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=100',
                { headers: authHdr },
            );
            if (listRes.ok) {
                const listData = await listRes.json() as { channels?: Array<{ id: string }> };
                channelIds = (listData.channels ?? []).slice(0, 10).map((c) => c.id);
            }
        }

        // Resolve bot user ID for app_mention filtering
        let botUserId = '';
        if (eventType === 'app_mention') {
            const authRes = await fetch('https://slack.com/api/auth.test', { headers: authHdr });
            if (authRes.ok) {
                const authData = await authRes.json() as { user_id?: string };
                botUserId = authData.user_id ?? '';
            }
        }

        const newItems: Array<Record<string, unknown>> = [];
        let latestTs = lastSeenId;

        for (const chId of channelIds) {
            const histRes = await fetch(
                `https://slack.com/api/conversations.history?channel=${chId}&oldest=${oldest}&limit=50`,
                { headers: authHdr },
            );
            if (!histRes.ok) continue;
            const histData = await histRes.json() as { messages?: Array<Record<string, unknown>> };
            const messages = histData.messages ?? [];

            for (const msg of messages) {
                const ts = msg.ts as string;

                if (eventType === 'app_mention') {
                    if (botUserId && !(msg.text as string ?? '').includes(`<@${botUserId}>`)) continue;
                } else if (eventType === 'reaction_added') {
                    // Reactions appear as message subtypes or in reactions array
                    const hasReactions = Array.isArray(msg.reactions) && (msg.reactions as unknown[]).length > 0;
                    if (!hasReactions) continue;
                }

                newItems.push({ ...msg, _channel: chId, _eventType: eventType });
                if (ts && ts > latestTs) latestTs = ts;
            }
        }

        return { items: newItems, lastSeenId: latestTs };
    }

    private async pollTeams(
        config: TriggerNodeConfig,
        since: Date,
        lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        const { credentialId, eventType, teamId, channelId } = config;
        if (!credentialId) return { items: [], lastSeenId };

        const token = await this.teamsAuth.getToken(credentialId);
        const sinceISO = since.toISOString();
        const graphHdr = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        // ── New channel ──────────────────────────────────────────────────
        if (eventType === 'new_channel') {
            const teamsToScan = teamId ? [teamId] : await this.teamsGetAllTeamIds(token);
            const newChannels: Array<Record<string, unknown>> = [];
            for (const tid of teamsToScan.slice(0, 5)) {
                const res = await fetch(
                    `https://graph.microsoft.com/v1.0/teams/${tid}/channels`,
                    { headers: graphHdr },
                );
                if (!res.ok) continue;
                const data = await res.json() as { value?: Array<Record<string, unknown>> };
                const channels = (data.value ?? []).filter((ch) => {
                    const created = ch.createdDateTime as string;
                    return created && new Date(created) > since;
                });
                newChannels.push(...channels.map((ch) => ({ ...ch, _teamId: tid })));
            }
            const newLastSeen = newChannels.length > 0 ? String(newChannels[0].id ?? lastSeenId) : lastSeenId;
            return { items: newChannels, lastSeenId: newLastSeen };
        }

        // ── New channel message ──────────────────────────────────────────
        if (eventType === 'new_channel_message') {
            if (!teamId || !channelId) return { items: [], lastSeenId };
            const res = await fetch(
                `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/delta?$filter=lastModifiedDateTime gt ${sinceISO}&$top=50`,
                { headers: graphHdr },
            );
            if (!res.ok) return { items: [], lastSeenId };
            const data = await res.json() as { value?: Array<Record<string, unknown>> };
            const messages = data.value ?? [];
            const newLastSeen = messages.length > 0 ? String(messages[0].id ?? lastSeenId) : lastSeenId;
            return { items: messages, lastSeenId: newLastSeen };
        }

        // ── New chat ─────────────────────────────────────────────────────
        if (eventType === 'new_chat') {
            const res = await fetch(
                `https://graph.microsoft.com/v1.0/me/chats?$filter=lastUpdatedDateTime gt ${sinceISO}&$top=50`,
                { headers: graphHdr },
            );
            if (!res.ok) return { items: [], lastSeenId };
            const data = await res.json() as { value?: Array<Record<string, unknown>> };
            const chats = (data.value ?? []).filter((chat) => {
                const created = chat.createdDateTime as string;
                return created && new Date(created) > since;
            });
            const newLastSeen = chats.length > 0 ? String(chats[0].id ?? lastSeenId) : lastSeenId;
            return { items: chats, lastSeenId: newLastSeen };
        }

        // ── New team member ──────────────────────────────────────────────
        if (eventType === 'new_team_member') {
            const teamsToScan = teamId ? [teamId] : await this.teamsGetAllTeamIds(token);
            const newMembers: Array<Record<string, unknown>> = [];
            for (const tid of teamsToScan.slice(0, 5)) {
                const res = await fetch(
                    `https://graph.microsoft.com/v1.0/teams/${tid}/members`,
                    { headers: graphHdr },
                );
                if (!res.ok) continue;
                const data = await res.json() as { value?: Array<Record<string, unknown>> };
                const members = (data.value ?? []).filter((m) => {
                    const added = m.visibleHistoryStartDateTime as string;
                    return added && new Date(added) > since;
                });
                newMembers.push(...members.map((m) => ({ ...m, _teamId: tid })));
            }
            const newLastSeen = newMembers.length > 0 ? String(newMembers[0].id ?? lastSeenId) : lastSeenId;
            return { items: newMembers, lastSeenId: newLastSeen };
        }

        // ── New chat message (default / new_chat_message) ────────────────
        const res = await fetch(
            `https://graph.microsoft.com/v1.0/me/chats/getAllMessages?$filter=lastModifiedDateTime gt ${sinceISO}&$top=50`,
            { headers: graphHdr },
        );
        if (!res.ok) return { items: [], lastSeenId };
        const data = await res.json() as { value?: Array<Record<string, unknown>> };
        const messages = data.value ?? [];
        const newLastSeen = messages.length > 0 ? String(messages[0].id ?? lastSeenId) : lastSeenId;
        return { items: messages, lastSeenId: newLastSeen };
    }

    /** Helper: fetch all team IDs accessible by the signed-in user. */
    private async teamsGetAllTeamIds(token: string): Promise<string[]> {
        const res = await fetch(
            'https://graph.microsoft.com/v1.0/me/joinedTeams?$select=id',
            { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return [];
        const data = await res.json() as { value?: Array<{ id: string }> };
        return (data.value ?? []).map((t) => t.id);
    }

    private async pollGDrive(
        config: TriggerNodeConfig,
        since: Date,
        lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        const { credentialId, eventType, fileId, folderId } = config;
        if (!credentialId) return { items: [], lastSeenId };

        const client = await this.googleAuth.getAuthenticatedClient(credentialId);
        const token = (await client.getAccessToken()).token;
        if (!token) return { items: [], lastSeenId };

        const authHdr = { Authorization: `Bearer ${token}` };

        // ── Changes to a specific file ───────────────────────────────────
        if (eventType === 'file_changed' && fileId) {
            const res = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,modifiedTime,version,lastModifyingUser,mimeType,size`,
                { headers: authHdr },
            );
            if (!res.ok) return { items: [], lastSeenId };
            const file = await res.json() as Record<string, unknown>;
            const modifiedTime = file.modifiedTime ? new Date(file.modifiedTime as string) : null;
            const currentVersion = String(file.version ?? '');

            if (modifiedTime && modifiedTime > since && currentVersion !== lastSeenId) {
                return { items: [{ ...file, _eventType: 'file_changed' }], lastSeenId: currentVersion };
            }
            return { items: [], lastSeenId: currentVersion || lastSeenId };
        }

        // ── Changes involving a specific folder ──────────────────────────
        if (eventType === 'folder_changed' && folderId) {
            const sinceISO = since.toISOString();
            const query = encodeURIComponent(`'${folderId}' in parents and modifiedTime > '${sinceISO}' and trashed = false`);
            const res = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,mimeType,size,lastModifyingUser)&orderBy=modifiedTime+desc&pageSize=50`,
                { headers: authHdr },
            );
            if (!res.ok) return { items: [], lastSeenId };
            const data = await res.json() as { files?: Array<Record<string, unknown>> };
            const files = (data.files ?? []).map((f) => ({ ...f, _eventType: 'folder_changed', _folderId: folderId } as Record<string, unknown>));
            const newLastSeen = files.length > 0 ? String(files[0].id ?? lastSeenId) : lastSeenId;
            return { items: files, lastSeenId: newLastSeen };
        }

        return { items: [], lastSeenId };
    }

    private async pollGSheets(
        config: TriggerNodeConfig,
        since: Date,
        lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        const { credentialId, spreadsheetId, sheetName, eventType } = config;
        if (!credentialId || !spreadsheetId) return { items: [], lastSeenId };

        const client = await this.googleAuth.getAuthenticatedClient(credentialId);
        const token = (await client.getAccessToken()).token;
        if (!token) return { items: [], lastSeenId };

        const authHdr = { Authorization: `Bearer ${token}` };

        // Check if the spreadsheet file was modified since last poll
        const driveRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=id,modifiedTime,version`,
            { headers: authHdr },
        );
        if (!driveRes.ok) return { items: [], lastSeenId };
        const fileInfo = await driveRes.json() as { modifiedTime?: string; version?: string };
        const modifiedTime = fileInfo.modifiedTime ? new Date(fileInfo.modifiedTime) : null;
        const currentVersion = String(fileInfo.version ?? '');

        // Parse stored state: "rowCount|version"
        const [storedCountStr, storedVersion] = lastSeenId ? lastSeenId.split('|') : ['', ''];
        const lastRowCount = storedCountStr ? parseInt(storedCountStr, 10) : -1;

        // If not modified and version unchanged, nothing to do
        if (modifiedTime && modifiedTime <= since && currentVersion === storedVersion) {
            return { items: [], lastSeenId };
        }

        // Fetch current sheet data
        const range = sheetName ? `${encodeURIComponent(sheetName)}!A:Z` : 'Sheet1!A:Z';
        const sheetsRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
            { headers: authHdr },
        );
        if (!sheetsRes.ok) return { items: [], lastSeenId: `0|${currentVersion}` };
        const sheetsData = await sheetsRes.json() as { values?: string[][] };
        const rows = sheetsData.values ?? [];
        const headers = rows[0] ?? [];
        const dataRows = rows.slice(1);
        const currentCount = dataRows.length;
        const newStateId = `${currentCount}|${currentVersion}`;

        // First run — initialise cursor without triggering
        if (lastRowCount === -1) {
            return { items: [], lastSeenId: newStateId };
        }

        const mapRow = (row: string[], index: number, label: string): Record<string, unknown> => {
            const obj: Record<string, unknown> = { _rowIndex: index + 2, _eventType: label };
            headers.forEach((h, j) => { obj[h || `col${j + 1}`] = row[j] ?? ''; });
            return obj;
        };

        let items: Array<Record<string, unknown>> = [];

        if (eventType === 'row_added') {
            if (currentCount > lastRowCount) {
                items = dataRows.slice(lastRowCount).map((row, i) =>
                    mapRow(row, lastRowCount + i, 'row_added'));
            }
        } else if (eventType === 'row_updated') {
            // Detect update when file modified but row count unchanged
            if (currentCount <= lastRowCount && currentVersion !== storedVersion) {
                items = dataRows.map((row, i) => mapRow(row, i, 'row_updated'));
            }
        } else if (eventType === 'row_added_or_updated') {
            if (currentCount > lastRowCount) {
                // New rows were added
                items = dataRows.slice(lastRowCount).map((row, i) =>
                    mapRow(row, lastRowCount + i, 'row_added'));
            } else if (currentVersion !== storedVersion) {
                // Same row count but file changed — rows were updated
                items = dataRows.map((row, i) => mapRow(row, i, 'row_updated'));
            }
        }

        return { items, lastSeenId: newStateId };
    }

    private async pollGmail(
        config: TriggerNodeConfig,
        since: Date,
        lastSeenId: string,
    ): Promise<{ items: Array<Record<string, unknown>>; lastSeenId: string }> {
        return this.pollEmail(config, since, lastSeenId);
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
