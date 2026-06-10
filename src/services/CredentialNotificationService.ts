import nodemailer from 'nodemailer';
import { UserModel } from '../db/models/UserModel';
import { buildFluxMessageHtml } from '../utils/emailTemplates';

export type CredentialEventType = 'connected' | 'reconnected' | 'disconnected';

export interface CredentialEventDetails {
    event: CredentialEventType;
    provider: 'google' | 'slack' | 'teams' | 'basecamp';
    /** Human-readable credential label (e.g. "Acme Workspace (U123)"). */
    label: string;
    /** Provider account identity stored on the credential (real email for Google, synthetic key otherwise). */
    accountEmail: string;
    /** MongoDB ObjectId string of the credential owner. The email is sent ONLY to this user. */
    ownerUserId?: string;
    /** When the event happened. Defaults to now. */
    occurredAt?: Date;
}

const PROVIDER_LABELS: Record<CredentialEventDetails['provider'], string> = {
    google:   'Google',
    slack:    'Slack',
    teams:    'Microsoft Teams',
    basecamp: 'Basecamp',
};

const EVENT_COPY: Record<CredentialEventType, { verb: string; heading: string; emoji: string; tone: 'good' | 'warn' }> = {
    connected:    { verb: 'connected',    heading: 'connected to Flux Workflow',    emoji: '🔗', tone: 'good' },
    reconnected:  { verb: 'reconnected',  heading: 'reconnected to Flux Workflow',  emoji: '🔁', tone: 'good' },
    disconnected: { verb: 'disconnected', heading: 'disconnected from Flux Workflow', emoji: '🔌', tone: 'warn' },
};

function isSmtpConfigured(): boolean {
    return !!(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.SMTP_FROM_ADDRESS
    );
}

function escHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Sends a Flux-branded email to a credential's owner whenever the credential is
 * connected, reconnected, or disconnected.
 *
 * Delivery is owner-only: the recipient is the platform user resolved from the
 * credential's `userId`. Credentials without an owner (legacy / API-key created)
 * are skipped silently. Sending is best-effort — callers should `.catch()` so a
 * mail failure never blocks the OAuth callback or the delete response.
 */
export class CredentialNotificationService {
    /** Returns whether SMTP env vars are fully configured. */
    static isConfigured(): boolean {
        return isSmtpConfigured();
    }

    async notify(details: CredentialEventDetails): Promise<void> {
        if (!details.ownerUserId) {
            // No owner to notify (legacy / API-key-created credential).
            return;
        }

        if (!isSmtpConfigured()) {
            console.warn(
                `[CredentialNotification] SMTP not configured — cannot send "${details.event}" email for ${details.label}`,
            );
            return;
        }

        const owner = await UserModel.findById(details.ownerUserId).catch(() => null);
        const recipient = owner?.email;
        if (!recipient) {
            console.warn(`[CredentialNotification] No owner email resolved for user ${details.ownerUserId}`);
            return;
        }

        const providerName = PROVIDER_LABELS[details.provider];
        const copy = EVENT_COPY[details.event];
        const when = details.occurredAt ?? new Date();
        const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
        const localTime = when.toLocaleString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZoneName: 'short',
        });

        const subject = `${copy.emoji} ${providerName} account ${copy.verb}: ${details.label}`;

        const calloutColors = copy.tone === 'good'
            ? { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46' }
            : { bg: '#fffbeb', border: '#fde68a', text: '#92400e' };

        const detailRows: Array<[string, string]> = [
            ['Provider', escHtml(providerName)],
            ['Account', escHtml(details.label)],
            ['Identity', escHtml(details.accountEmail)],
            ['Action', escHtml(copy.verb.charAt(0).toUpperCase() + copy.verb.slice(1))],
            ['Date and time', escHtml(localTime)],
        ];

        const detailRowsHtml = detailRows.map(([label, value]) => `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f9fafb;font-size:12px;font-weight:600;color:#374151;width:34%;">${label}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;word-break:break-word;">${value}</td>
            </tr>
        `).join('');

        const securityNote = details.event === 'disconnected'
            ? `If you did not disconnect this account, sign in to Flux Workflow and reconnect it, then review your account security.`
            : `If you did not ${copy.verb} this account, sign in to Flux Workflow and remove it immediately, then review your account security.`;

        const bodyContent = `
            <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 14px;">
                Your <strong>${escHtml(providerName)}</strong> account <strong>${escHtml(details.label)}</strong>
                was just <strong>${escHtml(copy.heading)}</strong>.
            </p>
            <div style="padding:12px 14px;background:${calloutColors.bg};border:1px solid ${calloutColors.border};border-radius:10px;font-size:14px;color:${calloutColors.text};margin:0 0 16px;">
                ${escHtml(`This is a confirmation that your ${providerName} credential was ${copy.verb}.`)}
            </div>
            <p style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.4px;margin:0 0 8px;">
                Details
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;margin:0 0 16px;">
                ${detailRowsHtml}
            </table>
            <p style="font-size:13px;color:#6b7280;line-height:1.7;margin:0 0 6px;">
                ${escHtml(securityNote)}
            </p>
            <p style="font-size:13px;color:#6b7280;line-height:1.7;margin:0;">
                Manage your connected accounts anytime in
                <a href="${appUrl}" style="color:#6366f1;text-decoration:none;font-weight:500;">Flux Workflow → Credentials</a>.
            </p>
        `;

        const textLines = [
            `Your ${providerName} account "${details.label}" was just ${copy.heading}.`,
            '',
            'Details:',
            `  Provider:      ${providerName}`,
            `  Account:       ${details.label}`,
            `  Identity:      ${details.accountEmail}`,
            `  Action:        ${copy.verb}`,
            `  Date & time:   ${localTime}`,
            '',
            securityNote,
            '',
            `Manage your connected accounts: ${appUrl}`,
        ];

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        const from = `"${process.env.SMTP_FROM_NAME ?? 'Flux Workflow'}" <${process.env.SMTP_FROM_ADDRESS}>`;

        await transporter.sendMail({
            from,
            to: recipient,
            subject,
            text: textLines.join('\n'),
            html: buildFluxMessageHtml(`${providerName} account ${copy.verb}`, bodyContent, true),
        });

        console.log(`[CredentialNotification] "${details.event}" email sent to ${recipient} for ${details.provider} credential ${details.label}`);
    }
}
