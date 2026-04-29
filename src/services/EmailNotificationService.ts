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
    nodeTypesById?: Record<string, string>;
    nodeProvidersById?: Record<string, string>;
    /** MongoDB ObjectId string of the workflow owner — used to load per-user notification settings. */
    ownerUserId?: string;
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

function isValidTimeZone(timeZone: string): boolean {
    try {
        Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

function defaultTimeZone(): string {
    const fromEnv = process.env.NOTIFICATION_DEFAULT_TIMEZONE?.trim();
    if (fromEnv && isValidTimeZone(fromEnv)) return fromEnv;
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && isValidTimeZone(resolved)) return resolved;
    return 'UTC';
}

function parseRecipientTimeZoneOverrides(): Record<string, string> {
    const raw = process.env.NOTIFICATION_RECIPIENT_TIMEZONES?.trim();
    if (!raw) return {};

    // Supports either JSON:
    // {"alice@acme.com":"Asia/Manila"}
    // or CSV:
    // alice@acme.com=Asia/Manila,bob@acme.com=America/New_York
    if (raw.startsWith('{')) {
        try {
            const parsed = JSON.parse(raw) as Record<string, string>;
            const cleaned: Record<string, string> = {};
            for (const [email, tz] of Object.entries(parsed)) {
                const key = email.trim().toLowerCase();
                const zone = String(tz).trim();
                if (key && isValidTimeZone(zone)) cleaned[key] = zone;
            }
            return cleaned;
        } catch {
            return {};
        }
    }

    const map: Record<string, string> = {};
    for (const pair of raw.split(',')) {
        const [emailRaw, tzRaw] = pair.split('=');
        const email = emailRaw?.trim().toLowerCase();
        const tz = tzRaw?.trim();
        if (email && tz && isValidTimeZone(tz)) map[email] = tz;
    }
    return map;
}

function resolveRecipientTimeZone(recipientEmail: string): string {
    const overrides = parseRecipientTimeZoneOverrides();
    const direct = overrides[recipientEmail.trim().toLowerCase()];
    return direct || defaultTimeZone();
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

function statusBannerIcon(status: ExecutionNotificationPayload['status']): string {
    if (status === 'success') return '✅';
    if (status === 'partial') return '⚠️';
    return '❌';
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

function fieldIcon(label: string): string {
    const iconMap: Record<string, string> = {
        workflow: '🧩',
        status: '📊',
        steps: '🪜',
        triggeredBy: '🚀',
        dateTime: '🕒',
        duration: '⏱️',
        version: '🏷️',
        workflowId: '🆔',
        executionId: '🔎',
    };
    return iconMap[label] ?? '•';
}

function iconLabel(icon: string, text: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;display:inline-table;vertical-align:middle;">
        <tr>
            <td style="width:18px;height:18px;border-radius:6px;background:#e0e7ff;font-size:12px;line-height:18px;text-align:center;">${icon}</td>
            <td style="padding-left:6px;vertical-align:middle;">${text}</td>
        </tr>
    </table>`;
}

function nodeDisplayName(nodeId: string, nodeNamesById?: Record<string, string>): string {
    if (nodeId === '__runner__') return 'System startup';
    const found = nodeNamesById?.[nodeId]?.trim();
    return found || `Step ${nodeId}`;
}

function notReachedSection(
    results: NodeResult[],
    nodeNamesById?: Record<string, string>,
    nodeTypesById?: Record<string, string>,
    nodeProvidersById?: Record<string, string>,
): string {
    if (!nodeNamesById) return '';

    const reachedIds = new Set(results.map((r) => r.nodeId));
    // Exclude the synthetic runner node — it has no entry in nodeNamesById
    const notReached = Object.keys(nodeNamesById).filter((id) => !reachedIds.has(id));
    if (notReached.length === 0) return '';

    const rows = notReached.map((nodeId) => `
        <tr style="border-bottom:1px solid #fde8d0;background:#fffbf7;">
          <td style="padding:10px 12px;vertical-align:top;">${nodeDisplayCell(nodeId, nodeNamesById, nodeTypesById, nodeProvidersById)}</td>
          <td style="padding:10px 12px;vertical-align:top;text-align:center;">
            <span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:#fed7aa;color:#92400e;font-size:12px;font-weight:700;">Not Run</span>
          </td>
          <td style="padding:10px 12px;vertical-align:top;font-size:12px;color:#92400e;font-style:italic;" colspan="2">
            Not executed — the workflow stopped before reaching this step.
          </td>
        </tr>`).join('');

    return `
      <div style="margin-top:16px;">
        <div style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;">
          <span style="display:inline-block;background:#fed7aa;color:#92400e;border-radius:9999px;padding:1px 8px;font-size:11px;">🚫 Not Reached — ${notReached.length}</span>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fdba74;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;">
          <thead>
            <tr style="background:#fff7ed;">
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#92400e;border-bottom:1px solid #fdba74;">Step</th>
              <th style="padding:9px 12px;text-align:center;font-size:11px;font-weight:700;color:#92400e;border-bottom:1px solid #fdba74;">Result</th>
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#92400e;border-bottom:1px solid #fdba74;" colspan="2">Reason</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
}

function skippedNodeList(
    results: NodeResult[],
    nodeNamesById?: Record<string, string>,
    nodeTypesById?: Record<string, string>,
    nodeProvidersById?: Record<string, string>,
): string {
    const skipped = results.filter((r) => r.status === 'skipped');
    if (skipped.length === 0) return '';

    const rows = skipped.map((r) => `
        <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;">
          <td style="padding:10px 12px;vertical-align:top;">${nodeDisplayCell(r.nodeId, nodeNamesById, nodeTypesById, nodeProvidersById)}</td>
          <td style="padding:10px 12px;vertical-align:top;text-align:center;">${statusBadge('skipped', true)}</td>
          <td style="padding:10px 12px;vertical-align:top;font-size:12px;color:#64748b;font-style:italic;" colspan="2">
            This step was not executed because its branch was not taken.
          </td>
        </tr>`).join('');

    return `
      <div style="margin-top:16px;">
        <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;background:#e2e8f0;color:#475569;border-radius:9999px;padding:1px 8px;font-size:11px;">⏭ Skipped Steps — ${skipped.length}</span>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #cbd5e1;">Step</th>
              <th style="padding:9px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #cbd5e1;">Result</th>
              <th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #cbd5e1;" colspan="2">Reason</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
}

function nodeTypeFor(nodeId: string, nodeTypesById?: Record<string, string>): string {
    if (nodeId === '__runner__') return 'runner';
    return nodeTypesById?.[nodeId] ?? 'unknown';
}

function publicAssetUrl(path: string): string {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return `${appUrl.replace(/\/+$/, '')}${path}`;
}

function nodeLogoSrc(
    nodeId: string,
    nodeTypesById?: Record<string, string>,
    nodeProvidersById?: Record<string, string>,
): string | null {
    const type = nodeTypeFor(nodeId, nodeTypesById);
    if (type === 'llm') {
        const provider = (nodeProvidersById?.[nodeId] ?? 'openai').toLowerCase();
        if (provider === 'anthropic') return publicAssetUrl('/logos/anthropic.png');
        if (provider === 'meta') return publicAssetUrl('/logos/meta.png');
        if (provider === 'gemini') return publicAssetUrl('/logos/gemini.svg');
        if (provider === 'openai') return publicAssetUrl('/logos/openai.png');
        return null;
    }

    const map: Record<string, string> = {
        gmail: '/logos/gmail-removebg-preview.png',
        gdrive: '/logos/gdrive-removebg-preview.png',
        gdocs: '/logos/gdocs-removebg-preview.png',
        gsheets: '/logos/gsheets-removebg-preview.png',
        slack: '/logos/slack.svg',
        teams: '/logos/ms-teams.png',
        basecamp: '/logos/basecamp.png',
    };
    const file = map[type];
    if (!file) return null;
    return publicAssetUrl(file);
}

function fallbackNodeBadge(nodeId: string, nodeTypesById?: Record<string, string>): string {
    const type = nodeTypeFor(nodeId, nodeTypesById);
    const map: Record<string, { icon: string; bg: string; fg: string }> = {
        trigger: { icon: '⚡', bg: '#fef3c7', fg: '#92400e' },
        http: { icon: '🌐', bg: '#e0f2fe', fg: '#075985' },
        llm: { icon: 'AI', bg: '#ede9fe', fg: '#5b21b6' },
        condition: { icon: '⑂', bg: '#e2e8f0', fg: '#334155' },
        switch: { icon: '⇄', bg: '#e2e8f0', fg: '#334155' },
        transform: { icon: '✦', bg: '#ede9fe', fg: '#5b21b6' },
        formatter: { icon: '✎', bg: '#ede9fe', fg: '#5b21b6' },
        output: { icon: '🏁', bg: '#dcfce7', fg: '#166534' },
        runner: { icon: '⚙', bg: '#e2e8f0', fg: '#334155' },
        unknown: { icon: '•', bg: '#f1f5f9', fg: '#475569' },
    };
    const badge = map[type] ?? map.unknown;
    return `<span style="display:inline-block;width:24px;height:24px;border-radius:7px;background:${badge.bg};color:${badge.fg};font-size:12px;font-weight:700;line-height:24px;text-align:center;margin-right:8px;vertical-align:top;">${badge.icon}</span>`;
}

function nodeDisplayCell(
    nodeId: string,
    nodeNamesById?: Record<string, string>,
    nodeTypesById?: Record<string, string>,
    nodeProvidersById?: Record<string, string>,
): string {
    const name = nodeDisplayName(nodeId, nodeNamesById);
    const type = nodeTypeFor(nodeId, nodeTypesById);
    const logoSrc = nodeLogoSrc(nodeId, nodeTypesById, nodeProvidersById);
    const nameContent = name === nodeId
        ? `<strong style="font-size:13px;color:#111827;">${escHtml(name)}</strong>`
        : `<strong style="font-size:13px;color:#111827;">${escHtml(name)}</strong>
           <div style="font-size:11px;color:#6b7280;margin-top:2px;">ID: ${escHtml(nodeId)} · Type: ${escHtml(type)}</div>`;
    const logo = logoSrc
        ? `<img src="${escHtml(logoSrc)}" alt="${escHtml(type)} logo" width="24" height="24" style="width:24px;height:24px;object-fit:contain;display:inline-block;margin-right:8px;vertical-align:top;" />`
        : fallbackNodeBadge(nodeId, nodeTypesById);
    return `<div style="display:block;">
        ${logo}
        <span style="display:inline-block;vertical-align:top;max-width:calc(100% - 36px);">${nameContent}</span>
    </div>`;
}

function nodeResultRows(
    results: NodeResult[],
    nodeNamesById?: Record<string, string>,
    nodeTypesById?: Record<string, string>,
    nodeProvidersById?: Record<string, string>,
): string {
    return results
        .map((r) => {
            const isSkipped = r.status === 'skipped';
            const rowBg = isSkipped ? 'background:#f8fafc;' : '';
            const detailsCell = isSkipped
                ? `<span style="color:#64748b;font-size:12px;font-style:italic;">Not executed — step was skipped</span>`
                : r.error
                    ? `<span style="color:#b91c1c;font-size:12px;line-height:1.5;word-break:break-word;">${escHtml(r.error)}</span>`
                    : `<span style="color:#94a3b8;font-size:12px;">—</span>`;
            const timeCell = isSkipped
                ? `<span style="color:#94a3b8;font-size:12px;">—</span>`
                : `<span style="color:#64748b;font-size:12px;">${formatDuration(r.durationMs)}</span>`;
            return `
        <tr style="border-bottom:1px solid #f1f5f9;${rowBg}">
          <td style="padding:10px 12px;vertical-align:top;">${nodeDisplayCell(r.nodeId, nodeNamesById, nodeTypesById, nodeProvidersById)}</td>
          <td style="padding:10px 12px;vertical-align:top;text-align:center;">${statusBadge(r.status, true)}</td>
          <td style="padding:10px 12px;vertical-align:top;text-align:right;white-space:nowrap;">${timeCell}</td>
          <td style="padding:10px 12px;vertical-align:top;">${detailsCell}</td>
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

function buildEmailHtml(p: ExecutionNotificationPayload, recipientTimeZone: string): string {
    const failedNodes = p.results.filter((r) => r.status === 'failure');
    const successNodes = p.results.filter((r) => r.status === 'success');
    const skippedNodes = p.results.filter((r) => r.status === 'skipped');
    const wallClock = p.completedAt.getTime() - p.startedAt.getTime();
    const localTime = p.startedAt.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short',
        timeZone: recipientTimeZone,
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

    const notReachedCount = p.nodeNamesById
        ? Object.keys(p.nodeNamesById).filter((id) => !p.results.some((r) => r.nodeId === id)).length
        : 0;
    const stepsDetail = [
        `${successNodes.length} succeeded`,
        failedNodes.length > 0 ? `${failedNodes.length} failed` : '',
        skippedNodes.length > 0 ? `${skippedNodes.length} skipped` : '',
        notReachedCount > 0 ? `${notReachedCount} not reached` : '',
    ].filter(Boolean).join(', ');

    const summaryRows = [
        [iconLabel(fieldIcon('workflow'), 'Workflow'), escHtml(p.workflowName)],
        [iconLabel(fieldIcon('status'), 'Status'), `<span style="color:${statusColor};font-weight:700;">${escHtml(statusHeading(p.status))}</span>`],
        [iconLabel(fieldIcon('steps'), 'Steps'), escHtml(stepsDetail)],
        [iconLabel(fieldIcon('triggeredBy'), 'Triggered by'), escHtml(triggeredByLabel(p.triggeredBy))],
        [iconLabel(fieldIcon('dateTime'), 'Date and time'), `${escHtml(localTime)} <span style="color:#6b7280;">(${escHtml(recipientTimeZone)})</span>`],
        [iconLabel(fieldIcon('duration'), 'Duration'), escHtml(formatDuration(wallClock))],
        [iconLabel(fieldIcon('version'), 'Version'), `v${p.workflowVersion}`],
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
        <div style="font-size:14px;font-weight:700;color:${statusColor};margin:0 0 4px;display:flex;align-items:center;gap:8px;">
          <span style="font-size:16px;line-height:1;">${statusBannerIcon(p.status)}</span>
          <span>${escHtml(statusHeading(p.status))}</span>
        </div>
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
        <tbody>${nodeResultRows(p.results, p.nodeNamesById, p.nodeTypesById, p.nodeProvidersById)}</tbody>
      </table>
      ${skippedNodeList(p.results, p.nodeNamesById, p.nodeTypesById, p.nodeProvidersById)}
      ${notReachedSection(p.results, p.nodeNamesById, p.nodeTypesById, p.nodeProvidersById)}

      <div style="margin-top:20px;font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.4px;">
        Reference IDs
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;">
        <tr>
          <td style="padding:10px 12px;background:#f9fafb;font-size:12px;font-weight:600;color:#374151;width:34%;border-bottom:1px solid #e5e7eb;">${iconLabel(fieldIcon('workflowId'), 'Workflow ID')}</td>
          <td style="padding:10px 12px;font-size:12px;color:#6b7280;word-break:break-word;border-bottom:1px solid #e5e7eb;">${escHtml(p.workflowId)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#f9fafb;font-size:12px;font-weight:600;color:#374151;">${iconLabel(fieldIcon('executionId'), 'Execution ID')}</td>
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

function buildEmailText(p: ExecutionNotificationPayload, recipientTimeZone: string): string {
    const failedNodes = p.results.filter((r) => r.status === 'failure');
    const skippedNodes = p.results.filter((r) => r.status === 'skipped');
    const localTime = p.startedAt.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short',
        timeZone: recipientTimeZone,
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
        `Date & Time:   ${localTime} (${recipientTimeZone})`,
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

    if (skippedNodes.length > 0) {
        lines.push('SKIPPED NODES');
        lines.push('-'.repeat(40));
        for (const n of skippedNodes) {
            lines.push(`  Step: ${nodeDisplayName(n.nodeId, p.nodeNamesById)} (ID: ${n.nodeId})`);
            lines.push(`  Type: ${nodeTypeFor(n.nodeId, p.nodeTypesById)}`);
            lines.push('');
        }
    }

    if (p.nodeNamesById) {
        const reachedIds = new Set(p.results.map((r) => r.nodeId));
        const notReached = Object.keys(p.nodeNamesById).filter((id) => !reachedIds.has(id));
        if (notReached.length > 0) {
            lines.push('NOT REACHED (workflow stopped before these steps ran)');
            lines.push('-'.repeat(40));
            for (const nodeId of notReached) {
                lines.push(`  Step: ${nodeDisplayName(nodeId, p.nodeNamesById)} (ID: ${nodeId})`);
                lines.push(`  Type: ${nodeTypeFor(nodeId, p.nodeTypesById)}`);
                lines.push(`  Reason: Workflow stopped due to an earlier failure`);
                lines.push('');
            }
        }
    }

    lines.push('FULL EXECUTION LOG');
    lines.push('-'.repeat(40));
    for (const r of p.results) {
        const label = `${nodeDisplayName(r.nodeId, p.nodeNamesById)} (ID: ${r.nodeId})`;
        const type = nodeTypeFor(r.nodeId, p.nodeTypesById);
        const provider = type === 'llm' ? (p.nodeProvidersById?.[r.nodeId] ?? 'openai') : '';
        const typeText = type === 'llm' ? `${type}:${provider}` : type;
        lines.push(`  ${label} [${typeText}] — ${r.status.toUpperCase()} — ${formatDuration(r.durationMs)}${r.error ? ` — ${r.error}` : ''}`);
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
        // Skip silently if there is no owner to scope the settings lookup to.
        // This can only happen for legacy workflows that predate per-user settings.
        if (!payload.ownerUserId) return;

        const settings = await this.settingsRepo.get(payload.ownerUserId);

        // Notifications are now fully per-workflow. If this workflow has no override
        // configured (or it is disabled), skip silently.
        const workflowOverride = (settings.workflowOverrides as Record<string, {
            enabled: boolean;
            notifyOnFailure: boolean;
            notifyOnPartial: boolean;
            notifyOnSuccess: boolean;
            recipients: string[];
        }>)?.[payload.workflowId];

        if (!workflowOverride?.enabled) return;
        if (payload.status === 'failure' && !workflowOverride.notifyOnFailure) return;
        if (payload.status === 'partial' && !workflowOverride.notifyOnPartial) return;
        if (payload.status === 'success' && !workflowOverride.notifyOnSuccess) return;

        const recipients = workflowOverride.recipients;
        if (!recipients.length) return;

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
            const subject = `${subjectPrefix}: ${payload.workflowName}`;

            const deliveries = await Promise.allSettled(
                recipients.map(async (recipient) => {
                    const recipientTimeZone = resolveRecipientTimeZone(recipient);
                    await transporter.sendMail({
                        from,
                        to: recipient,
                        subject,
                        text: buildEmailText(payload, recipientTimeZone),
                        html: buildEmailHtml(payload, recipientTimeZone),
                    });
                    return recipient;
                }),
            );

            const sentCount = deliveries.filter((r) => r.status === 'fulfilled').length;
            const failedCount = deliveries.length - sentCount;
            if (failedCount > 0) {
                console.warn(`[EmailNotification] Sent ${sentCount}/${deliveries.length} alerts for execution ${payload.executionId}; ${failedCount} failed`);
            } else {
                console.log(`[EmailNotification] Alert sent for execution ${payload.executionId} (${payload.status}) to ${sentCount} recipient(s)`);
            }
        } catch (err) {
            console.error('[EmailNotification] Failed to send notification email:', err);
        }
    }
}
