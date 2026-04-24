/**
 * Shared Flux Workflow email templates.
 *
 * Used by:
 *  - EmailNotificationService  (execution alerts)
 *  - GmailNode send_flux action (user-authored branded emails)
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function escHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Loads the platform logo as a base64 data-URI so it is embedded directly
 * in the email and never blocked by external-image policies.
 * Falls back to an empty string (no image rendered) if the file cannot be found.
 */
function getLogoDataUri(): string {
    const candidates = [
        // Production build: dist/public/logo.png  (from dist/utils/ → ../public/)
        join(__dirname, '../public/logo.png'),
        // Development (tsx): src/utils/ → ../../frontend/public/
        join(__dirname, '../../frontend/public/logo.png'),
        // CWD fallback
        join(process.cwd(), 'frontend/public/logo.png'),
    ];
    for (const p of candidates) {
        try {
            const buf = readFileSync(p);
            return `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
            // try next candidate
        }
    }
    return '';
}

// Cache at module load — reads once per process startup
let _logoDataUri: string | null = null;
/** Returns the platform logo as a base64 data-URI (cached after first read). */
export function logoDataUri(): string {
    if (_logoDataUri === null) _logoDataUri = getLogoDataUri();
    return _logoDataUri;
}

/** Flux brand colors derived from the platform logo. */
export const BRAND = {
    primary: '#6366f1',  // indigo-500 — logo background
    dark:    '#4338ca',  // indigo-700
    light:   '#818cf8',  // indigo-400
} as const;

/**
 * Wraps arbitrary body content in the Flux Workflow branded email shell.
 *
 * @param subject  The email subject (shown as the card title inside the email).
 * @param bodyContent  HTML or plain-text body content to embed in the card.
 * @param isHtml   When true, `bodyContent` is embedded as raw HTML.
 *                 When false, it is escaped and wrapped in a pre-style div.
 */
export function buildFluxMessageHtml(subject: string, bodyContent: string, isHtml = true): string {
    const appUrl   = process.env.APP_URL  ?? 'http://localhost:3000';
    const fromName = process.env.SMTP_FROM_NAME ?? 'Flux Workflow';
    const logoUrl  = `${appUrl.replace(/\/+$/, '')}/logo.png`;

    // Logo-derived brand color (flat, no gradients)
    const brandPrimary = '#6366f1';

    const bodySection = isHtml
        ? bodyContent
        : `<div style="font-size:15px;color:#374151;line-height:1.75;white-space:pre-wrap;">${escHtml(bodyContent)}</div>`;

    const logoImg = `<img src="${escHtml(logoUrl)}" alt="${escHtml(fromName)}" width="40" height="40"
               style="width:40px;height:40px;border-radius:10px;object-fit:contain;display:block;border:0;" />`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f0f0f5;padding:40px 16px;">
    <tr><td align="center">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#ffffff;border-radius:16px;overflow:hidden;
                    box-shadow:0 6px 24px rgba(15,23,42,0.08);
                    max-width:600px;width:100%;">

        <!-- Brand header -->
        <tr>
          <td style="background:#ffffff;padding:28px 36px;border-bottom:1px solid #e5e7eb;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="vertical-align:middle;padding-right:12px;">
                        ${logoImg}
                      </td>
                      <td style="vertical-align:middle;">
                        <div style="font-size:20px;font-weight:700;color:#111827;line-height:1.1;">
                          Flux Workflow
                        </div>
                        <div style="font-size:11px;color:#6b7280;letter-spacing:0.8px;text-transform:uppercase;margin-top:3px;">
                          Workflow Automation Platform
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 36px 28px;">
            <h1 style="margin:0 0 18px;font-size:26px;font-weight:700;color:#111827;line-height:1.25;letter-spacing:-0.2px;">
              ${escHtml(subject)}
            </h1>
            ${bodySection}
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 36px;">
            <div style="height:1px;background:#e5e7eb;"></div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 36px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                    Sent via <strong style="color:#6b7280;">${escHtml(fromName)}</strong> automation platform.
                    &nbsp;·&nbsp;
                    <a href="${escHtml(appUrl)}"
                       style="color:${brandPrimary};text-decoration:none;font-weight:500;">
                      Open platform ↗
                    </a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>

      <!-- Bottom padding spacer -->
      <div style="height:32px;"></div>

    </td></tr>
  </table>
</body>
</html>`;
}
