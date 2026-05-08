/**
 * Fluxelle — the in-canvas AI workflow assistant.
 *
 * Architecture:
 *   1. The user sends a message + a compact snapshot of the current workflow.
 *   2. We run an OpenAI chat-completion loop with several tools:
 *        - search_skills(query)
 *        - load_skill(name)
 *        - list_credentials({ provider? })
 *        - list_slack_channels / list_slack_users
 *        - list_teams / list_teams_channels / list_teams_users
 *        - list_gmail_labels
 *        - list_gsheets / list_gsheet_tabs
 *        - list_gdrive_items
 *        - list_basecamp_projects / list_basecamp_todolists / list_basecamp_people
 *        - ask_user({ prompt, options, … })          ← TERMINAL (interactive)
 *        - propose_workflow_changes({ adds, … })     ← TERMINAL (apply diff)
 *   3. The data-fetching tools answer from the credentials repo + provider auth
 *      services so Fluxelle can ground answers in the user's actual environment
 *      (e.g. "you have 2 Slack workspaces, which one?").
 *   4. The two terminal tools end the loop:
 *        - `ask_user` returns a structured question the UI renders as buttons.
 *        - `propose_workflow_changes` returns a diff the UI renders as a card.
 *      Fluxelle never mutates the workflow directly.
 */

import OpenAI from 'openai';
import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
    ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import { SkillRegistry } from '../skills/SkillRegistry';
import type { CredentialRepository } from '../repositories/CredentialRepository';
import type { SlackAuthService } from './SlackAuthService';
import type { GoogleAuthService } from './GoogleAuthService';
import type { TeamsAuthService } from './TeamsAuthService';
import type { BasecampAuthService } from './BasecampAuthService';
import type { WorkflowDefinition, WorkflowNode, NodeType } from '../types/workflow.types';

// ── Public input/output types ─────────────────────────────────────────────────

export interface FluxelleChatMessage {
    role: 'user' | 'assistant';
    content: string;
    /** Optional proposal attached to an assistant turn. */
    proposal?: WorkflowProposal;
    /** Optional structured question attached to an assistant turn. */
    question?: FluxelleQuestion;
    /** When the user has answered a `question`, the picked option ids (and
     *  optional free-text). The model uses this to continue the conversation. */
    questionAnswer?: QuestionAnswer;
}

/** A compact snapshot of the user's current workflow, sent on every turn. */
export interface WorkflowSnapshot {
    id: string;
    name: string;
    nodes: Array<{
        id: string;
        type: NodeType;
        name: string;
        configPreview: string;   // shortened JSON for context efficiency
        next: string[];
    }>;
    entryNodeId: string;
}

/** The structured set of changes Fluxelle wants the canvas to apply. */
export interface WorkflowProposal {
    /** New nodes to add. Each id MUST be unique within the workflow. */
    adds?: ProposedNode[];
    /** Existing nodes whose config / name should be replaced. */
    updates?: Array<{ id: string; name?: string; config?: Record<string, unknown> }>;
    /** Node ids to remove. Edges referencing these are dropped automatically. */
    deletes?: string[];
    /** Directed edges to create between nodes (sourceId → targetId). */
    edges?: Array<{ from: string; to: string; sourceHandle?: string; label?: string }>;
    /** Optional human-readable summary shown above the diff card. */
    explanation?: string;
}

export interface ProposedNode {
    id: string;
    type: NodeType;
    name: string;
    config: Record<string, unknown>;
    /** Optional canvas position; otherwise the frontend auto-lays it out. */
    position?: { x: number; y: number };
}

/** A clarifying question the assistant wants the user to answer via the UI. */
export interface FluxelleQuestion {
    /** A short prompt rendered above the option buttons. */
    prompt: string;
    /** Selectable options. */
    options: Array<{
        id: string;
        label: string;
        /** Optional secondary line shown under the label. */
        description?: string;
    }>;
    /** When true, the UI renders checkboxes + a confirm button. */
    allowMultiple?: boolean;
    /** When true, the UI also shows a free-text input alongside the options. */
    allowFreeText?: boolean;
    /** Optional caption shown under the prompt (e.g. "Tap an option below"). */
    helperText?: string;
}

/** Records the user's answer to a `FluxelleQuestion`. */
export interface QuestionAnswer {
    /** The option ids picked by the user (one for single-select, ≥1 for multi). */
    selectedOptionIds: string[];
    /** Free-text the user typed alongside the options, if any. */
    freeText?: string;
}

export interface FluxelleChatRequest {
    messages: FluxelleChatMessage[];
    workflow?: WorkflowSnapshot | null;
    /** Authenticated platform user — used to scope `list_credentials`. */
    userId?: string;
}

export interface FluxelleChatResponse {
    /** The assistant's text reply. May be empty if a proposal/question carries the message. */
    content: string;
    /** Set when the model called `propose_workflow_changes`. */
    proposal?: WorkflowProposal;
    /** Set when the model called `ask_user`. */
    question?: FluxelleQuestion;
    /** Exposed for debugging — names of skills the agent loaded this turn. */
    skillsUsed: string[];
}

// ── Service ──────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.FLUXELLE_MODEL ?? 'gpt-5.5';
/** Bumped from 6 to 12 — multi-step credential→channel→ask flows now need more hops. */
const MAX_TOOL_HOPS = 12;

