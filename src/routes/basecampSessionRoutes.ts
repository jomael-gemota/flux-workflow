import { FastifyInstance, FastifyRequest } from 'fastify';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { apiKeyAuth } from '../middleware/auth';
import { CredentialRepository } from '../repositories/CredentialRepository';
import { BasecampAuthService } from '../services/BasecampAuthService';
import { NotFoundError, BadRequestError, ForbiddenError } from '../errors/ApiError';
import { buildZip } from '../utils/zipBuilder';
import { makeSolidPng } from '../utils/pngBuilder';
import type { BasecampWebCookie, BasecampWebSession } from '../db/models/CredentialModel';

const USER_AGENT     = 'WorkflowAutomationPlatform (basecamp-integration)';
const EXTENSION_DIR  = join(__dirname, '..', '..', 'extension');
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — Basecamp's typical session lifetime

function getRequestUserId(request: FastifyRequest): string | undefined {
    return (request as unknown as { user?: { sub?: string } }).user?.sub;
}

/**
 * Best-effort identification of the host origin the credentials page is
 * served from. Used to pre-fill the extension manifest's
 * `content_scripts.matches` and `externally_connectable.matches` patterns
 * so the extension only ever talks to *this* deployment.
 *
 * Order of precedence:
 *   1. ?origin=… query param (lets the frontend force a specific origin
 *      even when the request comes through a proxy that mangles headers)
 *   2. Origin / Referer headers
 *   3. Forwarded headers (`x-forwarded-host` / `x-forwarded-proto`)
 *   4. The request's own host
 */
function deriveHostOrigin(request: FastifyRequest, explicit?: string): string | null {
    if (explicit) return normalizeOrigin(explicit);

    const headers = request.headers;
    const fromOrigin  = typeof headers.origin  === 'string' ? headers.origin  : undefined;
    if (fromOrigin)  return normalizeOrigin(fromOrigin);

    const fromReferer = typeof headers.referer === 'string' ? headers.referer : undefined;
    if (fromReferer) {
        try { return normalizeOrigin(new URL(fromReferer).origin); } catch { /* fall through */ }
    }

    const xfHost  = typeof headers['x-forwarded-host']  === 'string' ? (headers['x-forwarded-host']  as string) : undefined;
    const xfProto = typeof headers['x-forwarded-proto'] === 'string' ? (headers['x-forwarded-proto'] as string) : undefined;
    if (xfHost)  return normalizeOrigin(`${xfProto ?? 'https'}://${xfHost.split(',')[0].trim()}`);

    const host = typeof headers.host === 'string' ? headers.host : undefined;
    if (host) {
        const proto = (request.protocol ?? 'http').toString();
        return normalizeOrigin(`${proto}://${host}`);
    }
    return null;
}

function normalizeOrigin(raw: string): string {
    try {
        const u = new URL(raw);
        return `${u.protocol}//${u.host}`;
    } catch {
        return raw.replace(/\/+$/, '');
    }
}

/**
 * Build the Chrome MV3 match patterns the extension should be allowed to talk
 * to. We always include the deployment origin plus the standard localhost
 * patterns (so devs don't have to re-download the extension between dev and
 * staging). Chrome's pattern grammar requires the path component (`/*`).
 */
function buildMatchPatterns(origin: string | null): string[] {
    const localhostPatterns = [
        'http://localhost/*',
        'http://localhost:*/*',
        'http://127.0.0.1/*',
        'http://127.0.0.1:*/*',
    ];
    if (!origin) return localhostPatterns;

    let host: string;
    try { host = new URL(origin).host; } catch { return localhostPatterns; }

    // Already covered by localhostPatterns
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return localhostPatterns;

    let proto = 'https';
    try { proto = new URL(origin).protocol.replace(':', ''); } catch { /* keep https */ }

    return [...localhostPatterns, `${proto}://${host}/*`];
}

/**
 * Lazily compose the extension archive for the requesting origin. The PNG
 * icons are generated in-memory rather than checked into the repo.
 */
