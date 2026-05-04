import { google } from 'googleapis';
import { Readable } from 'stream';
import nodemailer from 'nodemailer';
import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { GoogleAuthService } from '../services/GoogleAuthService';
import { ExpressionResolver } from '../engine/ExpressionResolver';
import { buildFluxMessageHtml } from '../utils/emailTemplates';

type GmailAction =
    | 'send' | 'send_and_wait' | 'reply'
    | 'list' | 'read'
    | 'add_label' | 'remove_label'
    | 'mark_read' | 'mark_unread'
    | 'delete_message' | 'delete_conversation'
    | 'create_draft' | 'get_draft' | 'list_drafts' | 'delete_draft'
    | 'send_flux' | 'reply_flux';

interface GmailConfig {
    credentialId: string;
    action: GmailAction;
    // send / send_and_wait / reply / create_draft — recipients & body
    to?: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    subject?: string;
    body?: string;
    isHtml?: boolean;
    // send_flux — use Flux SMTP service account
    useFluxTemplate?: boolean;   // wrap body in Flux branded HTML template
    // send_and_wait — how long to poll for a reply (minutes, default 5)
    waitMinutes?: number;
    // reply / reply_flux — ID of the message being replied to
    replyToMessageId?: string;
    // reply / reply_flux — when true, address all original recipients (Reply All)
    replyAll?: boolean;
    // list — user-friendly filter fields (translated to a Gmail query on the fly)
    readStatus?: 'all' | 'read' | 'unread';
    fromFilter?: string | string[];   // single address/name, or multiple (joined with OR)
    subjectFilter?: string;
    bodyFilter?: string;
    hasAttachment?: boolean;
    attachmentTypes?: string[];       // 'image' | 'pdf' | 'docs' | 'sheets'
    maxResults?: number;
    // read / mark_read / mark_unread / add_label / remove_label / delete_message
    messageId?: string;
    // add_label / remove_label
    labelIds?: string[];
    // delete_message / delete_conversation — permanent delete vs. move to trash (default = trash)
    permanent?: boolean;
    // get_draft / delete_draft
    draftId?: string;
    // list_drafts
    maxDrafts?: number;
    // send / reply — file attachments
    attachments?: GmailAttachment[];
}

interface GmailAttachment {
    /** Display filename (may contain an expression). */
    filename: string;
    /** MIME type, e.g. "application/pdf". Auto-detected from filename when omitted. */
    mimeType?: string;
    /**
     * Base64-encoded file content **or** an expression like
     * `{{nodes.gdrive-node.fileContent}}` that resolves to base64 at runtime.
     */
    data: string;
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

        const auth  = await this.googleAuth.getAuthenticatedClient(credentialId);
        const gmail = google.gmail({ version: 'v1', auth });

        // ── Shared helpers ─────────────────────────────────────────────────────

        /** Resolve a to/cc/bcc field that may be a plain string or a string[]. */
        const resolveAddresses = (raw: string | string[] | undefined): string | undefined => {
            if (!raw) return undefined;
            if (Array.isArray(raw)) {
                const joined = raw
                    .map((a) => this.resolver.resolveTemplate(a, context))
                    .filter(Boolean)
                    .join(', ');
                return joined || undefined;
            }
            const resolved = this.resolver.resolveTemplate(raw, context);
            return resolved || undefined;
        };