/** GPT-5.x and o-series reasoning models don't accept custom temperature
 *  (or other sampling params) — they only run at the model's default.
 *  Mirrors the detection used in `src/llm/providers/OpenAIProvider.ts`. */
const REASONING_MODEL_RE = /^(gpt-5|o\d)/i;

/** Optional dependencies that unlock data-grounding tools. */
export interface FluxelleDataDeps {
    credentialRepo?: CredentialRepository;
    slackAuth?:      SlackAuthService;
    googleAuth?:     GoogleAuthService;
    teamsAuth?:      TeamsAuthService;
    basecampAuth?:   BasecampAuthService;
}

export class FluxelleService {
    private client: OpenAI | null;
    private deps: FluxelleDataDeps;

    constructor(
        private skills: SkillRegistry,
        deps: FluxelleDataDeps = {},
        apiKey?: string,
    ) {
        const key = apiKey ?? process.env.OPENAI_API_KEY;
        this.client = key ? new OpenAI({ apiKey: key }) : null;
        this.deps   = deps;
    }

    isConfigured(): boolean {
        return this.client !== null;
    }

    async chat(req: FluxelleChatRequest): Promise<FluxelleChatResponse> {
        if (!this.client) {
            throw new Error(
                'Fluxelle is not configured. Set OPENAI_API_KEY in your environment.'
            );
        }

        const tools = this.buildTools();
        const messages = this.buildMessages(req);
        const skillsUsed: string[] = [];
        let proposal: WorkflowProposal | undefined;
        let question: FluxelleQuestion | undefined;

        const isReasoningModel = REASONING_MODEL_RE.test(DEFAULT_MODEL);

        for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
            const completion = await this.client.chat.completions.create({
                model: DEFAULT_MODEL,
                // Reasoning models (gpt-5.x, o-series) only support the default
                // temperature; passing 0.3 makes the API return a 400.
                ...(isReasoningModel ? {} : { temperature: 0.3 }),
                messages,
                tools,
                tool_choice: 'auto',
            });

            const choice = completion.choices[0];
            const msg    = choice.message;

            messages.push(msg as ChatCompletionMessageParam);

            const toolCalls = msg.tool_calls ?? [];
            if (toolCalls.length === 0) {
                return {
                    content: msg.content ?? '',
                    proposal,
                    question,
                    skillsUsed,
                };
            }

            for (const call of toolCalls) {
                const result = await this.runTool(call, skillsUsed, req.userId);
                if (result.proposal) proposal = result.proposal;
                if (result.question) question = result.question;

                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify(result.payload),
                });

