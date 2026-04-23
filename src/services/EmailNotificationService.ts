import nodemailer, { type Transporter } from 'nodemailer';
import type { NodeResult } from '../types/workflow.types';
import { NotificationSettingsRepository } from '../repositories/NotificationSettingsRepository';

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

function statusBadge(status: 'success' | 'failure' | 'skipped'): string {
    const map: Record<string, { bg: string; color: string; label: string }> = {
        success: { bg: '#d1fae5', color: '#065f46', label: 'SUCCESS' },
        failure: { bg: '#fee2e2', color: '#991b1b', label: 'FAILURE' },
        skipped: { bg: '#f1f5f9', color: '#475569', label: 'SKIPPED' },
    };
    const s = map[status] ?? map.failure;
    return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${s.bg};color:${s.color};font-size:11px;font-weight:700;letter-spacing:0.5px;">${s.label}</span>`;
}

function nodeResultRows(results: NodeResult[]): string {
    return results
        .map((r) => {
            const isRunner = r.nodeId === '__runner__';
            const nodeLabel = isRunner ? '<em>Runner (startup)</em>' : `<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:12px;">${escHtml(r.nodeId)}</code>`;
            const errorCell = r.error
                ? `<span style="color:#dc2626;font-family:monospace;font-size:12px;word-break:break-all;">${escHtml(r.error)}</span>`
                : '<span style="color:#94a3b8;">—</span>';
            return `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:10px 12px;vertical-align:top;white-space:nowrap;">${nodeLabel}</td>
          <td style="padding:10px 12px;vertical-align:top;text-align:center;">${statusBadge(r.status)}</td>
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
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const execUrl = `${appUrl}`;  // deep links can be added once routing supports it
    const failedNodes = p.results.filter((r) => r.status === 'failure');
    const successNodes = p.results.filter((r) => r.status === 'success');
    const skippedNodes = p.results.filter((r) => r.status === 'skipped');

    const wallClock = p.completedAt.getTime() - p.startedAt.getTime();

    const themeMap = {
        success: { bg: '#f0fdf4', accent: '#16a34a', label: '✓ Workflow Completed Successfully' },
        partial: { bg: '#fff7ed', accent: '#c2410c', label: '⚠ Workflow Partially Failed' },
        failure: { bg: '#fff1f2', accent: '#dc2626', label: '✕ Workflow Failed' },
    };
    const theme = themeMap[p.status] ?? themeMap.failure;
    const headerBg = theme.bg;
    const accentColor = theme.accent;
    const headerLabel = theme.label;

    const triggeredByLabel: Record<string, string> = {
        api:      'API Call',
        webhook:  'Webhook',
        schedule: 'Scheduled Run',
        manual:   'Manual Trigger',
        replay:   'Execution Replay',
    };

    const localTime = p.startedAt.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short',
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Flux Workflow — Execution ${p.status === 'success' ? 'Succeeded' : 'Alert'}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;">
    <tr><td align="center" style="padding:32px 16px;">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:${headerBg};padding:24px 32px;border-bottom:3px solid ${accentColor};">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${accentColor};margin-bottom:4px;">Flux Workflow · Execution Alert</div>
                  <div style="font-size:22px;font-weight:700;color:#0f172a;">${headerLabel}</div>
                  <div style="font-size:14px;color:#64748b;margin-top:4px;">${escHtml(p.workflowName)}</div>
                </td>
                <td style="text-align:right;vertical-align:top;">
                  <div style="font-size:11px;color:#94a3b8;">v${p.workflowVersion}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Summary grid -->
        <tr>
          <td style="padding:24px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Workflow</div>
                  <div style="font-size:13px;font-weight:600;color:#0f172a;">${escHtml(p.workflowName)}</div>
                </td>
                <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Status</div>
                  <div style="font-size:13px;font-weight:700;color:${accentColor};">${p.status.toUpperCase()}</div>
                </td>
              </tr>
              <tr style="background:#ffffff;">
                <td style="padding:12px 16px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Date &amp; Time</div>
                  <div style="font-size:13px;color:#0f172a;">${localTime}</div>
                </td>
                <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Triggered By</div>
                  <div style="font-size:13px;color:#0f172a;">${escHtml(triggeredByLabel[p.triggeredBy] ?? p.triggeredBy)}</div>
                </td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;border-right:1px solid #e2e8f0;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Workflow ID</div>
                  <div style="font-size:12px;font-family:monospace;color:#475569;word-break:break-all;">${escHtml(p.workflowId)}</div>
                </td>
                <td style="padding:12px 16px;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Execution ID</div>
                  <div style="font-size:12px;font-family:monospace;color:#475569;word-break:break-all;">${escHtml(p.executionId)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Stats row -->
        <tr>
          <td style="padding:16px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="padding:12px 16px;text-align:center;border-right:1px solid #e2e8f0;">
                  <div style="font-size:22px;font-weight:700;color:#dc2626;">${failedNodes.length}</div>
                  <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Failed</div>
                </td>
                <td style="padding:12px 16px;text-align:center;border-right:1px solid #e2e8f0;">
                  <div style="font-size:22px;font-weight:700;color:#16a34a;">${successNodes.length}</div>
                  <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Succeeded</div>
                </td>
                <td style="padding:12px 16px;text-align:center;border-right:1px solid #e2e8f0;">
                  <div style="font-size:22px;font-weight:700;color:#64748b;">${skippedNodes.length}</div>
                  <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Skipped</div>
                </td>
                <td style="padding:12px 16px;text-align:center;border-right:1px solid #e2e8f0;">
                  <div style="font-size:22px;font-weight:700;color:#334155;">${p.results.length}</div>
                  <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Total Nodes</div>
                </td>
                <td style="padding:12px 16px;text-align:center;">
                  <div style="font-size:22px;font-weight:700;color:#334155;">${formatDuration(wallClock)}</div>
                  <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Duration</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Failed nodes section -->
        ${failedNodes.length > 0 ? `
        <tr>
          <td style="padding:24px 32px 0;">
            <div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
              ✕ Failed Nodes (${failedNodes.length})
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fecaca;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#fef2f2;">
                  <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;border-bottom:1px solid #fecaca;">NODE ID</th>
                  <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;border-bottom:1px solid #fecaca;">STATUS</th>
                  <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;border-bottom:1px solid #fecaca;">DURATION</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;border-bottom:1px solid #fecaca;">ERROR MESSAGE</th>
                </tr>
              </thead>
              <tbody>
                ${nodeResultRows(failedNodes)}
              </tbody>
            </table>
          </td>
        </tr>` : ''}

        <!-- Full execution log -->
        <tr>
          <td style="padding:24px 32px 0;">
            <div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:10px;">Full Execution Log</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">NODE ID</th>
                  <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">STATUS</th>
                  <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">DURATION</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">ERROR</th>
                </tr>
              </thead>
              <tbody>
                ${nodeResultRows(p.results)}
              </tbody>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:28px 32px;">
            <table cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="border-radius:8px;background:#2563eb;">
                  <a href="${escHtml(execUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;border-radius:8px;">Open Flux Workflow →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #f1f5f9;background:#f8fafc;">
            <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
              This alert was sent automatically by <strong>Flux Workflow</strong>.<br />
              To manage notification settings, open the platform and go to <strong>Notifications</strong> in the toolbar.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
        `Triggered By:  ${p.triggeredBy}`,
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
            lines.push(`  Node: ${n.nodeId}`);
            lines.push(`  Duration: ${formatDuration(n.durationMs)}`);
            lines.push(`  Error: ${n.error ?? 'unknown'}`);
            lines.push('');
        }
    }

    lines.push('FULL EXECUTION LOG');
    lines.push('-'.repeat(40));
    for (const r of p.results) {
        lines.push(`  ${r.nodeId.padEnd(30)} ${r.status.toUpperCase().padEnd(10)} ${formatDuration(r.durationMs)}${r.error ? `  ← ${r.error}` : ''}`);
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

        await transporter.sendMail({
            from,
            to: recipient,
            subject: '✅ Flux Workflow — Test Email',
            text: 'This is a test email from Flux Workflow. Your email notification settings are working correctly.',
            html: `
<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px;background:#f8fafc;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="font-size:32px;margin-bottom:16px;">✅</div>
    <h2 style="margin:0 0 8px;color:#0f172a;">Test Email Successful</h2>
    <p style="color:#64748b;margin:0;">Your Flux Workflow email notification settings are working correctly. You will receive alerts at this address whenever a workflow fails.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
    <p style="font-size:12px;color:#94a3b8;margin:0;">Sent by Flux Workflow Notification Service</p>
  </div>
</body></html>`,
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