        /** Recursively extract a body part by MIME type from the message payload. */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const getPart = (parts: any[] | null | undefined, mimeType: string): string => {
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

        /** Decode the full plain-text body from a message payload. */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extractBody = (payload: any): string =>
            getPart(payload?.parts, 'text/plain') ||
            getPart(payload?.parts, 'text/html') ||
            (payload?.body?.data ? Buffer.from(payload.body.data, 'base64').toString('utf-8') : '');

        /** Infer a MIME type from a filename extension when none is provided. */
        const guessMime = (filename: string): string => {
            const ext = filename.split('.').pop()?.toLowerCase() ?? '';
            const map: Record<string, string> = {
                pdf:  'application/pdf',
                doc:  'application/msword',
                docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                xls:  'application/vnd.ms-excel',
                xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                ppt:  'application/vnd.ms-powerpoint',
                pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                png:  'image/png',
                jpg:  'image/jpeg',
                jpeg: 'image/jpeg',
                gif:  'image/gif',
                webp: 'image/webp',
                svg:  'image/svg+xml',
                txt:  'text/plain',
                csv:  'text/csv',
                html: 'text/html',
                json: 'application/json',
                zip:  'application/zip',
                mp4:  'video/mp4',
            };
            return map[ext] ?? 'application/octet-stream';
        };

        /**
         * Build a base64url-encoded RFC-2822 MIME message.
         * When attachments are provided the message is wrapped in multipart/mixed.
         */
        const buildRaw = (opts: {
            to: string; cc?: string; bcc?: string;
            subject: string; body: string; isHtml?: boolean;
            inReplyTo?: string; references?: string;
            attachments?: Array<{ filename: string; mimeType?: string; data: string }>;
        }) => {
            const ct       = opts.isHtml ? 'text/html' : 'text/plain';
            const normBody = opts.body.replace(/\r?\n/g, '\r\n');
            const atts     = opts.attachments ?? [];

            let mime: string;

            if (atts.length === 0) {
                // Simple single-part message
                const headers = [
                    `To: ${opts.to}`,
                    opts.cc         ? `Cc: ${opts.cc}`                 : null,
                    opts.bcc        ? `Bcc: ${opts.bcc}`               : null,
                    `Subject: ${opts.subject}`,
                    `MIME-Version: 1.0`,
                    `Content-Type: ${ct}; charset=utf-8`,
                    opts.inReplyTo  ? `In-Reply-To: ${opts.inReplyTo}` : null,
                    opts.references ? `References: ${opts.references}` : null,
                    '',
                    normBody,
                ];
                mime = headers.filter((l): l is string => l !== null).join('\r\n');
            } else {
                // Multipart/mixed envelope
                const boundary = `__boundary_${Date.now().toString(36)}`;
                const lines: string[] = [
                    `To: ${opts.to}`,
                    ...(opts.cc         ? [`Cc: ${opts.cc}`]                 : []),
                    ...(opts.bcc        ? [`Bcc: ${opts.bcc}`]               : []),
                    `Subject: ${opts.subject}`,
                    `MIME-Version: 1.0`,
                    `Content-Type: multipart/mixed; boundary="${boundary}"`,
                    ...(opts.inReplyTo  ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
                    ...(opts.references ? [`References: ${opts.references}`] : []),
                    '',
                    // Body part
                    `--${boundary}`,
                    `Content-Type: ${ct}; charset=utf-8`,
                    `Content-Transfer-Encoding: quoted-printable`,
                    '',
                    normBody,
                ];

                for (const att of atts) {
                    const mime_type = att.mimeType || guessMime(att.filename);
                    // Strip data-URL prefix if someone pasted a full data URL
                    const b64 = att.data.includes(',') ? att.data.split(',')[1] : att.data;
                    // Fold base64 at 76 chars per RFC 2045
                    const folded = (b64.match(/.{1,76}/g) ?? []).join('\r\n');
                    lines.push(
                        `--${boundary}`,
                        `Content-Type: ${mime_type}; name="${att.filename}"`,
                        `Content-Transfer-Encoding: base64`,
                        `Content-Disposition: attachment; filename="${att.filename}"`,
                        '',
                        folded,
                    );
                }
                lines.push(`--${boundary}--`);
                mime = lines.join('\r\n');
            }

            return Buffer.from(mime).toString('base64url');
        };

        /** Resolve the attachments array — data fields may contain expressions. */
        const resolveAttachments = (
            raw: GmailAttachment[] | undefined,
        ): Array<{ filename: string; mimeType?: string; data: string }> => {
            if (!raw || raw.length === 0) return [];
            return raw
                .map((att) => ({
                    filename: this.resolver.resolveTemplate(att.filename, context),
                    mimeType: att.mimeType,
                    data:     this.resolver.resolveTemplate(att.data, context),
                }))
                .filter((att) => att.filename && att.data);  // skip incomplete entries
        };

        /**
         * Gmail's attachment limit is 25 MB (decoded binary).
         * Files that exceed this are uploaded to Google Drive and a link is
         * appended to the email body, matching Gmail's own behaviour.
         */
        const GMAIL_ATTACH_LIMIT = 25 * 1024 * 1024; // 25 MB

        const routeAttachments = async (
            resolved: Array<{ filename: string; mimeType?: string; data: string }>,
            bodyText: string,
        ): Promise<{
            inlineAttachments: Array<{ filename: string; mimeType?: string; data: string }>;
            finalBody: string;
        }> => {
            if (resolved.length === 0) return { inlineAttachments: [], finalBody: bodyText };

            const drive = google.drive({ version: 'v3', auth });
            const inline: typeof resolved  = [];
            const driveLinks: string[]     = [];

            for (const att of resolved) {
                // Strip data-URL prefix if present, then measure decoded size
                const b64          = att.data.includes(',') ? att.data.split(',')[1] : att.data;
                const decodedBytes = Math.ceil(b64.length * 0.75);

                if (decodedBytes <= GMAIL_ATTACH_LIMIT) {
                    inline.push(att);
                    continue;
                }

                // File exceeds 25 MB → upload to Google Drive
                const mimeType = att.mimeType || guessMime(att.filename);
                const buffer   = Buffer.from(b64, 'base64');

                const uploadRes = await drive.files.create({
                    requestBody: { name: att.filename },
                    media:       { mimeType, body: Readable.from(buffer) },
                    fields:      'id,webViewLink',
                });

                // Make the file accessible to anyone with the link
                await drive.permissions.create({
                    fileId:      uploadRes.data.id!,
                    requestBody: { role: 'reader', type: 'anyone' },
                });

                const sizeMB = (decodedBytes / 1024 / 1024).toFixed(1);
                driveLinks.push(
                    `📎 ${att.filename} (${sizeMB} MB — too large to attach directly, uploaded to Google Drive): ${uploadRes.data.webViewLink}`
                );
            }

            const finalBody = driveLinks.length > 0
                ? `${bodyText}\n\n--- Large files attached via Google Drive ---\n${driveLinks.join('\n')}`
                : bodyText;

            return { inlineAttachments: inline, finalBody };
        };

        // ── send ───────────────────────────────────────────────────────────────

        if (action === 'send') {
            const bodyText = this.resolver.resolveTemplate(config.body ?? '', context);
            const { inlineAttachments, finalBody } = await routeAttachments(
                resolveAttachments(config.attachments),
                bodyText,
            );
            const raw = buildRaw({
                to:          resolveAddresses(config.to) ?? '',
                cc:          resolveAddresses(config.cc),
                bcc:         resolveAddresses(config.bcc),
                subject:     this.resolver.resolveTemplate(config.subject ?? '', context),
                body:        finalBody,
                isHtml:      config.isHtml,
                attachments: inlineAttachments,
            });
            const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
            return { messageId: res.data.id, threadId: res.data.threadId, labelIds: res.data.labelIds };
        }

        // ── send_and_wait ──────────────────────────────────────────────────────

        if (action === 'send_and_wait') {
            const raw = buildRaw({
                to:      resolveAddresses(config.to) ?? '',
                cc:      resolveAddresses(config.cc),
                bcc:     resolveAddresses(config.bcc),
                subject: this.resolver.resolveTemplate(config.subject ?? '', context),
                body:    this.resolver.resolveTemplate(config.body    ?? '', context),
                isHtml:  config.isHtml,
            });
            const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
            const threadId = sent.data.threadId!;
            const sentId   = sent.data.id!;

            const waitMs  = Math.min((config.waitMinutes ?? 5), 60) * 60_000;
            const pollMs  = 15_000; // check every 15 s
            const deadline = Date.now() + waitMs;

            while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, pollMs));
                const thread = await gmail.users.threads.get({
                    userId: 'me',
                    id: threadId,
                    format: 'metadata',
                    metadataHeaders: ['From', 'Subject', 'Date'],
                });
                const msgs = thread.data.messages ?? [];
                // A reply exists when there is a message in the thread that is NOT
                // the one we just sent.
                const reply = msgs.find((m) => m.id !== sentId);
                if (reply) {
                    const rh = reply.payload?.headers ?? [];
                    const h  = (n: string) => rh.find((x) => x.name === n)?.value ?? '';
                    return {
                        replied:          true,
                        sentMessageId:    sentId,
                        threadId,
                        replyMessageId:   reply.id,
                        replyFrom:        h('From'),
                        replySubject:     h('Subject'),
                        replyDate:        h('Date'),
                        replySnippet:     reply.snippet,
                    };
                }
            }