                if (result.terminal) {
                    const fallback =
                        typeof result.payload.message === 'string' ? result.payload.message : '';
                    return {
                        content: msg.content ?? fallback,
                        proposal,
                        question,
                        skillsUsed,
                    };
                }
            }
        }

        return {
            content:
                "I'm having trouble settling on a final plan. Could you give me a bit more detail about what you want to build?",
            proposal,
            question,
            skillsUsed,
        };
    }

    // ── Tool execution ────────────────────────────────────────────────────────

    private async runTool(
        call: ChatCompletionMessageToolCall,
        skillsUsed: string[],
        userId?: string,
    ): Promise<{
        payload: Record<string, unknown>;
        proposal?: WorkflowProposal;
        question?: FluxelleQuestion;
        terminal?: boolean;
    }> {
        let args: Record<string, unknown> = {};
        try {
            args = (call as any).function?.arguments
                ? JSON.parse((call as any).function.arguments)
                : {};
        } catch {
            return { payload: { error: 'Invalid JSON arguments' } };
        }

        const name = (call as any).function?.name as string | undefined;

        switch (name) {
            // ── Skills catalogue ───────────────────────────────────────────────
            case 'search_skills': {
                const query = String(args.query ?? '');
                const results = this.skills.search(query);
                return { payload: { results } };
            }

            case 'load_skill': {
                const skillName = String(args.name ?? '');
                const skill = this.skills.get(skillName);
                if (!skill) {
                    return { payload: { error: `No skill named "${skillName}"` } };
                }
                if (!skillsUsed.includes(skill.name)) skillsUsed.push(skill.name);
                return {
                    payload: {
                        name:     skill.name,
                        title:    skill.title,
                        nodeType: skill.nodeType,
                        body:     skill.body,
                    },
                };
            }

            // ── Credentials & integrations ─────────────────────────────────────
            case 'list_credentials':
                return { payload: await this.toolListCredentials(args, userId) };

            case 'list_slack_channels':
                return { payload: await this.toolListSlackChannels(args) };

            case 'list_slack_users':
                return { payload: await this.toolListSlackUsers(args) };

            case 'list_teams':
                return { payload: await this.toolListTeams(args) };

            case 'list_teams_channels':
                return { payload: await this.toolListTeamsChannels(args) };

            case 'list_teams_users':
                return { payload: await this.toolListTeamsUsers(args) };

            case 'list_gmail_labels':
                return { payload: await this.toolListGmailLabels(args) };

            case 'list_gsheets':
                return { payload: await this.toolListGsheets(args) };

            case 'list_gsheet_tabs':
                return { payload: await this.toolListGsheetTabs(args) };

            case 'list_gdrive_items':
                return { payload: await this.toolListGdriveItems(args) };

            case 'list_basecamp_projects':
                return { payload: await this.toolListBasecampProjects(args) };

            case 'list_basecamp_todolists':
                return { payload: await this.toolListBasecampTodolists(args) };

            case 'list_basecamp_people':
                return { payload: await this.toolListBasecampPeople(args) };

            // ── Terminal tools ─────────────────────────────────────────────────
            case 'ask_user': {
                const q = sanitizeQuestion(args);
                if (!q) {
                    return {
                        payload: {
                            error:
                                'Invalid ask_user payload — `prompt` and at least one `option` are required.',
                        },
                    };
                }
                return {
                    payload:  { ok: true, message: q.prompt },
                    question: q,
                    terminal: true,
                };
            }

            case 'propose_workflow_changes': {
                const proposal = sanitizeProposal(args);
                return {
                    payload: { ok: true, message: proposal.explanation ?? 'Proposal ready.' },
                    proposal,
                    terminal: true,
                };
            }

            default:
                return { payload: { error: `Unknown tool: ${name}` } };
        }
    }

    // ── Credential / integration data tools ───────────────────────────────────

    private async toolListCredentials(
        args: Record<string, unknown>,
        userId?: string,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.credentialRepo) {
            return { error: 'Credential lookup is not available on this server.' };
        }
        const provider = typeof args.provider === 'string' ? args.provider : undefined;
        const all = await this.deps.credentialRepo.findAll(userId);
        const filtered = provider ? all.filter((c) => c.provider === provider) : all;

        return {
            credentials: filtered.map((c) => ({
                id:        c.id,
                provider:  c.provider,
                label:     c.label,
                email:     c.email,
                scopes:    c.scopes,
                createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
            })),
            count:    filtered.length,
            ...(filtered.length === 0 && {
                hint:
                    `No ${provider ? `${provider} ` : ''}credentials are connected. ` +
                    `Tell the user to open Settings → Credentials and connect ` +
                    `${provider ?? 'an integration'} first.`,
            }),
        };
    }

    private async toolListSlackChannels(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.slackAuth) return { error: 'Slack lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const { WebClient } = await import('@slack/web-api');
            const token  = await this.deps.slackAuth.getToken(credentialId);
            const client = new WebClient(token);

            type ChannelEntry = { id: string; name: string; isPrivate: boolean; isMember: boolean };
            const channels: ChannelEntry[] = [];
            const missingScopes: string[]  = [];

            const fetchPages = async (
                type: 'public_channel' | 'private_channel',
                requiredScope: string,
            ) => {
                let cursor: string | undefined;
                try {
                    do {
                        const page = await client.conversations.list({
                            types:            type,
                            limit:            200,
                            exclude_archived: true,
                            ...(cursor ? { cursor } : {}),
                        });
                        for (const c of page.channels ?? []) {
                            channels.push({
                                id:        c.id!,
                                name:      c.name!,
                                isPrivate: c.is_private ?? false,
                                isMember:  c.is_member  ?? false,
                            });
                        }
                        cursor = page.response_metadata?.next_cursor || undefined;
                    } while (cursor);
                } catch (err: any) {
                    const code: string = err?.data?.error ?? '';
                    if (code === 'missing_scope' || code === 'not_allowed_token_type') {
                        missingScopes.push(requiredScope);
                        return;
                    }
                    throw err;
                }
            };

            await Promise.all([
                fetchPages('public_channel',  'channels:read'),
                fetchPages('private_channel', 'groups:read'),
            ]);

            channels.sort((a, b) => {
                if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            return { channels: channels.slice(0, 200), count: channels.length, missingScopes };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListSlackUsers(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.slackAuth) return { error: 'Slack lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const { WebClient } = await import('@slack/web-api');
            const token  = await this.deps.slackAuth.getToken(credentialId);
            const client = new WebClient(token);

            type UserEntry = { id: string; name: string; realName: string; displayName: string };
            const users: UserEntry[] = [];
            let cursor: string | undefined;
            do {
                const page = await client.users.list({
                    limit: 200,
                    ...(cursor ? { cursor } : {}),
                });
                for (const u of page.members ?? []) {
                    if (u.deleted || u.is_bot || u.id === 'USLACKBOT') continue;
                    users.push({
                        id:          u.id!,
                        name:        u.name!,
                        realName:    u.real_name  ?? u.name!,
                        displayName: u.profile?.display_name || u.real_name || u.name!,
                    });
                }
                cursor = page.response_metadata?.next_cursor || undefined;
            } while (cursor);

            users.sort((a, b) =>
                (a.displayName || a.name).localeCompare(b.displayName || b.name)
            );

            return { users: users.slice(0, 200), count: users.length };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListTeams(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.teamsAuth) return { error: 'Teams lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const { Client } = await import('@microsoft/microsoft-graph-client');
            const token  = await this.deps.teamsAuth.getToken(credentialId);
            const client = Client.init({ authProvider: (done) => done(null, token) });

            const res = await client
                .api('/me/joinedTeams')
                .select('id,displayName,description')
                .get() as { value: Array<Record<string, unknown>> };

            const teams = (res.value ?? []).map((t) => ({
                id:          t.id as string,
                displayName: t.displayName as string,
                description: (t.description as string | null) ?? null,
            }));
            teams.sort((a, b) => a.displayName.localeCompare(b.displayName));

            return { teams, count: teams.length };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListTeamsChannels(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.teamsAuth) return { error: 'Teams lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        const teamId       = String(args.teamId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };
        if (!teamId)       return { error: 'teamId is required.' };

        try {
            const { Client } = await import('@microsoft/microsoft-graph-client');
            const token  = await this.deps.teamsAuth.getToken(credentialId);
            const client = Client.init({ authProvider: (done) => done(null, token) });

            const res = await client
                .api(`/teams/${teamId}/channels`)
                .select('id,displayName,membershipType')
                .get() as { value: Array<Record<string, unknown>> };

            const channels = (res.value ?? []).map((c) => ({
                id:             c.id as string,
                displayName:    c.displayName as string,
                membershipType: (c.membershipType as string) ?? 'standard',
            }));
            channels.sort((a, b) => {
                if (a.displayName === 'General') return -1;
                if (b.displayName === 'General') return  1;
                return a.displayName.localeCompare(b.displayName);
            });

            return { channels, count: channels.length };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListTeamsUsers(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.teamsAuth) return { error: 'Teams lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const { Client } = await import('@microsoft/microsoft-graph-client');
            const token  = await this.deps.teamsAuth.getToken(credentialId);
            const client = Client.init({ authProvider: (done) => done(null, token) });

            const res = await client
                .api('/users')
                .select('id,displayName,mail,userPrincipalName')
                .top(100)
                .get() as { value: Array<Record<string, unknown>> };

            const users = (res.value ?? []).map((u) => ({
                id:                u.id as string,
                displayName:       (u.displayName as string) ?? '',
                mail:              (u.mail as string) ?? '',
                userPrincipalName: (u.userPrincipalName as string) ?? '',
            }));
            users.sort((a, b) => a.displayName.localeCompare(b.displayName));

            return { users: users.slice(0, 200), count: users.length };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListGmailLabels(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.googleAuth) return { error: 'Google lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const { google } = await import('googleapis');
            const auth  = await this.deps.googleAuth.getAuthenticatedClient(credentialId);
            const gmail = google.gmail({ version: 'v1', auth });
            const res   = await gmail.users.labels.list({ userId: 'me' });

            const labels = (res.data.labels ?? []).map((l) => ({
                id:   l.id   ?? '',
                name: l.name ?? '',
                type: l.type ?? 'user',
            }));
            labels.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'system' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            return { labels, count: labels.length };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListGsheets(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.googleAuth) return { error: 'Google lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const { google } = await import('googleapis');
            const auth  = await this.deps.googleAuth.getAuthenticatedClient(credentialId);
            const drive = google.drive({ version: 'v3', auth });

            const files: Array<{ id: string; name: string; modifiedTime: string | null }> = [];
            let pageToken: string | undefined;
            // Cap at 5 pages (up to 1000 sheets) to keep the tool response small.
            for (let i = 0; i < 5; i++) {
                const res = await drive.files.list({
                    q:                         "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
                    pageSize:                  200,
                    fields:                    'nextPageToken,files(id,name,modifiedTime)',
                    orderBy:                   'modifiedTime desc',
                    includeItemsFromAllDrives: true,
                    supportsAllDrives:         true,
                    corpora:                   'allDrives',
                    ...(pageToken ? { pageToken } : {}),
                });
                for (const f of res.data.files ?? []) {
                    files.push({ id: f.id!, name: f.name!, modifiedTime: f.modifiedTime ?? null });
                }
                pageToken = res.data.nextPageToken ?? undefined;
                if (!pageToken) break;
            }

            return { spreadsheets: files.slice(0, 200), count: files.length };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListGsheetTabs(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.googleAuth) return { error: 'Google lookup unavailable.' };
        const credentialId  = String(args.credentialId ?? '');
        const spreadsheetId = String(args.spreadsheetId ?? '');
        if (!credentialId)  return { error: 'credentialId is required.' };
        if (!spreadsheetId) return { error: 'spreadsheetId is required.' };

        try {
            const { google } = await import('googleapis');
            const auth   = await this.deps.googleAuth.getAuthenticatedClient(credentialId);
            const sheets = google.sheets({ version: 'v4', auth });
            const res    = await sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets(properties(sheetId,title,index))',
            });

            const tabs = (res.data.sheets ?? [])
                .sort((a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0))
                .map((s) => ({
                    id:    s.properties?.sheetId ?? 0,
                    title: s.properties?.title   ?? '',
                    index: s.properties?.index   ?? 0,
                }));

            return { tabs, count: tabs.length };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListGdriveItems(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.googleAuth) return { error: 'Google lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        const folderId     = typeof args.folderId === 'string' ? args.folderId : 'root';
        const type         = typeof args.type === 'string' ? args.type : 'all';
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const { google } = await import('googleapis');
            const auth   = await this.deps.googleAuth.getAuthenticatedClient(credentialId);
            const drive  = google.drive({ version: 'v3', auth });
            const parent = folderId === 'root' ? 'root' : folderId;

            let q = `'${parent}' in parents and trashed = false`;
            if (type === 'folders') q += ` and mimeType = 'application/vnd.google-apps.folder'`;
            if (type === 'files')   q += ` and mimeType != 'application/vnd.google-apps.folder'`;

            const res = await drive.files.list({
                q,
                pageSize:                  100,
                fields:                    'files(id,name,mimeType,modifiedTime)',
                orderBy:                   'folder,name',
                includeItemsFromAllDrives: true,
                supportsAllDrives:         true,
            });
            const items = (res.data.files ?? []).map((f) => ({
                id:           f.id!,
                name:         f.name!,
                mimeType:     f.mimeType ?? '',
                modifiedTime: f.modifiedTime ?? null,
            }));

            return { items, count: items.length, folderId: parent };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListBasecampProjects(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.basecampAuth) return { error: 'Basecamp lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const projects = await this.basecampFetchAll(credentialId, '/projects.json');
            return {
                projects: projects.map((p) => ({
                    id:          p.id,
                    name:        p.name,
                    description: p.description ?? '',
                })),
                count: projects.length,
            };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListBasecampTodolists(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.basecampAuth) return { error: 'Basecamp lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        const projectId    = String(args.projectId ?? '');
        if (!credentialId) return { error: 'credentialId is required.' };
        if (!projectId)    return { error: 'projectId is required.' };

        try {
            const project = await this.basecampFetchOne(credentialId, `/projects/${projectId}.json`) as {
                dock?: Array<{ name: string; id: number; enabled: boolean }>;
            };
            const todoset = project.dock?.find((d) => d.name === 'todoset' && d.enabled);
            if (!todoset) return { todolists: [], count: 0 };

            const todolists = await this.basecampFetchAll(
                credentialId,
                `/todosets/${todoset.id}/todolists.json`,
            );
            return {
                todolists: todolists.map((tl) => ({
                    id:             tl.id,
                    name:           tl.name ?? tl.title,
                    todosRemaining: tl.todos_remaining ?? 0,
                })),
                count: todolists.length,
            };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async toolListBasecampPeople(
        args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.deps.basecampAuth) return { error: 'Basecamp lookup unavailable.' };
        const credentialId = String(args.credentialId ?? '');
        const projectId    = typeof args.projectId === 'string' ? args.projectId : undefined;
        if (!credentialId) return { error: 'credentialId is required.' };

        try {
            const path = projectId
                ? `/projects/${projectId}/people.json`
                : '/people.json';
            const people = await this.basecampFetchAll(credentialId, path);
            return {
                people: people.map((p) => ({
                    id:      p.id,
                    name:    p.name,
                    email:   p.email_address ?? '',
                    company: (p.company as Record<string, unknown>)?.name ?? null,
                })),
                count: people.length,
            };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    /** Fetch a single Basecamp endpoint (no pagination). */
    private async basecampFetchOne(credentialId: string, path: string): Promise<Record<string, unknown>> {
        const auth = this.deps.basecampAuth!;
        const token     = await auth.getToken(credentialId);
        const accountId = await auth.getAccountId(credentialId);
        const res = await fetch(`https://3.basecampapi.com/${accountId}${path}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent':  'WorkflowAutomationPlatform (fluxelle)',
            },
        });
        if (!res.ok) throw new Error(`Basecamp API ${res.status}: ${await res.text()}`);
        return res.json() as Promise<Record<string, unknown>>;
    }

    /** Fetch a paginated Basecamp list endpoint, capped at 500 results. */
    private async basecampFetchAll(credentialId: string, path: string): Promise<Array<Record<string, unknown>>> {
        const auth = this.deps.basecampAuth!;
        const token     = await auth.getToken(credentialId);
        const accountId = await auth.getAccountId(credentialId);
        let nextUrl: string | null = `https://3.basecampapi.com/${accountId}${path}`;
        const out: Array<Record<string, unknown>> = [];

        while (nextUrl && out.length < 500) {
            const res: Response = await fetch(nextUrl, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent':  'WorkflowAutomationPlatform (fluxelle)',
                },
            });
            if (!res.ok) throw new Error(`Basecamp API ${res.status}: ${await res.text()}`);
            const page = await res.json() as Array<Record<string, unknown>>;
            out.push(...page);

            const link = res.headers.get('Link') ?? '';
            const next = link.match(/<([^>]+)>;\s*rel="next"/);
            nextUrl = next ? next[1] : null;
        }
        return out;
    }

    // ── Prompt + tool definitions ─────────────────────────────────────────────

    private buildMessages(req: FluxelleChatRequest): ChatCompletionMessageParam[] {
        const skillIndex = this.skills.listSummaries();

        const indexBlock = skillIndex
            .map((s) => `- ${s.name} [${s.category}] — ${s.summary}`)
            .join('\n');

        const workflowBlock = req.workflow
            ? renderWorkflowSnapshot(req.workflow)
            : '_No workflow is open. Suggest creating one if appropriate._';

        const system = [
            'You are **Fluxelle**, the in-canvas AI assistant for Flux Workflow — a',
            'visual workflow automation platform. Your job is to help the user design,',
            'build, and edit workflows by proposing concrete node-level changes.',
            '',
            '## How you work',
            '1. Read the user\'s message and the current workflow snapshot below.',
            '2. If you need detail about a node type, call `search_skills` then `load_skill`.',
            '3. If you need to know what credentials / channels / sheets / projects the user',
            '   actually has, call the appropriate `list_*` data tool. NEVER guess ids and',
            '   NEVER ask the user to type an id you could look up yourself.',
            '4. If the user must choose between multiple options (e.g. which Slack workspace,',
            '   which channel, which sheet), call `ask_user` with a clear `prompt` and a',
            '   selectable `options` list. This is a TERMINAL tool — the loop ends, the user',
            '   picks an option in the UI, and their reply will arrive on the next turn.',
            '5. When you\'re ready to suggest workflow changes, call `propose_workflow_changes`',
            '   with `adds`, `updates`, `deletes`, and `edges` describing the EXACT diff.',
            '   This is the OTHER terminal tool — after you call it, the loop ends and the',
            '   user reviews the diff before anything is applied.',
            '',
            '## Critical rules',
            '- NEVER leave `credentialId: ""` on a node config. Resolve it first via',
            '  `list_credentials({ provider })` and either pick the only match automatically',
            '  or ask the user with `ask_user` when there are multiple.',
            '- For Slack/Teams channels, sheets, Drive folders, Basecamp projects, etc. —',
            '  prefer resolving real ids via the `list_*` tools and surfacing them as',
            '  `ask_user` options instead of asking the user to paste raw ids or names.',
            '- Always reference earlier-node output via `{{ nodes.<id>.output.<field> }}`.',
            '- Use kebab-case ids that hint at the node\'s purpose: `trigger-1`, `llm-summarize`, `slack-notify`.',
            '- For condition nodes, set `trueNext` / `falseNext` in the config — DO NOT also list them in `next`.',
            '- For switch nodes, set each case\'s `next` and `defaultNext` — leave the top-level `next` empty.',
            '- For all other node types, populate the `edges` array to wire them up.',
            '- Be concise. Skip filler. Lead with the change you\'re proposing, not pleasantries.',
            '- If a previous assistant turn asked a question and the user picked an option,',
            '  treat that pick as authoritative and continue building the proposal.',
            '',
            '## Skills catalogue',
            indexBlock,
            '',
            '## Current workflow',
            workflowBlock,
        ].join('\n');

        const turns: ChatCompletionMessageParam[] = req.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        return [{ role: 'system', content: system }, ...turns];
    }

    private buildTools(): ChatCompletionTool[] {
        const tools: ChatCompletionTool[] = [
            {
                type: 'function',
                function: {
                    name: 'search_skills',
                    description:
                        'Search the Flux Skills catalogue by intent or keyword. Returns matching skills (name, title, summary, when_to_use). Use this BEFORE proposing changes if you need to confirm config shape.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description:
                                    'Plain-language description of the capability you need (e.g. "send slack message", "schedule cron").',
                            },
                        },
                        required: ['query'],
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'load_skill',
                    description:
                        'Fetch the full details (config schema, examples, tips) for a specific skill by name. Call this after search_skills when you need exact field names.',
                    parameters: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'The kebab-case skill name returned by search_skills.',
                            },
                        },
                        required: ['name'],
                    },
                },
            },
        ];

        if (this.deps.credentialRepo) {
            tools.push({
                type: 'function',
                function: {
                    name: 'list_credentials',
                    description:
                        'List the user\'s connected credentials (OAuth tokens / API keys). Filter by provider when you only need one type. ALWAYS call this before leaving a `credentialId` field blank or asking the user for it.',
                    parameters: {
                        type: 'object',
                        properties: {
                            provider: {
                                type: 'string',
                                enum: ['google', 'slack', 'teams', 'basecamp'],
                                description: 'Optional — filter to one provider.',
                            },
                        },
                        additionalProperties: false,
                    },
                },
            });
        }

        if (this.deps.slackAuth) {
            tools.push(
                {
                    type: 'function',
                    function: {
                        name: 'list_slack_channels',
                        description:
                            'List Slack channels visible to the given Slack credential. Use this before proposing a Slack node so you can present real channels to the user.',
                        parameters: {
                            type: 'object',
                            properties: { credentialId: { type: 'string' } },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
                {
                    type: 'function',
                    function: {
                        name: 'list_slack_users',
                        description: 'List active (non-bot) Slack users for DM targeting.',
                        parameters: {
                            type: 'object',
                            properties: { credentialId: { type: 'string' } },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
            );
        }

        if (this.deps.teamsAuth) {
            tools.push(
                {
                    type: 'function',
                    function: {
                        name: 'list_teams',
                        description: 'List Microsoft Teams the user is a member of.',
                        parameters: {
                            type: 'object',
                            properties: { credentialId: { type: 'string' } },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
                {
                    type: 'function',
                    function: {
                        name: 'list_teams_channels',
                        description: 'List channels inside a specific Microsoft Team.',
                        parameters: {
                            type: 'object',
                            properties: {
                                credentialId: { type: 'string' },
                                teamId:       { type: 'string' },
                            },
                            required: ['credentialId', 'teamId'],
                            additionalProperties: false,
                        },
                    },
                },
                {
                    type: 'function',
                    function: {
                        name: 'list_teams_users',
                        description: 'List users in the Microsoft 365 organisation (for DMs).',
                        parameters: {
                            type: 'object',
                            properties: { credentialId: { type: 'string' } },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
            );
        }

        if (this.deps.googleAuth) {
            tools.push(
                {
                    type: 'function',
                    function: {
                        name: 'list_gmail_labels',
                        description: 'List Gmail labels (system + user) for the connected Google credential.',
                        parameters: {
                            type: 'object',
                            properties: { credentialId: { type: 'string' } },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
                {
                    type: 'function',
                    function: {
                        name: 'list_gsheets',
                        description: 'List Google Sheets accessible to the credential, most-recently-modified first.',
                        parameters: {
                            type: 'object',
                            properties: { credentialId: { type: 'string' } },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
                {
                    type: 'function',
                    function: {
                        name: 'list_gsheet_tabs',
                        description: 'List the sheet tabs inside a specific spreadsheet.',
                        parameters: {
                            type: 'object',
                            properties: {
                                credentialId:  { type: 'string' },
                                spreadsheetId: { type: 'string' },
                            },
                            required: ['credentialId', 'spreadsheetId'],
                            additionalProperties: false,
                        },
                    },
                },
                {
                    type: 'function',
                    function: {
                        name: 'list_gdrive_items',
                        description: 'Browse Google Drive folder contents. Defaults to "root" (My Drive).',
                        parameters: {
                            type: 'object',
                            properties: {
                                credentialId: { type: 'string' },
                                folderId:     { type: 'string' },
                                type:         { type: 'string', enum: ['files', 'folders', 'all'] },
                            },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
            );
        }

        if (this.deps.basecampAuth) {
            tools.push(
                {
                    type: 'function',
                    function: {
                        name: 'list_basecamp_projects',
                        description: 'List Basecamp projects accessible to the credential.',
                        parameters: {
                            type: 'object',
                            properties: { credentialId: { type: 'string' } },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
                {
                    type: 'function',
                    function: {
                        name: 'list_basecamp_todolists',
                        description: 'List the to-do lists inside a Basecamp project.',
                        parameters: {
                            type: 'object',
                            properties: {
                                credentialId: { type: 'string' },
                                projectId:    { type: 'string' },
                            },
                            required: ['credentialId', 'projectId'],
                            additionalProperties: false,
                        },
                    },
                },
                {
                    type: 'function',
                    function: {
                        name: 'list_basecamp_people',
                        description: 'List people on the Basecamp account, optionally scoped to a project.',
                        parameters: {
                            type: 'object',
                            properties: {
                                credentialId: { type: 'string' },
                                projectId:    { type: 'string' },
                            },
                            required: ['credentialId'],
                            additionalProperties: false,
                        },
                    },
                },
            );
        }

        tools.push(
            {
                type: 'function',
                function: {
                    name: 'ask_user',
                    description:
                        'TERMINAL TOOL. Ask the user a clarifying question with selectable options. Use this whenever the user must pick from a known set (credential, channel, sheet, etc.) — NEVER make them type ids by hand. After this call the loop ends; the user picks an option in the UI and the next turn carries their answer.',
                    parameters: {
                        type: 'object',
                        properties: {
                            prompt: {
                                type: 'string',
                                description: 'The question text shown to the user.',
                            },
                            helperText: {
                                type: 'string',
                                description: 'Optional caption shown below the prompt.',
                            },
                            options: {
                                type: 'array',
                                minItems: 1,
                                description: 'The selectable options. Always supply human-readable labels.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        id:          { type: 'string', description: 'Stable id used to identify the choice on the next turn.' },
                                        label:       { type: 'string', description: 'Primary text shown on the button.' },
                                        description: { type: 'string', description: 'Optional secondary line under the label.' },
                                    },
                                    required: ['id', 'label'],
                                    additionalProperties: false,
                                },
                            },
                            allowMultiple: {
                                type: 'boolean',
                                description: 'When true the UI renders checkboxes + a confirm button.',
                            },
                            allowFreeText: {
                                type: 'boolean',
                                description: 'When true the UI also shows a free-text input alongside the options.',
                            },
                        },
                        required: ['prompt', 'options'],
                        additionalProperties: false,
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'propose_workflow_changes',
                    description:
                        'TERMINAL TOOL. Call this once when you have a complete plan. The user will see a diff and decide whether to apply it. After this call, your loop ends.',
                    parameters: {
                        type: 'object',
                        properties: {
                            explanation: {
                                type: 'string',
                                description: 'A 1-2 sentence summary of what this change does, shown above the diff.',
                            },
                            adds: {
                                type: 'array',
                                description: 'New nodes to add to the workflow.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        id:     { type: 'string' },
                                        type:   {
                                            type: 'string',
                                            enum: [...VALID_NODE_TYPES],
                                            description: 'The exact node type. Must be one of the listed enum values — do NOT use skill names here.',
                                        },
                                        name:   { type: 'string' },
                                        config: { type: 'object', additionalProperties: true },
                                    },
                                    required: ['id', 'type', 'name', 'config'],
                                    additionalProperties: false,
                                },
                            },
                            updates: {
                                type: 'array',
                                description: 'Existing nodes to modify (by id).',
                                items: {
                                    type: 'object',
                                    properties: {
                                        id:     { type: 'string' },
                                        name:   { type: 'string' },
                                        config: { type: 'object', additionalProperties: true },
                                    },
                                    required: ['id'],
                                    additionalProperties: false,
                                },
                            },
                            deletes: {
                                type: 'array',
                                description: 'Node ids to delete.',
                                items: { type: 'string' },
                            },
                            edges: {
                                type: 'array',
                                description: 'Directed connections between nodes. For condition / switch nodes, prefer setting the routing fields in the node config and omit edges for those.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        from:         { type: 'string' },
                                        to:           { type: 'string' },
                                        sourceHandle: { type: 'string' },
                                        label:        { type: 'string' },
                                    },
                                    required: ['from', 'to'],
                                    additionalProperties: false,
                                },
                            },
                        },
                        additionalProperties: false,
                    },
                },
            },
        );

        return tools;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Canonical list of node types accepted by the backend schema. */
const VALID_NODE_TYPES = new Set<string>([
    'trigger', 'llm', 'http', 'condition', 'switch', 'transform', 'extract',
    'output', 'code', 'loop', 'formatter', 'gmail', 'gdrive', 'gdocs', 'gsheets',
    'slack', 'teams', 'basecamp',
]);

function renderWorkflowSnapshot(wf: WorkflowSnapshot): string {
    if (wf.nodes.length === 0) return '_(empty canvas — no nodes yet)_';

    const lines = [
        `**${wf.name}** (id: \`${wf.id}\`, entry: \`${wf.entryNodeId || '—'}\`)`,
        'Nodes:',
        ...wf.nodes.map(
            (n) =>
                `- \`${n.id}\` [${n.type}] "${n.name}" → next: [${n.next.join(', ')}] · config: ${n.configPreview}`,
        ),
    ];
    return lines.join('\n');
}

/** Build the compact snapshot the agent receives. */
export function buildWorkflowSnapshot(wf: WorkflowDefinition | null | undefined): WorkflowSnapshot | null {
    if (!wf) return null;
    return {
        id:    wf.id,
        name:  wf.name,
        entryNodeId: wf.entryNodeId,
        nodes: wf.nodes.map((n) => ({
            id:   n.id,
            type: n.type,
            name: n.name,
            next: n.next ?? [],
            configPreview: shortJson(n.config),
        })),
    };
}

function shortJson(obj: Record<string, unknown>, max = 240): string {
    let s: string;
    try { s = JSON.stringify(obj); } catch { return '{ … }'; }
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Type-guard the model's proposal into the shape the frontend expects. */
function sanitizeProposal(args: Record<string, unknown>): WorkflowProposal {
    const proposal: WorkflowProposal = {};

    if (typeof args.explanation === 'string') proposal.explanation = args.explanation;

    if (Array.isArray(args.adds)) {
        proposal.adds = args.adds
            .filter((n) => n && typeof n === 'object')
            .map((n: any) => ({
                id:       String(n.id ?? ''),
                type:     n.type as NodeType,
                name:     String(n.name ?? n.id ?? 'New Node'),
                config:   (n.config && typeof n.config === 'object') ? n.config : {},
                position: n.position && typeof n.position === 'object'
                    ? { x: Number(n.position.x) || 0, y: Number(n.position.y) || 0 }
                    : undefined,
            }))
            .filter((n: any) => {
                if (!n.id || !n.type) return false;
                if (!VALID_NODE_TYPES.has(n.type)) {
                    console.warn(
                        `[Fluxelle] Dropping proposed node "${n.id}" — unknown type "${n.type}". ` +
                        `Valid types: ${[...VALID_NODE_TYPES].join(', ')}`
                    );
                    return false;
                }
                return true;
            });
    }

    if (Array.isArray(args.updates)) {
        proposal.updates = args.updates
            .filter((u) => u && typeof u === 'object' && (u as any).id)
            .map((u: any) => ({
                id:     String(u.id),
                name:   typeof u.name === 'string' ? u.name : undefined,
                config: u.config && typeof u.config === 'object' ? u.config : undefined,
            }));
    }

    if (Array.isArray(args.deletes)) {
        proposal.deletes = args.deletes.filter((d) => typeof d === 'string') as string[];
    }

    if (Array.isArray(args.edges)) {
        proposal.edges = args.edges
            .filter((e) => e && typeof e === 'object' && (e as any).from && (e as any).to)
            .map((e: any) => ({
                from:         String(e.from),
                to:           String(e.to),
                sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined,
                label:        typeof e.label === 'string' ? e.label : undefined,
            }));
    }

    return proposal;
}

/** Type-guard the model's `ask_user` payload — returns null if invalid. */
function sanitizeQuestion(args: Record<string, unknown>): FluxelleQuestion | null {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) return null;

    const rawOpts = Array.isArray(args.options) ? args.options : [];
    const options = rawOpts
        .filter((o) => o && typeof o === 'object')
        .map((o: any) => ({
            id:          String(o.id ?? '').trim(),
            label:       String(o.label ?? '').trim(),
            description: typeof o.description === 'string' ? o.description : undefined,
        }))
        .filter((o) => o.id && o.label);

    if (options.length === 0) return null;

    return {
        prompt,
        options,
        helperText:    typeof args.helperText === 'string' ? args.helperText : undefined,
        allowMultiple: Boolean(args.allowMultiple),
        allowFreeText: Boolean(args.allowFreeText),
    };
}

// Re-export for caller convenience
export type { WorkflowNode };