async function buildExtensionZip(origin: string | null): Promise<Buffer> {
    const [serviceWorkerJs, contentScriptJs, readmeMd, manifestRaw] = await Promise.all([
        readFile(join(EXTENSION_DIR, 'service_worker.js')),
        readFile(join(EXTENSION_DIR, 'content_script.js')),
        readFile(join(EXTENSION_DIR, 'README.md')),
        readFile(join(EXTENSION_DIR, 'manifest.template.json'), 'utf8'),
    ]);

    const matches  = buildMatchPatterns(origin);
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;

    // Inject the deployment-specific match patterns. Anything else stays as-is.
    if (Array.isArray((manifest as { content_scripts?: Array<{ matches?: string[] }> }).content_scripts)) {
        const cs = (manifest as { content_scripts: Array<{ matches?: string[] }> }).content_scripts;
        for (const entry of cs) entry.matches = matches;
    }
    (manifest as { externally_connectable?: { matches?: string[] } }).externally_connectable = { matches };

    // Fill in the README's host placeholder so users can verify which deployment
    // the extension was built for at a glance.
    const readmeStamped = Buffer.from(
        readmeMd.toString('utf8').replace(/__HOST_DISPLAY__/g, origin ?? '(unknown — re-download from your platform)'),
        'utf8',
    );

    // Basecamp's brand green, used for the placeholder icons. Distinguishes
    // this helper from arbitrary developer-mode extensions in chrome://extensions.
    const ICON_R = 21;
    const ICON_G = 75;
    const ICON_B = 47;

    return buildZip([
        { path: 'manifest.json',       data: Buffer.from(JSON.stringify(manifest, null, 4) + '\n', 'utf8') },
        { path: 'service_worker.js',   data: serviceWorkerJs },
        { path: 'content_script.js',   data: contentScriptJs },
        { path: 'README.md',           data: readmeStamped },
        { path: 'icons/icon-16.png',   data: makeSolidPng(16,  ICON_R, ICON_G, ICON_B) },
        { path: 'icons/icon-48.png',   data: makeSolidPng(48,  ICON_R, ICON_G, ICON_B) },
        { path: 'icons/icon-128.png',  data: makeSolidPng(128, ICON_R, ICON_G, ICON_B) },
    ]);
}

/**
 * Validate a bag of Basecamp web cookies by hitting an authenticated web-app
 * route and checking that we don't get bounced to the sign-in page. Also
 * extracts the logged-in identity (email) so the credentials UI can show
 * "Synced as foo@bar.com" — and so we can reject syncs from a different
 * Basecamp user than the credential is actually for.
 *
 * Strategy: GET `https://launchpad.37signals.com/identity` with the cookie
 * header. Launchpad redirects to `/signin` when the session is invalid and
 * returns a small JSON identity document otherwise. We follow no redirects so
 * we can distinguish unambiguously.
 */
async function validateWebSession(cookies: BasecampWebCookie[]): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    if (!cookieHeader) return { ok: false, reason: 'no cookies provided' };

    // Ask Launchpad's identity endpoint who the cookie belongs to. Launchpad
    // is the SSO root for Basecamp, so a valid `_bc3_session` paired with
    // launchpad cookies always resolves here.
    let identityRes: Response;
    try {
        identityRes = await fetch('https://launchpad.37signals.com/identity', {
            method:   'GET',
            redirect: 'manual',
            headers: {
                Cookie:       cookieHeader,
                Accept:       'application/json',
                'User-Agent': USER_AGENT,
            },
        });
    } catch (err) {
        return { ok: false, reason: `network error contacting launchpad: ${(err as Error).message}` };
    }

    if (identityRes.status >= 300 && identityRes.status < 400) {
        return { ok: false, reason: 'session redirected to sign-in — cookies are expired or invalid' };
    }
    if (!identityRes.ok) {
        return { ok: false, reason: `launchpad returned ${identityRes.status}` };
    }

    let body: unknown;
    try { body = await identityRes.json(); }
    catch { return { ok: false, reason: 'launchpad returned a non-JSON body — likely an HTML sign-in page' }; }

    const email =
        (body as { email_address?: string })?.email_address ??
        (body as { email?: string })?.email ??
        (body as { identity?: { email_address?: string } })?.identity?.email_address;
    if (!email || typeof email !== 'string') {
        return { ok: false, reason: 'launchpad response did not include an email address' };
    }

    return { ok: true, email };
}

/**
 * Compute a UI-friendly "expires at" timestamp (ms). Prefer the soonest
 * cookie expiry that's still in the future. When every cookie is a session
 * cookie (no expirationDate), fall back to the typical Basecamp session
 * lifetime so the UI has *something* meaningful to show.
 */
function computeSessionExpiry(cookies: BasecampWebCookie[]): number {
    const now = Date.now();
    const futureExpiries = cookies
        .map((c) => (typeof c.expirationDate === 'number' ? c.expirationDate * 1000 : null))
        .filter((t): t is number => t !== null && t > now);
    if (futureExpiries.length === 0) return now + SESSION_TTL_MS;
    return Math.min(...futureExpiries);
}

