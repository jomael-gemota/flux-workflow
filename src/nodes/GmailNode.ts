import { google } from 'googleapis';
import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { GoogleAuthService } from '../services/GoogleAuthService';
import { ExpressionResolver } from '../engine/ExpressionResolver';

type GmailAction = 'send' | 'list' | 'read';

interface GmailConfig {
    credentialId: string;
    action: GmailAction;
    // send
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    isHtml?: boolean;
    // list
    query?: string;
    maxResults?: number;
    // read
    messageId?: string;
}

export class GmailNode implements NodeExecutor {
    private googleAuth: GoogleAuthService;
    private resolver = new ExpressionResolver();

    constructor(googleAuth: GoogleAuthService) {
        this.googleAuth = googleAuth;
    }

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as GmailConfig;
        const { credentialId, action } = config;

        if (!credentialId) throw new Error('Gmail node: credentialId is required');
        if (!action)       throw new Error('Gmail node: action is required');

        const auth   = await this.googleAuth.getAuthenticatedClient(credentialId);
        const gmail  = google.gmail({ version: 'v1', auth });

        if (action === 'send') {
            const to      = this.resolver.resolveTemplate(config.to ?? '', context);
            const subject = this.resolver.resolveTemplate(config.subject ?? '', context);
            const body    = this.resolver.resolveTemplate(config.body ?? '', context);
            const cc      = config.cc ? this.resolver.resolveTemplate(config.cc, context) : undefined;
            const bcc     = config.bcc ? this.resolver.resolveTemplate(config.bcc, context) : undefined;

            const contentType = config.isHtml ? 'text/html' : 'text/plain';

            // Normalise line endings inside the body to CRLF so every paragraph
            // boundary survives the MIME encode/decode cycle intact.
            const normalisedBody = body.replace(/\r?\n/g, '\r\n');

            // IMPORTANT: filter only null/undefined, NOT the empty string ''.
            // The empty string is the mandatory blank line that separates MIME
            // headers from the body.  filter(Boolean) would remove it, causing
            // the first paragraph to be parsed as a malformed header and only
            // the text after the first \n\n to appear as the email body.
            const messageParts = [
                `To: ${to}`,
                cc  ? `Cc: ${cc}`  : null,
                bcc ? `Bcc: ${bcc}` : null,
                `Subject: ${subject}`,
                `Content-Type: ${contentType}; charset=utf-8`,
                '',              // ← blank line — MIME header/body separator
                normalisedBody,
            ];
            const rawMessage = messageParts
                .filter((line): line is string => line !== null)
                .join('\r\n');

            const encoded = Buffer.from(rawMessage).toString('base64url');
            const res = await gmail.users.messages.send({
                userId: 'me',
                requestBody: { raw: encoded },
            });
            return { messageId: res.data.id, threadId: res.data.threadId, labelIds: res.data.labelIds };
        }

        if (action === 'list') {
            const query      = this.resolver.resolveTemplate(config.query ?? '', context);
            const maxResults = config.maxResults ?? 10;
            const res = await gmail.users.messages.list({
                userId: 'me',
                q: query || undefined,
                maxResults,
            });
            const messages = res.data.messages ?? [];
            // Fetch snippet for each message
            const details = await Promise.all(
                messages.map(async (m) => {
                    const detail = await gmail.users.messages.get({
                        userId: 'me',
                        id: m.id!,
                        format: 'metadata',
                        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
                    });
                    const headers = detail.data.payload?.headers ?? [];
                    const h = (name: string) => headers.find((x) => x.name === name)?.value ?? '';
                    return {
                        id:       m.id,
                        threadId: m.threadId,
                        subject:  h('Subject'),
                        from:     h('From'),
                        to:       h('To'),
                        date:     h('Date'),
                        snippet:  detail.data.snippet,
                    };
                })
            );
            return { messages: details, total: res.data.resultSizeEstimate };
        }

        if (action === 'read') {
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);
            if (!messageId) throw new Error('Gmail read: messageId is required');

            const res = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full',
            });
            const payload  = res.data.payload;
            const headers  = payload?.headers ?? [];
            const h = (name: string) => headers.find((x) => x.name === name)?.value ?? '';

            // Extract plain-text body
            let textBody = '';
            type MsgParts = NonNullable<typeof payload>['parts'];
            const getPart = (parts: MsgParts, mimeType: string): string => {
                for (const part of parts ?? []) {
                    if (part.mimeType === mimeType && part.body?.data) {
                        return Buffer.from(part.body.data, 'base64').toString('utf-8');
                    }
                    if (part.parts) {
                        const found = getPart(part.parts, mimeType);
                        if (found) return found;
                    }
                }
                return '';
            };

            textBody = getPart(payload?.parts, 'text/plain') ||
                       getPart(payload?.parts, 'text/html') ||
                       (payload?.body?.data ? Buffer.from(payload.body.data, 'base64').toString('utf-8') : '');

            return {
                id:       res.data.id,
                threadId: res.data.threadId,
                subject:  h('Subject'),
                from:     h('From'),
                to:       h('To'),
                date:     h('Date'),
                snippet:  res.data.snippet,
                body:     textBody,
                labelIds: res.data.labelIds,
            };
        }

        throw new Error(`Gmail node: unknown action "${action}"`);
    }
}
