import { Client } from '@microsoft/microsoft-graph-client';
import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { TeamsAuthService } from '../services/TeamsAuthService';
import { ExpressionResolver } from '../engine/ExpressionResolver';
import { logoDataUri } from '../utils/emailTemplates';

type TeamsAction = 'send_message' | 'send_dm' | 'read_messages' | 'read_thread';

interface TeamsConfig {
    credentialId: string;
    action: TeamsAction;
    // send_message / read_messages / read_thread
    teamId?: string;
    channelId?: string;
    // send_message / send_dm
    text?: string;
    // Flux Bot (send_message only) — uses an Incoming Webhook URL instead of delegated Graph token
    senderType?: 'user' | 'bot';
    webhookUrl?: string;
    // send_dm
    userId?: string;
    // read_messages
    limit?: number;
    // read_thread
    messageId?: string;
}

/**
 * Detect whether a string is HTML (e.g. produced by the Message Formatter node).
 * When true, the Graph API should receive contentType: 'html' so Teams renders it properly.
 */
function detectContentType(text: string): 'html' | 'text' {
    return text.trimStart().startsWith('<') ? 'html' : 'text';
}

/**
 * Strip HTML tags from a Teams message body and decode common HTML entities.
 * Teams returns `contentType: "html"` for most messages.
 */
