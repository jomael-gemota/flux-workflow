import nodemailer from 'nodemailer';
import { CredentialRepository } from '../repositories/CredentialRepository';
import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { GoogleAuthService, GoogleReauthRequiredError } from './GoogleAuthService';
import { CredentialDocument } from '../db/models/CredentialModel';
import { UserModel } from '../db/models/UserModel';
import { buildFluxMessageHtml } from '../utils/emailTemplates';

/**
 * Hourly health check for Google credentials.
 *
 * Refresh tokens have no predictable expiry — they die from unannounced events
 * (password change with Gmail scopes, manual revocation, Google security
 * sweeps). This service force-exercises every Google refresh token on a fixed
 * cadence so a dead credential is detected within one cycle instead of at the
 * next scheduled workflow run. Side benefits: the stored access token is never
 * stale, and regular refresh-token use prevents Google's 6-month-inactivity
 * expiry.
 *
 * On the `active → reauth_required` transition the credential owner gets one
 * alert email (via platform SMTP — independent of Google OAuth) listing the
 * affected workflows with instructions to reconnect (not delete) the account.
 */
export class CredentialHealthService {
    constructor(
        private credentialRepo: CredentialRepository,
        private workflowRepo: WorkflowRepository,
        private googleAuth: GoogleAuthService,
    ) {}

    /** Run one health-check pass over all Google credentials. */
    async checkAll(): Promise<void> {
        let creds: CredentialDocument[];
        try {
            creds = await this.credentialRepo.findDocsByProvider('google');
        } catch (err) {
            console.error('[CredentialHealth] Failed to list credentials:', err);
            return;
        }

        for (const cred of creds) {
            // Already flagged — only a user reconnect (which resets the status
            // via updateTokens) can fix it; re-checking would just churn.
            if (cred.status === 'reauth_required') continue;

            const credId = (cred._id as object).toString();
            try {
                await this.googleAuth.forceRefreshCredential(credId);
            } catch (err) {
                if (err instanceof GoogleReauthRequiredError) {
                    console.warn(`[CredentialHealth] Google credential ${cred.email} (${credId}) requires reconnection`);
                    await this.credentialRepo
                        .updateStatus(credId, 'reauth_required')
                        .catch((e) => console.error('[CredentialHealth] Failed to update status:', e));
                    await this.notifyOwner(cred, credId).catch((e) =>
                        console.error('[CredentialHealth] Failed to send alert email:', e),
                    );
                } else {
                    // Transient failure (network, Google 5xx) — leave the
                    // credential active and let the next cycle retry.
                    console.warn(`[CredentialHealth] Transient refresh error for ${cred.email}:`, err);
                }
            }
        }
    }

    // ── internals ────────────────────────────────────────────────────────

    /** Workflows whose definition references this credential ID. */
    private async findAffectedWorkflows(credentialId: string): Promise<Array<{ id: string; name: string }>> {
        const { data: workflows } = await this.workflowRepo.findAll(1000);
        return workflows
            .filter((wf) =>
                (wf.nodes ?? []).some(
                    (n) => (n.config as Record<string, unknown> | undefined)?.credentialId === credentialId,
                ),
            )
            .map((wf) => ({ id: wf.id, name: wf.name }));
    }

    private async resolveRecipients(cred: CredentialDocument): Promise<string[]> {
        const recipients = new Set<string>();
        if (cred.userId) {
            const owner = await UserModel.findById(cred.userId).catch(() => null);
            if (owner?.email) recipients.add(owner.email);
        }
        // Fall back to (and also CC) the Google account itself — the user may
        // still read that inbox through other clients.
        if (cred.email && cred.email !== 'unknown@google.com') recipients.add(cred.email);
        return [...recipients];
    }

    private async notifyOwner(cred: CredentialDocument, credentialId: string): Promise<void> {
        if (!isSmtpConfigured()) {
            console.warn('[CredentialHealth] SMTP not configured — cannot send reconnect alert for', cred.email);
            return;
        }

        const recipients = await this.resolveRecipients(cred);
        if (recipients.length === 0) {
            console.warn('[CredentialHealth] No recipients resolved for credential', credentialId);
            return;
        }

        const affected = await this.findAffectedWorkflows(credentialId).catch(() => [] as Array<{ id: string; name: string }>);
        const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

        const workflowListHtml = affected.length > 0
            ? `<ul style="margin:8px 0 0 18px;padding:0;">${affected
                .map((wf) => `<li style="margin:0 0 4px;"><a href="${appUrl}/workflows/${escHtml(wf.id)}" style="color:#6366f1;">${escHtml(wf.name)}</a></li>`)
                .join('')}</ul>`
            : `<p style="font-size:13px;color:#6b7280;margin:8px 0 0;">No workflows currently reference this account.</p>`;

        const bodyContent = `
            <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 14px;">
                The Google account <strong>${escHtml(cred.email)}</strong> connected to Flux Workflow has lost its access:
                Google revoked its authorization (common causes: password change, a security review, or manual revocation).
            </p>
            <div style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;font-size:14px;color:#991b1b;margin:0 0 16px;">
                Workflows using this account will be paused until it is reconnected.
            </div>
            <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 6px;"><strong>How to fix it (takes under a minute):</strong></p>
            <ol style="font-size:14px;color:#374151;line-height:1.8;margin:0 0 16px 18px;padding:0;">
                <li>Open <a href="${appUrl}" style="color:#6366f1;">Flux Workflow</a> and go to <strong>Credentials</strong>.</li>
                <li>Click <strong>Connect Account</strong> and sign in with <strong>${escHtml(cred.email)}</strong>.</li>
                <li>Done — all workflows resume automatically.</li>
            </ol>
            <div style="padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:13px;color:#92400e;margin:0 0 16px;">
                <strong>Important:</strong> do <em>not</em> remove the account before reconnecting — removing it permanently
                disconnects it from every workflow and each one would need to be reconfigured manually.
            </div>
            <p style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.4px;margin:0;">
                Affected workflows (${affected.length})
            </p>
            ${workflowListHtml}
        `;

        const textLines = [
            `The Google account ${cred.email} connected to Flux Workflow has lost its access.`,
            `Workflows using this account will be paused until it is reconnected.`,
            '',
            'How to fix it:',
            `1. Open ${appUrl} and go to Credentials.`,
            `2. Click "Connect Account" and sign in with ${cred.email}.`,
            '3. Done — all workflows resume automatically.',
            '',
            'IMPORTANT: do NOT remove the account before reconnecting.',
            '',
            `Affected workflows (${affected.length}):`,
            ...affected.map((wf) => `- ${wf.name} (${appUrl}/workflows/${wf.id})`),
        ];

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        const from = `"${process.env.SMTP_FROM_NAME ?? 'Flux Workflow'}" <${process.env.SMTP_FROM_ADDRESS}>`;
        const smtpBcc = process.env.SMTP_BCC;

        await transporter.sendMail({
            from,
            to: recipients,
            ...(smtpBcc ? { bcc: smtpBcc } : {}),
            subject: `⚠ Action needed: reconnect Google account ${cred.email}`,
            text: textLines.join('\n'),
            html: buildFluxMessageHtml(`Reconnect Google account ${cred.email}`, bodyContent, true),
        });

        console.log(`[CredentialHealth] Reconnect alert sent for ${cred.email} to ${recipients.join(', ')}`);
    }
}

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