export async function basecampSessionRoutes(
    fastify: FastifyInstance,
    options: { credentialRepo: CredentialRepository; basecampAuth: BasecampAuthService },
): Promise<void> {
    const { credentialRepo } = options;

    /**
     * Download the browser extension as a ZIP, manifest pre-filled with this
     * deployment's origin so the extension only talks to *this* server.
     *
     * Auth: required (apiKeyAuth — JWT or API key).
     * Query: optional `origin` override; mostly useful when the platform is
     *   served behind a reverse proxy that strips the Origin header.
     */
    fastify.get<{ Querystring: { origin?: string } }>(
        '/basecamp/extension.zip',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const origin = deriveHostOrigin(request, request.query.origin);
            const zip    = await buildExtensionZip(origin);
            reply
                .header('Content-Type',         'application/zip')
                .header('Content-Disposition',  'attachment; filename="wfp-basecamp-helper.zip"')
                .header('Cache-Control',        'no-store')
                .header('X-Extension-Origin',   origin ?? 'unknown')
                .send(zip);
        },
    );

    /**
     * Receive a cookie payload from the extension, validate it against
     * Launchpad, and (only if validation succeeds) store it encrypted on the
     * credential. Validation prevents storing useless cookies and surfaces
     * the actual logged-in user so the UI can warn on mismatches.
     */
    fastify.post<{
        Body: {
            credentialId: string;
            cookies:      BasecampWebCookie[];
        };
    }>(
        '/basecamp/sync-session',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const { credentialId, cookies } = request.body ?? {};
            if (!credentialId || typeof credentialId !== 'string') {
                throw BadRequestError('credentialId is required');
            }
            if (!Array.isArray(cookies)) {
                throw BadRequestError('cookies must be an array');
            }

            const userId = getRequestUserId(request);
            const cred   = await credentialRepo.findById(credentialId);
            if (!cred || cred.provider !== 'basecamp') {
                throw NotFoundError(`Basecamp credential ${credentialId}`);
            }
            if (userId && cred.userId && cred.userId !== userId) {
                throw ForbiddenError('You do not own this credential');
            }

            // Whitelist by domain — never store cookies for unrelated origins.
            // The extension already filters, but we re-check defensively in
            // case a bad request is hand-crafted.
            const allowed = cookies.filter((c) =>
                typeof c?.name   === 'string' &&
                typeof c?.value  === 'string' &&
                typeof c?.domain === 'string' &&
                /(^|\.)basecamp\.com$|(^|\.)37signals\.com$/i.test(c.domain.replace(/^\./, ''))
            );

            if (allowed.length === 0) {
                throw BadRequestError(
                    'No basecamp.com / 37signals.com cookies found in the payload. ' +
                    'Make sure you are signed into Basecamp in this browser before clicking Sync.',
                );
            }

            // Live-check the session against Launchpad's identity endpoint.
            const validation = await validateWebSession(allowed);
            if (!validation.ok) {
                return reply.code(400).send({
                    ok:    false,
                    error: 'invalid_session',
                    reason: validation.reason,
                    hint: 'Open Basecamp in this browser, sign in, then click Sync again.',
                });
            }

            // Identity guard: refuse to store a session belonging to a
            // different Basecamp user than the OAuth credential is for.
            // `cred.email` is "<accountId>:<userEmail>" (see BasecampAuthService).
            const colonIdx       = cred.email.indexOf(':');
            const credUserEmail  = colonIdx >= 0 ? cred.email.substring(colonIdx + 1) : cred.email;
            if (
                credUserEmail &&
                validation.email &&
                credUserEmail.toLowerCase() !== validation.email.toLowerCase()
            ) {
                return reply.code(400).send({
                    ok:    false,
                    error: 'identity_mismatch',
                    reason: `The browser session is for ${validation.email}, but this credential was connected as ${credUserEmail}. Sign in to Basecamp as ${credUserEmail} and click Sync again, or connect a new credential for ${validation.email}.`,
                });
            }

            const session: BasecampWebSession = {
                cookies:   allowed,
                identity:  validation.email,
                expiresAt: computeSessionExpiry(allowed),
                syncedAt:  Date.now(),
            };
            const stored = await credentialRepo.setBasecampWebSession(credentialId, session, userId);
            if (!stored) throw NotFoundError(`Basecamp credential ${credentialId}`);

            return reply.code(200).send({
                ok:          true,
                identity:    session.identity,
                expiresAt:   session.expiresAt,
                syncedAt:    session.syncedAt,
                cookieCount: session.cookies.length,
            });
        },
    );

    /** Drop the stored web session — used by a "Disconnect session" button. */
    fastify.delete<{ Params: { id: string } }>(
        '/basecamp/sync-session/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            const ok = await credentialRepo.clearBasecampWebSession(request.params.id, userId);
            if (!ok) throw NotFoundError(`Basecamp credential ${request.params.id}`);
            return reply.code(200).send({ ok: true });
        },
    );
}