function stripHtml(html: string): string {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export class TeamsNode implements NodeExecutor {
    private teamsAuth: TeamsAuthService;
    private resolver = new ExpressionResolver();

    constructor(teamsAuth: TeamsAuthService) {
        this.teamsAuth = teamsAuth;
    }

    private async getClient(credentialId: string): Promise<Client> {
        const token = await this.teamsAuth.getToken(credentialId);
        return Client.init({
            authProvider: (done) => done(null, token),
        });
    }

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as TeamsConfig;
        const { credentialId, action } = config;

        if (!credentialId) throw new Error('Teams node: credentialId is required');
        if (!action)       throw new Error('Teams node: action is required');

        // Skip Graph client initialisation when the Flux Bot webhook path handles the request.
        const isWebhookOnly = action === 'send_message' && config.senderType === 'bot';
        const client = isWebhookOnly ? null : await this.getClient(credentialId);

        if (action === 'send_message') {
            const text = this.resolver.resolveTemplate(config.text ?? '', context);

            // ── Flux Bot path: post via Incoming Webhook ─────────────────────
            if (config.senderType === 'bot') {
                const webhookUrl = this.resolver.resolveTemplate(config.webhookUrl ?? '', context).trim();
                if (!webhookUrl) throw new Error('Teams Flux Bot: Webhook URL is required');
                if (!text)       throw new Error('Teams Flux Bot: message text is required');

                const displayText = detectContentType(text) === 'html' ? stripHtml(text) : text;

                // Build a "Flux Bot" branded header for the Adaptive Card.
                // Teams Workflows webhooks always show the sender as Power Automate / "Unknown user" —
                // baking the brand into the card itself is the standard workaround.
                const logo = logoDataUri();
                const headerColumns = [
                    ...(logo
                        ? [{
                            type:  'Column',
                            width: 'auto',
                            items: [{
                                type:    'Image',
                                url:     logo,
                                width:   '28px',
                                height:  '28px',
                                style:   'Default',
                                altText: 'Flux Bot',
                            }],
                            verticalContentAlignment: 'Center',
                          }]
                        : []),
                    {
                        type:  'Column',
                        width: 'stretch',
                        items: [{
                            type:   'TextBlock',
                            text:   'Flux Bot',
                            weight: 'Bolder',
                            size:   'Medium',
                            color:  'Accent',
                            wrap:   true,
                        }],
                        verticalContentAlignment: 'Center',
                    },
                ];

                // Use Adaptive Card format — compatible with Teams Workflows webhooks
                // (the successor to retired Office 365 Connectors).
                const payload = {
                    type: 'message',
                    attachments: [
                        {
                            contentType: 'application/vnd.microsoft.card.adaptive',
                            contentUrl:  null,
                            content: {
                                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                                type:    'AdaptiveCard',
                                version: '1.2',
                                body: [
                                    {
                                        type:    'ColumnSet',
                                        columns: headerColumns,
                                        spacing: 'None',
                                    },
                                    {
                                        type:      'TextBlock',
                                        text:      displayText,
                                        wrap:      true,
                                        spacing:   'Medium',
                                        separator: true,
                                    },
                                ],
                            },
                        },
                    ],
                };

                const res = await fetch(webhookUrl, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(payload),
                });

                if (!res.ok) {
                    const body = await res.text().catch(() => '');
                    throw new Error(`Teams Flux Bot: webhook POST failed (${res.status}): ${body}`);
                }

                return { ok: true, sentVia: 'webhook' };
            }

            // ── User (delegated) path: post via Microsoft Graph ──────────────
            const teamId    = this.resolver.resolveTemplate(config.teamId    ?? '', context);
            const channelId = this.resolver.resolveTemplate(config.channelId ?? '', context);

            if (!teamId)    throw new Error('Teams send_message: teamId is required');
            if (!channelId) throw new Error('Teams send_message: channelId is required');
            if (!text)      throw new Error('Teams send_message: text is required');

            // client is guaranteed non-null here (isWebhookOnly === false on this path)
            const res = await client!
                .api(`/teams/${teamId}/channels/${channelId}/messages`)
                .post({
                    body: {
                        contentType: detectContentType(text),
                        content:     text,
                    },
                });

            return {
                id:        res.id,
                teamId,
                channelId,
                createdAt: res.createdDateTime,
            };
        }

        if (action === 'send_dm') {
            const userId = this.resolver.resolveTemplate(config.userId ?? '', context);
            const text   = this.resolver.resolveTemplate(config.text   ?? '', context);

            if (!userId) throw new Error('Teams send_dm: userId is required');
            if (!text)   throw new Error('Teams send_dm: text is required');

            // Get or create a 1:1 chat with the target user.
            // First resolve the current user's ID.
            const me = await client!.api('/me').get() as { id: string };

            // '__self__' is a sentinel meaning "the authenticated user".
            const resolvedUserId = userId === '__self__' ? me.id : userId;

            let chat: { id: string };

            if (me.id === resolvedUserId) {
                // Self-DM: the Graph API cannot *create* a self-chat (requires 2 different
                // members), but Teams always has one pre-existing. Find it by paginating
                // through all oneOnOne chats until we locate the one where every member
                // with a resolved userId is the current user.
                type ChatPage = {
                    value: Array<{ id: string; members?: Array<{ userId?: string; [k: string]: unknown }> }>;
                    '@odata.nextLink'?: string;
                };

                let selfChat: { id: string } | undefined;
                let nextLink: string | undefined =
                    "/me/chats?$filter=chatType eq 'oneOnOne'&$expand=members";

                while (nextLink && !selfChat) {
                    const page = await client!.api(nextLink).get() as ChatPage;

                    selfChat = (page.value ?? []).find((c) => {
                        const memberIds = (c.members ?? [])
                            .map((m) => m.userId)
                            .filter((id): id is string => Boolean(id));
                        // A self-chat has at least one member entry and every
                        // resolved member ID belongs to the current user.
                        return memberIds.length > 0 && memberIds.every((id) => id === me.id);
                    });

                    nextLink = page['@odata.nextLink'];
                }

                if (!selfChat) {
                    throw new Error(
                        'Could not find your self-chat in Microsoft Teams. ' +
                        'Open Teams, navigate to your own profile and send yourself a message ' +
                        'once to create it, then retry.',
                    );
                }

                chat = { id: selfChat.id };
            } else {
                chat = await client!.api('/chats').post({
                    chatType: 'oneOnOne',
                    members: [
                        {
                            '@odata.type':     '#microsoft.graph.aadUserConversationMember',
                            roles:             ['owner'],
                            'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${me.id}')`,
                        },
                        {
                            '@odata.type':     '#microsoft.graph.aadUserConversationMember',
                            roles:             ['owner'],
                            'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${resolvedUserId}')`,
                        },
                    ],
                }) as { id: string };
            }

            const message = await client!.api(`/chats/${chat.id}/messages`).post({
                body: {
                    contentType: detectContentType(text),
                    content:     text,
                },
            }) as { id: string; createdDateTime: string };

            return {
                id:        message.id,
                chatId:    chat.id,
                createdAt: message.createdDateTime,
            };
        }

        if (action === 'read_messages') {
            const teamId    = this.resolver.resolveTemplate(config.teamId    ?? '', context);
            const channelId = this.resolver.resolveTemplate(config.channelId ?? '', context);
            const limit     = config.limit ?? 10;

            if (!teamId)    throw new Error('Teams read_messages: teamId is required');
            if (!channelId) throw new Error('Teams read_messages: channelId is required');

            const res = await client!
                .api(`/teams/${teamId}/channels/${channelId}/messages`)
                .top(limit)
                .get() as { value: Array<Record<string, unknown>> };

            // Graph returns messages newest-first; sort ascending so oldest appears at top.
            const messages = (res.value ?? [])
                .map((m) => {
                    const body        = m.body as { content?: string; contentType?: string } | undefined;
                    const rawContent  = body?.content ?? '';
                    const contentType = body?.contentType ?? 'text';
                    const text        = contentType === 'html' ? stripHtml(rawContent) : rawContent;

                    const repliesCollection = m.replies as Array<unknown> | undefined;
                    const replyCount = Array.isArray(repliesCollection) ? repliesCollection.length : undefined;

                    return {
                        id:         m.id,
                        text,
                        from:       (m.from as { user?: { displayName?: string } } | undefined)?.user?.displayName,
                        createdAt:  m.createdDateTime as string | undefined,
                        replyToId:  (m.replyToId as string | null | undefined) ?? undefined,
                        hasReplies: replyCount !== undefined ? replyCount > 0 : undefined,
                        replyCount,
                    };
                })
                .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

            return { messages, count: messages.length };
        }

        if (action === 'read_thread') {
            const teamId    = this.resolver.resolveTemplate(config.teamId    ?? '', context);
            const channelId = this.resolver.resolveTemplate(config.channelId ?? '', context);
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);

            if (!teamId)    throw new Error('Teams read_thread: teamId is required');
            if (!channelId) throw new Error('Teams read_thread: channelId is required');
            if (!messageId) throw new Error('Teams read_thread: messageId is required');

            const mapMsg = (m: Record<string, unknown>, isParent = false) => {
                const body        = m.body as { content?: string; contentType?: string } | undefined;
                const rawContent  = body?.content ?? '';
                const contentType = body?.contentType ?? 'text';
                const text        = contentType === 'html' ? stripHtml(rawContent) : rawContent;
                return {
                    id:        m.id,
                    text,
                    from:      (m.from as { user?: { displayName?: string } } | undefined)?.user?.displayName,
                    createdAt: m.createdDateTime,
                    isParent,
                };
            };

            const [parentRes, repliesRes] = await Promise.all([
                client!
                    .api(`/teams/${teamId}/channels/${channelId}/messages/${messageId}`)
                    .get() as Promise<Record<string, unknown>>,
                client!
                    .api(`/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`)
                    .get() as Promise<{ value: Array<Record<string, unknown>> }>,
            ]);

            const parent = mapMsg(parentRes, true);
            // Graph replies may return newest-first; sort ascending so oldest reply appears at top.
            const replies = (repliesRes.value ?? [])
                .map((r) => mapMsg(r))
                .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

            return { teamId, channelId, messageId, parent, replies, replyCount: replies.length };
        }

        throw new Error(`Teams node: unknown action "${action}"`);
    }
}
