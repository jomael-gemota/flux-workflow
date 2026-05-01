import { WebClient } from '@slack/web-api';
import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { SlackAuthService } from '../services/SlackAuthService';
import { ExpressionResolver } from '../engine/ExpressionResolver';
import { readStagedFile } from '../routes/fileRoutes';

type SlackAction =
    | 'send_message'
    | 'send_dm'
    | 'upload_file'
    | 'read_messages'
    | 'read_thread'
    | 'list_users'
    | 'list_channels';

interface SlackConfig {
    credentialId: string;
    action: SlackAction;
    /** Who sends the message: 'bot' = Flux Bot, 'user' = connected Slack account (default) */
    senderType?: 'bot' | 'user';
    // send_message — one or more channels (comma-separated IDs / names)
    channels?: string;
    channel?: string;           // legacy single-channel field
    // send_dm — one or more users (comma-separated IDs)
    userIds?: string;
    userId?: string;            // legacy single-user field
    text?: string;
    // upload_file
    uploadSource?: 'content' | 'local' | 'node' | 'staged';
    filename?: string;
    fileContent?: string;       // text / expression source
    uploadData?: string;        // base64 (local upload or node expression)
    uploadMimeType?: string;
    stagedFileId?: string;      // reference from /api/files/stage
    shareTarget?: 'channel' | 'dm' | 'none';
    uploadUserId?: string;      // user for DM target
    // read_messages
    readSource?: 'channel' | 'dm';
    readUserId?: string;        // user to open DM with when readSource === 'dm'
    limit?: number;
    // list_channels
    channelFilter?: 'all' | 'public' | 'private';
    // read_thread
    threadTs?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a unix timestamp string ("1715000000.123456") to a human-readable label. */
function formatSlackTs(ts: string): string {
    const ms = parseFloat(ts) * 1000;
    if (isNaN(ms)) return ts;
    const d = new Date(ms);
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${date} at ${time}`;
}

/** Split a comma-separated string into a trimmed, non-empty array. */
function splitIds(raw: string): string[] {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ── SlackNode ─────────────────────────────────────────────────────────────────

export class SlackNode implements NodeExecutor {
    private slackAuth: SlackAuthService;
    private resolver = new ExpressionResolver();

    constructor(slackAuth: SlackAuthService) {
        this.slackAuth = slackAuth;
    }

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as SlackConfig;
        const { credentialId, action } = config;

        if (!credentialId) throw new Error('Slack node: credentialId is required');
        if (!action)       throw new Error('Slack node: action is required');

        const isSendAction = action === 'send_message' || action === 'send_dm';
        const useFluxBot   = isSendAction && config.senderType === 'bot';
        const token  = useFluxBot
            ? await this.slackAuth.getFluxBotToken(credentialId)
            : await this.slackAuth.getToken(credentialId);
        const client = new WebClient(token);

        // ── Send Message to Channel(s) ────────────────────────────────────────
        if (action === 'send_message') {
            const rawChannels = this.resolver.resolveTemplate(
                config.channels ?? config.channel ?? '', context
            );
            const text = this.resolver.resolveTemplate(config.text ?? '', context);

            if (!rawChannels) throw new Error('Slack send_message: at least one channel is required');
            if (!text)        throw new Error('Slack send_message: message text is required');

            const channelList = splitIds(rawChannels);
            const results = await Promise.all(
                channelList.map(async (channel) => {
                    const res = await client.chat.postMessage({ channel, text });
                    return { ok: res.ok, ts: res.ts, channel: res.channel, messageId: res.ts };
                })
            );

            return channelList.length === 1 ? results[0] : { ok: true, results };
        }

        // ── Send Direct Message to User(s) ────────────────────────────────────
        if (action === 'send_dm') {
            const rawUsers = this.resolver.resolveTemplate(
                config.userIds ?? config.userId ?? '', context
            );
            const text = this.resolver.resolveTemplate(config.text ?? '', context);

            if (!rawUsers) throw new Error('Slack send_dm: at least one user is required');
            if (!text)     throw new Error('Slack send_dm: message text is required');

            const userList = splitIds(rawUsers);
            const results = await Promise.all(
                userList.map(async (userId) => {
                    const conv = await client.conversations.open({ users: userId });
                    if (!conv.ok || !conv.channel?.id) {
                        throw new Error(`Slack send_dm: failed to open DM with user "${userId}"`);
                    }
                    const res = await client.chat.postMessage({ channel: conv.channel.id, text });
                    return { ok: res.ok, ts: res.ts, channel: res.channel, messageId: res.ts, userId };
                })
            );

            return userList.length === 1 ? results[0] : { ok: true, results };
        }

        // ── Upload File ───────────────────────────────────────────────────────
        if (action === 'upload_file') {
            const filename     = this.resolver.resolveTemplate(config.filename ?? 'file.txt', context);
            const uploadSource = config.uploadSource ?? 'content';
            const shareTarget  = config.shareTarget  ?? 'channel';

            // ── Resolve file bytes ────────────────────────────────────────────
            let fileBytes: Buffer;
            let mimeType = config.uploadMimeType ?? 'application/octet-stream';

            if (uploadSource === 'staged') {
                // File was pre-uploaded via /api/files/stage to avoid bloating the workflow config.
                // The staged file persists until its 24-hour TTL expires so the same config can be
                // tested and re-run multiple times without re-attaching.
                if (!config.stagedFileId) throw new Error('Slack upload_file: stagedFileId is required for staged source');
                const staged = await readStagedFile(config.stagedFileId);
                if (!staged) throw new Error(
                    'Slack upload_file: staged file not found or has expired (files are kept for 24 hours). ' +
                    'Please re-attach the file in the node configuration and save again.'
                );
                fileBytes = staged.buffer;
                mimeType  = config.uploadMimeType ?? staged.mimeType;

            } else if (uploadSource === 'local' || uploadSource === 'node') {
                // Legacy / expression-driven base64
                const rawData = this.resolver.resolveTemplate(config.uploadData ?? '', context);
                if (!rawData) throw new Error('Slack upload_file: uploadData (base64) is required');
                const b64   = rawData.includes(',') ? rawData.split(',')[1] : rawData;
                fileBytes   = Buffer.from(b64, 'base64');
                const prefix = rawData.match(/^data:([^;]+);/);
                if (prefix) mimeType = prefix[1];

            } else {
                // 'content' — plain text / expression
                const fileContent = this.resolver.resolveTemplate(config.fileContent ?? '', context);
                if (!fileContent) throw new Error('Slack upload_file: fileContent is required');
                fileBytes = Buffer.from(fileContent, 'utf-8');
                mimeType  = 'text/plain';
            }

            // ── Resolve share target ──────────────────────────────────────────
            let channelId: string | undefined;

            if (shareTarget === 'channel') {
                const raw = this.resolver.resolveTemplate(config.channel ?? config.channels ?? '', context);
                channelId = raw || undefined;

            } else if (shareTarget === 'dm') {
                const userId = this.resolver.resolveTemplate(config.uploadUserId ?? '', context);
                if (!userId) throw new Error('Slack upload_file: uploadUserId is required for DM target');
                const conv = await client.conversations.open({ users: userId });
                if (!conv.ok || !conv.channel?.id) {
                    throw new Error(`Slack upload_file: failed to open DM with user "${userId}"`);
                }
                channelId = conv.channel.id;
            }
            // shareTarget === 'none': upload privately (no channel)

            // ── Slack upload flow ─────────────────────────────────────────────
            const uploadRes = await client.files.getUploadURLExternal({
                filename,
                length: fileBytes.length,
            });

            if (!uploadRes.ok || !uploadRes.upload_url || !uploadRes.file_id) {
                throw new Error('Slack upload_file: failed to get upload URL');
            }

            await fetch(uploadRes.upload_url, {
                method:  'POST',
                headers: { 'Content-Type': mimeType },
                body:    new Uint8Array(fileBytes),
            });

            const completeParams: Parameters<typeof client.files.completeUploadExternal>[0] = {
                files: [{ id: uploadRes.file_id, title: filename }],
                ...(channelId ? { channel_id: channelId } : {}),
            };
            const completeRes = await client.files.completeUploadExternal(completeParams);

            return {
                ok:       completeRes.ok,
                fileId:   uploadRes.file_id,
                filename,
                mimeType,
                sharedTo: channelId ?? null,
            };
        }

        // ── Read Messages ─────────────────────────────────────────────────────
        if (action === 'read_messages') {
            const limit      = config.limit ?? 20;
            const readSource = config.readSource ?? 'channel';
            let channelId: string;

            if (readSource === 'dm') {
                const targetUser = this.resolver.resolveTemplate(config.readUserId ?? '', context);
                if (!targetUser) throw new Error('Slack read_messages: readUserId is required for DM source');
                const conv = await client.conversations.open({ users: targetUser });
                if (!conv.ok || !conv.channel?.id) {
                    throw new Error(`Slack read_messages: failed to open DM with user "${targetUser}"`);
                }
                channelId = conv.channel.id;
            } else {
                channelId = this.resolver.resolveTemplate(config.channel ?? config.channels ?? '', context);
                if (!channelId) throw new Error('Slack read_messages: channel is required');
            }

            const res = await client.conversations.history({ channel: channelId, limit });
            const rawMessages = (res.messages ?? []) as Array<Record<string, unknown>>;

            // Collect unique user IDs so we can resolve display names in one pass
            const userIds = new Set<string>();
            for (const m of rawMessages) {
                if (typeof m.user === 'string') userIds.add(m.user);
                if (typeof m.bot_id === 'string') userIds.add(m.bot_id);
            }

            // Fetch user display names (best-effort — missing IDs are silently skipped)
            const nameMap: Record<string, string> = {};
            await Promise.all(
                [...userIds].map(async (id) => {
                    try {
                        const info = await client.users.info({ user: id });
                        if (info.ok && info.user) {
                            nameMap[id] =
                                info.user.profile?.display_name ||
                                info.user.real_name ||
                                info.user.name ||
                                id;
                        }
                    } catch {
                        // ignore — will fall back to raw ID
                    }
                })
            );

            // Slack returns newest-first; reverse for oldest→newest (top→bottom) display
            const messages = [...rawMessages].reverse().map((m) => {
                const userId    = typeof m.user === 'string' ? m.user : undefined;
                const botId     = typeof m.bot_id === 'string' ? m.bot_id : undefined;
                const senderId  = userId ?? botId;
                const senderName = senderId ? (nameMap[senderId] ?? senderId) : 'Unknown';

                // File / attachment detection
                const files       = Array.isArray(m.files) ? m.files as Array<Record<string, unknown>> : [];
                const attachments = Array.isArray(m.attachments) ? m.attachments as Array<Record<string, unknown>> : [];
                const hasFiles    = files.length > 0 || attachments.length > 0;

                const fileDetails = files.map((f) => ({
                    id:       f.id,
                    name:     f.name,
                    mimeType: f.mimetype,
                    url:      f.url_private ?? f.permalink,
                    isImage:  typeof f.mimetype === 'string' && f.mimetype.startsWith('image/'),
                }));

                const ts        = typeof m.ts === 'string' ? m.ts : undefined;
                const formatted = ts ? formatSlackTs(ts) : undefined;

                return {
                    ts,
                    formattedDate: formatted,
                    text:          typeof m.text === 'string' ? m.text : undefined,
                    userId,
                    senderName,
                    type:          m.type,
                    botId,
                    hasFiles,
                    files:         fileDetails.length > 0 ? fileDetails : undefined,
                    replyCount:    typeof m.reply_count === 'number' ? m.reply_count : undefined,
                    threadTs:      typeof m.thread_ts   === 'string' ? m.thread_ts   : undefined,
                };
            });

            return {
                ok:      res.ok,
                channel: channelId,
                messages,
                hasMore: res.has_more,
            };
        }

        // ── Read Thread Replies ───────────────────────────────────────────────
        if (action === 'read_thread') {
            const readSource = config.readSource ?? 'channel';
            const limit      = config.limit ?? 50;
            let channelId: string;

            if (readSource === 'dm') {
                const targetUser = this.resolver.resolveTemplate(config.readUserId ?? '', context);
                if (!targetUser) throw new Error('Slack read_thread: readUserId is required for DM source');
                const conv = await client.conversations.open({ users: targetUser });
                if (!conv.ok || !conv.channel?.id) {
                    throw new Error(`Slack read_thread: failed to open DM with user "${targetUser}"`);
                }
                channelId = conv.channel.id;
            } else {
                channelId = this.resolver.resolveTemplate(config.channel ?? config.channels ?? '', context);
                if (!channelId) throw new Error('Slack read_thread: channel is required');
            }

            const threadTs = this.resolver.resolveTemplate(config.threadTs ?? '', context);
            if (!threadTs) throw new Error('Slack read_thread: threadTs (parent message timestamp) is required');

            const res = await client.conversations.replies({
                channel: channelId,
                ts:      threadTs,
                limit,
            });

            const rawMessages = (res.messages ?? []) as Array<Record<string, unknown>>;

            // Collect unique user / bot IDs for display-name resolution
            const userIds = new Set<string>();
            for (const m of rawMessages) {
                if (typeof m.user   === 'string') userIds.add(m.user);
                if (typeof m.bot_id === 'string') userIds.add(m.bot_id);
            }

            const nameMap: Record<string, string> = {};
            await Promise.all(
                [...userIds].map(async (id) => {
                    try {
                        const info = await client.users.info({ user: id });
                        if (info.ok && info.user) {
                            nameMap[id] =
                                info.user.profile?.display_name ||
                                info.user.real_name ||
                                info.user.name ||
                                id;
                        }
                    } catch {
                        // ignore — fall back to raw ID
                    }
                })
            );

            // conversations.replies returns messages oldest-first; index 0 is the parent
            const messages = rawMessages.map((m, idx) => {
                const userId     = typeof m.user   === 'string' ? m.user   : undefined;
                const botId      = typeof m.bot_id === 'string' ? m.bot_id : undefined;
                const senderId   = userId ?? botId;
                const senderName = senderId ? (nameMap[senderId] ?? senderId) : 'Unknown';

                const files       = Array.isArray(m.files)       ? m.files       as Array<Record<string, unknown>> : [];
                const attachments = Array.isArray(m.attachments) ? m.attachments as Array<Record<string, unknown>> : [];
                const hasFiles    = files.length > 0 || attachments.length > 0;

                const fileDetails = files.map((f) => ({
                    id:       f.id,
                    name:     f.name,
                    mimeType: f.mimetype,
                    url:      f.url_private ?? f.permalink,
                    isImage:  typeof f.mimetype === 'string' && f.mimetype.startsWith('image/'),
                }));

                const ts        = typeof m.ts === 'string' ? m.ts : undefined;
                const formatted = ts ? formatSlackTs(ts) : undefined;

                return {
                    ts,
                    formattedDate: formatted,
                    text:          typeof m.text === 'string' ? m.text : undefined,
                    userId,
                    senderName,
                    type:          m.type,
                    botId,
                    hasFiles,
                    files:         fileDetails.length > 0 ? fileDetails : undefined,
                    isParent:      idx === 0,
                };
            });

            return {
                ok:        res.ok,
                channel:   channelId,
                threadTs,
                messages,
                hasMore:   res.has_more,
            };
        }

        // ── List Users ────────────────────────────────────────────────────────
        if (action === 'list_users') {
            type UserEntry = {
                id: string; name: string; realName: string;
                displayName: string; email?: string; isBot: boolean;
            };
            const allUsers: UserEntry[] = [];
            let cursor: string | undefined;

            do {
                const page = await client.users.list({
                    limit: 200,
                    ...(cursor ? { cursor } : {}),
                });

                for (const u of page.members ?? []) {
                    if (u.deleted || u.id === 'USLACKBOT') continue;
                    allUsers.push({
                        id:          u.id!,
                        name:        u.name!,
                        realName:    u.real_name  ?? u.name!,
                        displayName: u.profile?.display_name || u.real_name || u.name!,
                        email:       u.profile?.email,
                        isBot:       u.is_bot ?? false,
                    });
                }

                cursor = page.response_metadata?.next_cursor || undefined;
            } while (cursor);

            allUsers.sort((a, b) =>
                (a.displayName || a.name).localeCompare(b.displayName || b.name)
            );

            return { ok: true, users: allUsers, total: allUsers.length };
        }

        // ── List Channels ─────────────────────────────────────────────────────
        if (action === 'list_channels') {
            const filter = config.channelFilter ?? 'all';
            type ChannelEntry = {
                id: string; name: string;
                isPrivate: boolean; isMember: boolean; memberCount?: number;
            };
            const allChannels: ChannelEntry[] = [];
            const missingScopes: string[] = [];

            async function fetchChannelPages(
                type: 'public_channel' | 'private_channel',
                requiredScope: string,
            ): Promise<void> {
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
                            const raw = c as Record<string, unknown>;
                            allChannels.push({
                                id:          c.id!,
                                name:        c.name!,
                                isPrivate:   c.is_private   ?? false,
                                isMember:    c.is_member    ?? false,
                                memberCount: typeof raw.num_members === 'number' ? raw.num_members : undefined,
                            });
                        }

                        cursor = page.response_metadata?.next_cursor || undefined;
                    } while (cursor);
                } catch (err: unknown) {
                    const code: string = (err as { data?: { error?: string } })?.data?.error ?? '';
                    if (code === 'missing_scope' || code === 'not_allowed_token_type') {
                        missingScopes.push(requiredScope);
                        return;
                    }
                    throw err;
                }
            }

            if (filter === 'all' || filter === 'public') {
                await fetchChannelPages('public_channel', 'channels:read');
            }
            if (filter === 'all' || filter === 'private') {
                await fetchChannelPages('private_channel', 'groups:read');
            }

            allChannels.sort((a, b) => {
                if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            return {
                ok:            true,
                channels:      allChannels,
                total:         allChannels.length,
                missingScopes: missingScopes.length > 0 ? missingScopes : undefined,
            };
        }

        throw new Error(`Slack node: unknown action "${action}"`);
    }
}