            return { replied: false, timedOut: true, sentMessageId: sentId, threadId };
        }

        // ── reply ──────────────────────────────────────────────────────────────

        if (action === 'reply') {
            const replyToId = this.resolver.resolveTemplate(config.replyToMessageId ?? '', context);
            if (!replyToId) throw new Error('Gmail reply: replyToMessageId is required');

            const orig = await gmail.users.messages.get({
                userId: 'me',
                id: replyToId,
                format: 'metadata',
                metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'References'],
            });
            const oh = (n: string) =>
                (orig.data.payload?.headers ?? []).find((x) => x.name === n)?.value ?? '';

            const origFrom      = oh('From');
            const origTo        = oh('To');
            const origCc        = oh('Cc');
            const origSubject   = oh('Subject');
            const origMessageId = oh('Message-ID');
            const origRefs      = oh('References');

            const replySubject = origSubject.startsWith('Re:') ? origSubject : `Re: ${origSubject}`;
            const references   = [origRefs, origMessageId].filter(Boolean).join(' ');

            // ── recipient resolution ───────────────────────────────────────────
            let replyTo: string;
            let replyCc: string | undefined;

            if (config.replyAll) {
                /** Split a raw header value into trimmed address tokens. */
                const splitAddrs = (raw: string): string[] =>
                    raw ? raw.split(',').map((a) => a.trim()).filter(Boolean) : [];

                /** Extract the bare email from "Display Name <email@example.com>" or "email". */
                const bareEmail = (addr: string): string => {
                    const m = addr.match(/<([^>]+)>/);
                    return (m ? m[1] : addr).trim().toLowerCase();
                };

                // To = original From + original To recipients, deduplicated.
                // The connected Gmail account is intentionally kept if it appears
                // in the thread — no self-exclusion applied here.
                const toPool  = [origFrom, ...splitAddrs(origTo)];
                const seen    = new Set<string>();
                const toFinal = toPool.filter((a) => {
                    const addr = bareEmail(a);
                    if (seen.has(addr)) return false;
                    seen.add(addr);
                    return true;
                });

                replyTo = toFinal.join(', ');
                const ccList = splitAddrs(origCc);
                replyCc = ccList.length ? ccList.join(', ') : undefined;
            } else {
                replyTo = origFrom;
                replyCc = undefined;
            }
            // ──────────────────────────────────────────────────────────────────

            const replyBodyText = this.resolver.resolveTemplate(config.body ?? '', context);
            const { inlineAttachments: replyInline, finalBody: replyFinalBody } = await routeAttachments(
                resolveAttachments(config.attachments),
                replyBodyText,
            );
            const raw = buildRaw({
                to:          replyTo,
                cc:          replyCc,
                subject:     replySubject,
                body:        replyFinalBody,
                isHtml:      config.isHtml,
                inReplyTo:   origMessageId,
                references,
                attachments: replyInline,
            });

            const res = await gmail.users.messages.send({
                userId: 'me',
                requestBody: { raw, threadId: orig.data.threadId ?? undefined },
            });
            return {
                messageId: res.data.id,
                threadId:  res.data.threadId,
                repliedTo: replyToId,
                replyAll:  config.replyAll ?? false,
                labelIds:  res.data.labelIds,
            };
        }

        // ── reply_flux ─────────────────────────────────────────────────────────
        // Reply to an existing Gmail message using the Flux SMTP service account.
        // Uses the Gmail API only to look up the original message metadata (recipient
        // address, subject, threading headers); the reply itself is delivered via
        // the platform SMTP credentials configured in .env.

        if (action === 'reply_flux') {
            const smtpHost = process.env.SMTP_HOST;
            const smtpUser = process.env.SMTP_USER;
            const smtpPass = process.env.SMTP_PASS;
            const smtpFrom = process.env.SMTP_FROM_ADDRESS;
            const fromName = process.env.SMTP_FROM_NAME ?? 'Flux Workflow';

            if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
                throw new Error(
                    'Gmail reply_flux: SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM_ADDRESS in your .env file.'
                );
            }

            const replyToId = this.resolver.resolveTemplate(config.replyToMessageId ?? '', context);
            if (!replyToId) throw new Error('Gmail reply_flux: replyToMessageId is required');

            const orig = await gmail.users.messages.get({
                userId: 'me',
                id: replyToId,
                format: 'metadata',
                metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'References'],
            });
            const oh = (n: string) =>
                (orig.data.payload?.headers ?? []).find((x) => x.name === n)?.value ?? '';

            const origFrom      = oh('From');
            const origTo        = oh('To');
            const origCc        = oh('Cc');
            const origSubject   = oh('Subject');
            const origMessageId = oh('Message-ID');
            const origRefs      = oh('References');
            const threadId      = orig.data.threadId ?? undefined;

            const replySubject = origSubject.startsWith('Re:') ? origSubject : `Re: ${origSubject}`;
            const references   = [origRefs, origMessageId].filter(Boolean).join(' ');

            // ── recipient resolution ───────────────────────────────────────────
            let replyTo: string;
            let replyCc: string | undefined;

            if (config.replyAll) {
                // Only exclude the Flux SMTP sender address (since that is the
                // actual sender of this reply). The connected Gmail account is
                // kept if it appears in the thread.
                const fluxEmail = smtpFrom.toLowerCase();

                const splitAddrs = (raw: string): string[] =>
                    raw ? raw.split(',').map((a) => a.trim()).filter(Boolean) : [];

                const bareEmail = (addr: string): string => {
                    const m = addr.match(/<([^>]+)>/);
                    return (m ? m[1] : addr).trim().toLowerCase();
                };

                const excludeFlux = (addrs: string[]): string[] =>
                    addrs.filter((a) => bareEmail(a) !== fluxEmail);

                const toPool  = [origFrom, ...excludeFlux(splitAddrs(origTo))];
                const seen    = new Set<string>();
                const toFinal = toPool.filter((a) => {
                    const addr = bareEmail(a);
                    if (seen.has(addr)) return false;
                    seen.add(addr);
                    return true;
                });

                replyTo = toFinal.join(', ');
                const ccFinal = excludeFlux(splitAddrs(origCc));
                replyCc = ccFinal.length ? ccFinal.join(', ') : undefined;
            } else {
                replyTo = origFrom;
                replyCc = undefined;
            }
            // ──────────────────────────────────────────────────────────────────

            const rawBody     = this.resolver.resolveTemplate(config.body ?? '', context);
            const useTemplate = config.useFluxTemplate !== false;

            const htmlBody = useTemplate
                ? buildFluxMessageHtml(replySubject, rawBody, config.isHtml ?? false)
                : config.isHtml
                    ? rawBody
                    : `<pre style="font-family:inherit;white-space:pre-wrap;">${rawBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;

            const port   = Number(process.env.SMTP_PORT ?? 587);
            const secure = process.env.SMTP_SECURE === 'true';

            const transporter = nodemailer.createTransport({
                host: smtpHost, port, secure,
                auth: { user: smtpUser, pass: smtpPass },
            });

            const info = await transporter.sendMail({
                from:       `"${fromName}" <${smtpFrom}>`,
                to:         replyTo,
                ...(replyCc ? { cc: replyCc } : {}),
                subject:    replySubject,
                html:       htmlBody,
                text:       rawBody,
                inReplyTo:  origMessageId || undefined,
                references: references || undefined,
            });

            return {
                messageId:    info.messageId,
                accepted:     info.accepted,
                rejected:     info.rejected,
                repliedTo:    replyToId,
                threadId,
                subject:      replySubject,
                usedTemplate: useTemplate,
                replyAll:     config.replyAll ?? false,
            };
        }

        // ── list ───────────────────────────────────────────────────────────────

        if (action === 'list') {
            const maxResults = config.maxResults ?? 10;
            const queryParts: string[] = [];

            if (config.readStatus === 'read')   queryParts.push('is:read');
            if (config.readStatus === 'unread') queryParts.push('is:unread');

            const resolvedFroms: string[] = Array.isArray(config.fromFilter)
                ? config.fromFilter.map((f) => this.resolver.resolveTemplate(f, context)).filter(Boolean)
                : config.fromFilter
                    ? [this.resolver.resolveTemplate(config.fromFilter, context)].filter(Boolean)
                    : [];

            if (resolvedFroms.length === 1) {
                queryParts.push(`from:(${resolvedFroms[0]})`);
            } else if (resolvedFroms.length > 1) {
                queryParts.push(`{${resolvedFroms.map((f) => `from:${f}`).join(' ')}}`);
            }

            const subjectFilter = config.subjectFilter ? this.resolver.resolveTemplate(config.subjectFilter, context) : '';
            const bodyFilter    = config.bodyFilter    ? this.resolver.resolveTemplate(config.bodyFilter,    context) : '';
            if (subjectFilter) queryParts.push(`subject:(${subjectFilter})`);
            if (bodyFilter)    queryParts.push(`"${bodyFilter}"`);

            if (config.hasAttachment) {
                queryParts.push('has:attachment');
                const typeMap: Record<string, string> = {
                    image:  'filename:(jpg OR jpeg OR png OR gif OR bmp OR webp)',
                    pdf:    'filename:pdf',
                    docs:   'filename:(doc OR docx)',
                    sheets: 'filename:(xls OR xlsx OR csv)',
                };
                (config.attachmentTypes ?? []).forEach((t) => {
                    if (typeMap[t]) queryParts.push(typeMap[t]);
                });
            }

            const res = await gmail.users.messages.list({
                userId: 'me',
                q: queryParts.join(' ') || undefined,
                maxResults,
            });
            const matchedRefs = res.data.messages ?? [];

            const seenThreadIds = new Set<string>();
            for (const m of matchedRefs) if (m.threadId) seenThreadIds.add(m.threadId);

            const threads = await Promise.all(
                [...seenThreadIds].map(async (threadId) => {
                    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
                    const msgs = (thread.data.messages ?? []).map((m) => ({
                        id:       m.id,
                        threadId: m.threadId ?? threadId,
                        subject:  (m.payload?.headers ?? []).find((x) => x.name === 'Subject')?.value ?? '',
                        from:     (m.payload?.headers ?? []).find((x) => x.name === 'From')?.value    ?? '',
                        to:       (m.payload?.headers ?? []).find((x) => x.name === 'To')?.value      ?? '',
                        date:     (m.payload?.headers ?? []).find((x) => x.name === 'Date')?.value    ?? '',
                        snippet:  m.snippet,
                        body:     extractBody(m.payload),
                    }));
                    return { threadId, messages: msgs };
                })
            );

            return {
                threads,
                totalThreads:    threads.length,
                totalMessages:   threads.reduce((s, t) => s + t.messages.length, 0),
                matchedMessages: matchedRefs.length,
            };
        }

        // ── read (get message) ─────────────────────────────────────────────────

        if (action === 'read') {
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);
            if (!messageId) throw new Error('Gmail get message: messageId is required');

            const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
            const headers = res.data.payload?.headers ?? [];
            const h = (n: string) => headers.find((x) => x.name === n)?.value ?? '';

            return {
                id:       res.data.id,
                threadId: res.data.threadId,
                subject:  h('Subject'),
                from:     h('From'),
                to:       h('To'),
                date:     h('Date'),
                snippet:  res.data.snippet,
                body:     extractBody(res.data.payload),
                labelIds: res.data.labelIds,
            };
        }

        // ── add_label ──────────────────────────────────────────────────────────

        if (action === 'add_label') {
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);
            if (!messageId) throw new Error('Gmail add label: messageId is required');
            const labelIds = (config.labelIds ?? []).map((l) => this.resolver.resolveTemplate(l, context)).filter(Boolean);
            if (labelIds.length === 0) throw new Error('Gmail add label: at least one labelId is required');

            const res = await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: { addLabelIds: labelIds },
            });
            return { messageId: res.data.id, labelIds: res.data.labelIds, addedLabels: labelIds };
        }

        // ── remove_label ───────────────────────────────────────────────────────

        if (action === 'remove_label') {
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);
            if (!messageId) throw new Error('Gmail remove label: messageId is required');
            const labelIds = (config.labelIds ?? []).map((l) => this.resolver.resolveTemplate(l, context)).filter(Boolean);
            if (labelIds.length === 0) throw new Error('Gmail remove label: at least one labelId is required');

            const res = await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: { removeLabelIds: labelIds },
            });
            return { messageId: res.data.id, labelIds: res.data.labelIds, removedLabels: labelIds };
        }

        // ── mark_read ──────────────────────────────────────────────────────────

        if (action === 'mark_read') {
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);
            if (!messageId) throw new Error('Gmail mark as read: messageId is required');

            const res = await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: { removeLabelIds: ['UNREAD'] },
            });
            return { messageId: res.data.id, markedAs: 'read', labelIds: res.data.labelIds };
        }

        // ── mark_unread ────────────────────────────────────────────────────────

        if (action === 'mark_unread') {
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);
            if (!messageId) throw new Error('Gmail mark as unread: messageId is required');

            const res = await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: { addLabelIds: ['UNREAD'] },
            });
            return { messageId: res.data.id, markedAs: 'unread', labelIds: res.data.labelIds };
        }

        // ── delete_message ─────────────────────────────────────────────────────

        if (action === 'delete_message') {
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);
            if (!messageId) throw new Error('Gmail delete message: messageId is required');

            if (config.permanent) {
                await gmail.users.messages.delete({ userId: 'me', id: messageId });
                return { deleted: true, permanent: true, messageId };
            } else {
                const res = await gmail.users.messages.trash({ userId: 'me', id: messageId });
                return { deleted: true, permanent: false, movedToTrash: true, messageId: res.data.id };
            }
        }

        // ── delete_conversation ────────────────────────────────────────────────
        // Finds the thread the given message belongs to, then deletes every
        // message in that thread (trash or permanent).

        if (action === 'delete_conversation') {
            const messageId = this.resolver.resolveTemplate(config.messageId ?? '', context);
            if (!messageId) throw new Error('Gmail delete conversation: messageId is required');

            // Retrieve just the minimal metadata to get the threadId
            const msgMeta = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'minimal',
            });
            const threadId = msgMeta.data.threadId;
            if (!threadId) throw new Error('Gmail delete conversation: could not determine threadId for the given message');

            // Fetch all messages in the thread so we know how many there are
            const threadRes = await gmail.users.threads.get({
                userId: 'me',
                id: threadId,
                format: 'minimal',
            });
            const messageCount = (threadRes.data.messages ?? []).length;

            if (config.permanent) {
                // Permanently delete the entire thread (requires https://mail.google.com/ scope)
                await gmail.users.threads.delete({ userId: 'me', id: threadId });
                return {
                    deleted:       true,
                    permanent:     true,
                    threadId,
                    messageCount,
                };
            } else {
                // Move the entire thread to Trash
                const res = await gmail.users.threads.trash({ userId: 'me', id: threadId });
                return {
                    deleted:       true,
                    permanent:     false,
                    movedToTrash:  true,
                    threadId:      res.data.id,
                    messageCount,
                };
            }
        }

        // ── create_draft ───────────────────────────────────────────────────────

        if (action === 'create_draft') {
            const raw = buildRaw({
                to:      resolveAddresses(config.to) ?? '',
                cc:      resolveAddresses(config.cc),
                bcc:     resolveAddresses(config.bcc),
                subject: this.resolver.resolveTemplate(config.subject ?? '', context),
                body:    this.resolver.resolveTemplate(config.body    ?? '', context),
                isHtml:  config.isHtml,
            });
            const res = await gmail.users.drafts.create({
                userId: 'me',
                requestBody: { message: { raw } },
            });
            return { draftId: res.data.id, messageId: res.data.message?.id };
        }

        // ── get_draft ──────────────────────────────────────────────────────────

        if (action === 'get_draft') {
            const draftId = this.resolver.resolveTemplate(config.draftId ?? '', context);
            if (!draftId) throw new Error('Gmail get draft: draftId is required');

            const res = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
            const msg     = res.data.message;
            const headers = msg?.payload?.headers ?? [];
            const h = (n: string) => headers.find((x) => x.name === n)?.value ?? '';

            return {
                draftId:   res.data.id,
                messageId: msg?.id,
                threadId:  msg?.threadId,
                subject:   h('Subject'),
                to:        h('To'),
                cc:        h('Cc'),
                from:      h('From'),
                date:      h('Date'),
                snippet:   msg?.snippet,
                body:      extractBody(msg?.payload),
                labelIds:  msg?.labelIds,
            };
        }

        // ── list_drafts ────────────────────────────────────────────────────────

        if (action === 'list_drafts') {
            const maxDrafts = config.maxDrafts ?? 10;
            const res = await gmail.users.drafts.list({ userId: 'me', maxResults: maxDrafts });
            const drafts = await Promise.all(
                (res.data.drafts ?? []).map(async (d) => {
                    // drafts.get does not support format/metadataHeaders — fetch full
                    const detail = await gmail.users.drafts.get({ userId: 'me', id: d.id! });
                    const headers = detail.data.message?.payload?.headers ?? [];
                    const h = (n: string) =>
                        headers.find((x: { name?: string | null }) => x.name === n)?.value ?? '';
                    return {
                        draftId:   d.id,
                        messageId: detail.data.message?.id,
                        subject:   h('Subject'),
                        to:        h('To'),
                        from:      h('From'),
                        date:      h('Date'),
                        snippet:   detail.data.message?.snippet,
                    };
                })
            );
            return { drafts, total: res.data.resultSizeEstimate };
        }

        // ── delete_draft ───────────────────────────────────────────────────────

        if (action === 'delete_draft') {
            const draftId = this.resolver.resolveTemplate(config.draftId ?? '', context);
            if (!draftId) throw new Error('Gmail delete draft: draftId is required');

            await gmail.users.drafts.delete({ userId: 'me', id: draftId });
            return { deleted: true, draftId };
        }

        // ── send_flux ──────────────────────────────────────────────────────────
        // Send an email via the Flux SMTP service account (configured in .env)
        // instead of the user's connected Gmail account.  Optionally wraps
        // the body in the Flux branded HTML email template.

        if (action === 'send_flux') {
            const smtpHost    = process.env.SMTP_HOST;
            const smtpUser    = process.env.SMTP_USER;
            const smtpPass    = process.env.SMTP_PASS;
            const smtpFrom    = process.env.SMTP_FROM_ADDRESS;
            const fromName    = process.env.SMTP_FROM_NAME ?? 'Flux Workflow';

            if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
                throw new Error(
                    'Gmail send_flux: SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM_ADDRESS in your .env file.'
                );
            }

            const toAddr      = resolveAddresses(config.to);
            const ccAddr      = resolveAddresses(config.cc);
            const bccAddr     = resolveAddresses(config.bcc);
            const subject     = this.resolver.resolveTemplate(config.subject ?? '', context);
            const rawBody     = this.resolver.resolveTemplate(config.body    ?? '', context);
            const useTemplate = config.useFluxTemplate !== false; // default ON

            if (!toAddr)  throw new Error('Gmail send_flux: "to" is required');
            if (!subject) throw new Error('Gmail send_flux: "subject" is required');

            const htmlBody = useTemplate
                ? buildFluxMessageHtml(subject, rawBody, config.isHtml ?? false)
                : config.isHtml
                    ? rawBody
                    : `<pre style="font-family:inherit;white-space:pre-wrap;">${rawBody.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;

            const port   = Number(process.env.SMTP_PORT ?? 587);
            const secure = process.env.SMTP_SECURE === 'true';

            const transporter = nodemailer.createTransport({
                host: smtpHost, port, secure,
                auth: { user: smtpUser, pass: smtpPass },
            });

            const info = await transporter.sendMail({
                from:    `"${fromName}" <${smtpFrom}>`,
                to:      toAddr,
                ...(ccAddr  ? { cc:  ccAddr  } : {}),
                ...(bccAddr ? { bcc: bccAddr } : {}),
                subject,
                html:    htmlBody,
                text:    rawBody,
            });

            return {
                messageId:    info.messageId,
                accepted:     info.accepted,
                rejected:     info.rejected,
                from:         smtpFrom,
                to:           toAddr,
                subject,
                usedTemplate: useTemplate,
            };
        }

        throw new Error(`Gmail node: unknown action "${action}"`);
    }
}
