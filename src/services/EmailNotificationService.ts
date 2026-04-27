import nodemailer, { type Transporter } from 'nodemailer';
import type { NodeResult } from '../types/workflow.types';
import { NotificationSettingsRepository } from '../repositories/NotificationSettingsRepository';
import { buildFluxMessageHtml } from '../utils/emailTemplates';

export interface ExecutionNotificationPayload {
    executionId: string;
    workflowId: string;
    workflowName: string;
    workflowVersion: number;
    status: 'success' | 'failure' | 'partial';
    triggeredBy: string;
    startedAt: Date;
    completedAt: Date;
    results: NodeResult[];
    nodeNamesById?: Record<string, string>;
}

/** @deprecated use ExecutionNotificationPayload */
export type FailureNotificationPayload = ExecutionNotificationPayload;

function isSmtpConfigured(): boolean {
    return !!(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.SMTP_FROM_ADDRESS
    );
}

function createTransporter(): Transporter {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure = process.env.SMTP_SECURE === 'true';

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

// ── HTML template ─────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = (ms / 1000).toFixed(2);
    return `${s}s`;
}

function statusBadge(status: 'success' | 'failure' | 'skipped', compact = false): string {
    const map: Record<string, { bg: string; color: string; label: string }> = {
        success: { bg: '#dcfce7', color: '#166534', label: 'Succeeded' },
        failure: { bg: '#fee2e2', color: '#991b1b', label: 'Failed' },
        skipped: { bg: '#f1f5f9', color: '#475569', label: 'Skipped' },
    };
    const s = map[status] ?? map.failure;
    const pad = compact ? '2px 8px' : '4px 10px';
    return `<span style="display:inline-block;padding:${pad};border-radius:9999px;background:${s.bg};color:${s.color};font-size:12px;font-weight:700;">${s.label}</span>`;
}

function statusHeading(status: ExecutionNotificationPayload['status']): string {
    if (status === 'success') return 'Workflow completed successfully';
    if (status === 'partial') return 'Workflow completed with issues';
    return 'Workflow execution failed';
}

function triggeredByLabel(triggeredBy: string): string {
    const map: Record<string, string> = {
        api: 'API call',
        webhook: 'Webhook',
        schedule: 'Scheduled run',
        manual: 'Manual trigger',
        replay: 'Execution replay',
    };
    return map[triggeredBy] ?? triggeredBy;
}

function nodeDisplayName(nodeId: string, nodeNamesById?: Record<string, string>): string {
    if (nodeId === '__runner__') return 'System startup';
    const found = nodeNamesById?.[nodeId]?.trim();
    return found || `Step ${nodeId}`;
}

function nodeDisplayCell(nodeId: string, nodeNamesById?: Record<string, string>): string {
    const name = nodeDisplayName(nodeId, nodeNamesById);
    if (name === nodeId) return `<strong style="font-size:13px;color:#111827;">${escHtml(name)}</strong>`;
    return `<strong style="font-size:13px;color:#111827;">${escHtml(name)}</strong>
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">ID: ${escHtml(nodeId)}</div>`;
}

function nodeResultRows(results: NodeResult[], nodeNamesById?: Record<string, string>): string {
    return results
        .map((r) => {
            const errorCell = r.error
                ? `<span style="color:#b91c1c;font-size:12px;line-height:1.5;word-break:break-word;">${escHtml(r.error)}</span>`
                : '<span style="color:#94a3b8;">No error details</span>';
            return `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:10px 12px;vertical-align:top;">${nodeDisplayCell(r.nodeId, nodeNamesById)}</td>
          <td style="padding:10px 12px;vertical-align:top;text-align:center;">${statusBadge(r.status, true)}</td>
          <td style="padding:10px 12px;vertical-align:top;text-align:right;white-space:nowrap;color:#64748b;font-size:12px;">${formatDuration(r.durationMs)}</td>
          <td style="padding:10px 12px;vertical-align:top;">${errorCell}</td>
        </tr>`;
        })
        .join('');
}

function escHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildEmailHtml(p: ExecutionNotificationPayload): string {
    const failedNodes = p.results.filter((r) => r.status === 'failure');
    const successNodes = p.results.filter((r) => r.status === 'success');
    const skippedNodes = p.results.filter((r) => r.status === 'skipped');
    const wallClock = p.completedAt.getTime() - p.startedAt.getTime();
    const localTime = p.startedAt.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short',
    });
    const statusColor =
        p.status === 'success' ? '#166534'
            : p.status === 'partial' ? '#9a3412'
                : '#991b1b';
    const statusBackground =
        p.status === 'success' ? '#f0fdf4'
            : p.status === 'partial' ? '#fff7ed'
                : '#fef2f2';
    const statusBorder =
        p.status === 'success' ? '#bbf7d0'
            : p.status === 'partial' ? '#fed7aa'
                : '#fecaca';
    const statusMessage =
        p.status === 'success'
            ? `All ${successNodes.length} step${successNodes.length === 1 ? '' : 's'} completed successfully.`
            : p.status === 'partial'
                ? `${failedNodes.length} of ${p.results.length} steps failed.`
                : `${failedNodes.length} step${failedNodes.length === 1 ? '' : 's'} failed and the workflow stopped.`;

    const summaryRows = [
        ['Workflow', escHtml(p.workflowName)],
        ['Status', `<span style="color:${statusColor};font-weight:700;">${escHtml(statusHeading(p.status))}</span>`],
        ['Steps', `${successNodes.length} succeeded, ${failedNodes.length} failed, ${skippedNodes.length} skipped`],
        ['Triggered by', escHtml(triggeredByLabel(p.triggeredBy))],
        ['Date and time', escHtml(localTime)],
        ['Duration', escHtml(formatDuration(wallClock))],
        ['Version', `v${p.workflowVersion}`],
    ].map(([label, value]) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f9fafb;font-size:12px;font-weight:600;color:#374151;width:34%;">${label}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;">${value}</td>
        </tr>
    `).join('');

    const bodyContent = `
      <div style="font-size:15px;color:#374151;line-height:1.7;">
        <p style="margin:0 0 14px;">
          This is an automated update for <strong>${escHtml(p.workflowName)}</strong>.
        </p>
      </div>

      <div style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:${statusBackground};border:1px solid ${statusBorder};">
        <div style="font-size:14px;font-weight:700;color:${statusColor};margin:0 0 4px;">${escHtml(statusHeading(p.status))}</div>
        <div style="font-size:13px;color:${statusColor};line-height:1.5;">${escHtml(statusMessage)}</div>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;">
        ${summaryRows}
      </table>

      <div style="margin-top:20px;font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.4px;">
        Step Summary
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;">Step</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;">Result</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;">Time</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;">Details</th>
          </tr>
        </thead>
        <tbody>${nodeResultRows(p.results, p.nodeNamesById)}</tbody>
      </table>

      <div style="margin-top:20px;font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.4px;">
        Reference IDs
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;">
        <tr>
          <td style="padding:10px 12px;background:#f9fafb;font-size:12px;font-weight:600;color:#374151;width:34%;border-bottom:1px solid #e5e7eb;">Workflow ID</td>
          <td style="padding:10px 12px;font-size:12px;color:#6b7280;word-break:break-word;border-bottom:1px solid #e5e7eb;">${escHtml(p.workflowId)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#f9fafb;font-size:12px;font-weight:600;color:#374151;">Execution ID</td>
          <td style="padding:10px 12px;font-size:12px;color:#6b7280;word-break:break-word;">${escHtml(p.executionId)}</td>
        </tr>
      </table>
    `;

    return buildFluxMessageHtml(
        `${statusHeading(p.status)}: ${p.workflowName}`,
        bodyContent,
        true,
    );
}

function buildEmailText(p: ExecutionNotificationPayload): string {
    const failedNodes = p.results.filter((r) => r.status === 'failure');
    const localTime = p.startedAt.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short',
    });
    const wallClock = p.completedAt.getTime() - p.startedAt.getTime();

    const lines: string[] = [
        `Flux Workflow — Execution ${p.status.toUpperCase()}`,
        '='.repeat(50),
        '',
        `Workflow:      ${p.workflowName} (v${p.workflowVersion})`,
        `Workflow ID:   ${p.workflowId}`,
        `Execution ID:  ${p.executionId}`,
        `Status:        ${p.status.toUpperCase()}`,
        `Triggered By:  ${triggeredByLabel(p.triggeredBy)}`,
        `Date & Time:   ${localTime}`,
        `Duration:      ${formatDuration(wallClock)}`,
        '',
        `Nodes — Failed: ${failedNodes.length}, Succeeded: ${p.results.filter(r => r.status === 'success').length}, Skipped: ${p.results.filter(r => r.status === 'skipped').length}, Total: ${p.results.length}`,
        '',
    ];

    if (failedNodes.length > 0) {
        lines.push('FAILED NODES');
        lines.push('-'.repeat(40));
        for (const n of failedNodes) {
            lines.push(`  Step: ${nodeDisplayName(n.nodeId, p.nodeNamesById)} (ID: ${n.nodeId})`);
            lines.push(`  Duration: ${formatDuration(n.durationMs)}`);
            lines.push(`  Error: ${n.error ?? 'unknown'}`);
            lines.push('');
        }
    }

    lines.push('FULL EXECUTION LOG');
    lines.push('-'.repeat(40));
    for (const r of p.results) {
        const label = `${nodeDisplayName(r.nodeId, p.nodeNamesById)} (ID: ${r.nodeId})`;
        lines.push(`  ${label} — ${r.status.toUpperCase()} — ${formatDuration(r.durationMs)}${r.error ? ` — ${r.error}` : ''}`);
    }

    return lines.join('\n');
}

// ── Service ───────────────────────────────────────────────────────────────────

export class EmailNotificationService {
    private settingsRepo: NotificationSettingsRepository;

    constructor(settingsRepo: NotificationSettingsRepository) {
        this.settingsRepo = settingsRepo;
    }

    /** Returns whether SMTP env vars are fully configured */
    static isConfigured(): boolean {
        return isSmtpConfigured();
    }

    /** Send a test email to verify SMTP config */
    async sendTestEmail(recipient: string): Promise<void> {
        if (!isSmtpConfigured()) {
            throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM_ADDRESS in your environment.');
        }

        const transporter = createTransporter();
        const from = `"${process.env.SMTP_FROM_NAME ?? 'Flux Workflow'}" <${process.env.SMTP_FROM_ADDRESS}>`;

        const testHtml = buildFluxMessageHtml(
            'Test Email Successful',
            `<p style="font-size:15px;color:#374151;margin:0 0 16px;">
               Your <strong>Flux Workflow</strong> email notification settings are working correctly.
             </p>
             <p style="font-size:14px;color:#6b7280;margin:0;">
               You will receive alerts at this address whenever a workflow run matches your configured conditions.
             </p>`,
            true,
        );
        await transporter.sendMail({
            from,
            to: recipient,
            subject: '✅ Flux Workflow — Test Email',
            text: 'This is a test email from Flux Workflow. Your email notification settings are working correctly.',
            html: testHtml,
        });
    }

    /** Called after every execution completes — sends alert if conditions are met */
    async notifyOnCompletion(payload: ExecutionNotificationPayload): Promise<void> {
        const settings = await this.settingsRepo.get();

        if (!settings.enabled) return;
        if (!settings.recipients.length) return;
        if (payload.status === 'failure' && !settings.notifyOnFailure) return;
        if (payload.status === 'partial' && !settings.notifyOnPartial) return;
        if (payload.status === 'success' && !settings.notifyOnSuccess) return;

        if (!isSmtpConfigured()) {
            console.warn('[EmailNotification] SMTP not configured — skipping notification for execution', payload.executionId);
            return;
        }

        try {
            const transporter = createTransporter();
            const from = `"${process.env.SMTP_FROM_NAME ?? 'Flux Workflow'}" <${process.env.SMTP_FROM_ADDRESS}>`;
            const subjectPrefix =
                payload.status === 'success'  ? '✓ Success'        :
                payload.status === 'partial'  ? '⚠ Partial Failure' :
                                               '✕ Workflow Failed';

            await transporter.sendMail({
                from,
                to: settings.recipients.join(', '),
                subject: `${subjectPrefix}: ${payload.workflowName}`,
                text: buildEmailText(payload),
                html: buildEmailHtml(payload),
            });

            console.log(`[EmailNotification] Alert sent for execution ${payload.executionId} (${payload.status}) to ${settings.recipients.length} recipient(s)`);
        } catch (err) {
            console.error('[EmailNotification] Failed to send notification email:', err);
        }
    }
}
