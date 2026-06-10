import { FastifyInstance } from 'fastify';
import { GoogleAuthService } from '../services/GoogleAuthService';
import { SlackAuthService } from '../services/SlackAuthService';
import { TeamsAuthService } from '../services/TeamsAuthService';
import { BasecampAuthService } from '../services/BasecampAuthService';
import { CredentialRepository } from '../repositories/CredentialRepository';
import { CredentialNotificationService } from '../services/CredentialNotificationService';
import { getBaseUrl } from '../utils/baseUrl';

// ── State helpers — carry userId safely through the OAuth redirect round-trip ──

function encodeOAuthState(uid: string): string {
    return Buffer.from(JSON.stringify({ uid })).toString('base64url');
}

function decodeOAuthState(state: string | undefined): string | undefined {
    if (!state) return undefined;
    try {
        const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { uid?: string };
        return parsed.uid ?? undefined;
    } catch {
        return undefined;
    }
}

export async function oauthRoutes(
    fastify: FastifyInstance,
    options: { googleAuth: GoogleAuthService; slackAuth: SlackAuthService; teamsAuth: TeamsAuthService; basecampAuth: BasecampAuthService; credentialRepo: CredentialRepository; credentialNotifier: CredentialNotificationService }
): Promise<void> {
    const { googleAuth, slackAuth, teamsAuth, basecampAuth, credentialRepo, credentialNotifier } = options;

    /** Check whether Google OAuth is configured */
    fastify.get('/oauth/google/status', async (_request, reply) => {
        const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        const redirectUri  = process.env.GOOGLE_REDIRECT_URI ?? `${getBaseUrl()}/oauth/google/callback`;
        return reply.code(200).send({ configured, redirectUri });
    });

    /** Redirect browser to Google consent page */
    fastify.get<{ Querystring: { uid?: string } }>('/oauth/google/authorize', async (request, reply) => {
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
            const msg = encodeURIComponent(
                'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file.'
            );
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            return reply.redirect(`${frontendBase}?oauth_error=${msg}`);
        }
        const state = request.query.uid ? encodeOAuthState(request.query.uid) : undefined;
        const url = googleAuth.getAuthUrl(state);
        return reply.redirect(url);
    });

    /** Google redirects here after the user approves */
    fastify.get<{ Querystring: { code?: string; error?: string; state?: string } }>(
        '/oauth/google/callback',
        async (request, reply) => {
            const { code, error, state } = request.query;
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            const platformUserId = decodeOAuthState(state);

            if (error || !code) {
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(error ?? 'missing_code')}`);
            }

            try {
                const { email, accessToken, refreshToken, expiryDate } =
                    await googleAuth.exchangeCode(code);

                // Upsert: if this email is already connected for this user, update its tokens
                const existing = await credentialRepo.findAllForUpsert(platformUserId);
                const match = existing.find((c) => c.email === email && c.provider === 'google');

                if (match) {
                    await credentialRepo.updateTokens(match.id, { accessToken, refreshToken, expiryDate });
                } else {
                    await credentialRepo.create({
                        provider:     'google',
                        label:        email,
                        email,
                        accessToken,
                        refreshToken,
                        expiryDate,
                        scopes: [],
                        ...(platformUserId ? { userId: platformUserId } : {}),
                    });
                }

                credentialNotifier
                    .notify({
                        event:        match ? 'reconnected' : 'connected',
                        provider:     'google',
                        label:        email,
                        accountEmail: email,
                        ownerUserId:  platformUserId,
                    })
                    .catch((e) => fastify.log.error(e, 'Google credential notification failed'));

                return reply.redirect(`${frontendBase}?oauth_success=google`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'oauth_error';
                fastify.log.error(err, 'Google OAuth callback failed');
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(msg)}`);
            }
        }
    );

    // ── Slack OAuth ────────────────────────────────────────────────────────────

    /** Check whether Slack OAuth is configured */
    fastify.get('/oauth/slack/status', async (_request, reply) => {
        const configured = slackAuth.isConfigured();
        const redirectUri = process.env.SLACK_REDIRECT_URI ?? `${getBaseUrl()}/oauth/slack/callback`;
        return reply.code(200).send({ configured, redirectUri });
    });

    /** Redirect browser to Slack consent page */
    fastify.get<{ Querystring: { uid?: string } }>('/oauth/slack/authorize', async (request, reply) => {
        if (!slackAuth.isConfigured()) {
            const msg = encodeURIComponent(
                'Slack OAuth is not configured. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to your .env file.'
            );
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            return reply.redirect(`${frontendBase}?oauth_error=${msg}`);
        }
        const state = request.query.uid ? encodeOAuthState(request.query.uid) : undefined;
        const url = slackAuth.getAuthorizationUrl(state);
        return reply.redirect(url);
    });

    /** Slack redirects here after the user approves */
    fastify.get<{ Querystring: { code?: string; error?: string; state?: string } }>(
        '/oauth/slack/callback',
        async (request, reply) => {
            const { code, error, state } = request.query;
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            const platformUserId = decodeOAuthState(state);

            if (error || !code) {
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(error ?? 'missing_code')}`);
            }

            try {
                await slackAuth.handleCallback(code, platformUserId);
                return reply.redirect(`${frontendBase}?oauth_success=slack`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'oauth_error';
                fastify.log.error(err, 'Slack OAuth callback failed');
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(msg)}`);
            }
        }
    );

    // ── Microsoft Teams OAuth ──────────────────────────────────────────────────

    /** Check whether Teams OAuth is configured */
    fastify.get('/oauth/teams/status', async (_request, reply) => {
        const configured  = teamsAuth.isConfigured();
        const redirectUri = process.env.TEAMS_REDIRECT_URI ?? `${getBaseUrl()}/api/oauth/teams/callback`;
        return reply.code(200).send({ configured, redirectUri });
    });

    /** Redirect browser to Microsoft consent page */
    fastify.get<{ Querystring: { uid?: string } }>('/oauth/teams/authorize', async (request, reply) => {
        if (!teamsAuth.isConfigured()) {
            const msg = encodeURIComponent(
                'Teams OAuth is not configured. Add TEAMS_CLIENT_ID and TEAMS_CLIENT_SECRET to your .env file.'
            );
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            return reply.redirect(`${frontendBase}?oauth_error=${msg}`);
        }
        const state = request.query.uid ? encodeOAuthState(request.query.uid) : undefined;
        const url = teamsAuth.getAuthorizationUrl(state);
        return reply.redirect(url);
    });

    /** Microsoft redirects here after the user approves */
    fastify.get<{ Querystring: { code?: string; error?: string; error_description?: string; state?: string } }>(
        '/oauth/teams/callback',
        async (request, reply) => {
            const { code, error, error_description, state } = request.query;
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            const platformUserId = decodeOAuthState(state);

            if (error || !code) {
                const msg = error_description ?? error ?? 'missing_code';
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(msg)}`);
            }

            try {
                await teamsAuth.handleCallback(code, platformUserId);
                return reply.redirect(`${frontendBase}?oauth_success=teams`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'oauth_error';
                fastify.log.error(err, 'Teams OAuth callback failed');
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(msg)}`);
            }
        }
    );

    // ── Basecamp OAuth ─────────────────────────────────────────────────────────

    fastify.get('/oauth/basecamp/status', async (_request, reply) => {
        const configured  = basecampAuth.isConfigured();
        const redirectUri = process.env.BASECAMP_REDIRECT_URI ?? `${getBaseUrl()}/api/oauth/basecamp/callback`;
        return reply.code(200).send({ configured, redirectUri });
    });

    fastify.get<{ Querystring: { uid?: string } }>('/oauth/basecamp/authorize', async (request, reply) => {
        if (!basecampAuth.isConfigured()) {
            const msg = encodeURIComponent(
                'Basecamp OAuth is not configured. Add BASECAMP_CLIENT_ID and BASECAMP_CLIENT_SECRET to your .env file.'
            );
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            return reply.redirect(`${frontendBase}?oauth_error=${msg}`);
        }
        const state = request.query.uid ? encodeOAuthState(request.query.uid) : undefined;
        const url = basecampAuth.getAuthorizationUrl(state);
        return reply.redirect(url);
    });

    fastify.get<{ Querystring: { code?: string; error?: string; state?: string } }>(
        '/oauth/basecamp/callback',
        async (request, reply) => {
            const { code, error, state } = request.query;
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            const platformUserId = decodeOAuthState(state);

            if (error || !code) {
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(error ?? 'missing_code')}`);
            }

            try {
                await basecampAuth.handleCallback(code, platformUserId);
                return reply.redirect(`${frontendBase}?oauth_success=basecamp`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'oauth_error';
                fastify.log.error(err, 'Basecamp OAuth callback failed');
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(msg)}`);
            }
        }
    );
}
