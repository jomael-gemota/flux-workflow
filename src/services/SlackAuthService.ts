import { CredentialRepository } from '../repositories/CredentialRepository';
import { getBaseUrl } from '../utils/baseUrl';

// Bot token scopes — used by the Slack app itself
const SLACK_BOT_SCOPES = [
    'channels:read',
    'chat:write',
    'files:write',
    'groups:history',
    'groups:read',
    'im:history',
    'im:write',
    'users:read',
].join(',');

// User token scopes — used to act on behalf of the connected user
const SLACK_USER_SCOPES = [
    'channels:history',
    'channels:read',
    'chat:write',
    'files:write',
    'groups:history',
    'groups:read',
    'im:history',
    'im:write',
    'users:read',
].join(',');

const getDefaultRedirectUri = () =>
    `${getBaseUrl()}/api/oauth/slack/callback`;

export class SlackAuthService {
    private credentialRepo: CredentialRepository;

    constructor(credentialRepo: CredentialRepository) {
        this.credentialRepo = credentialRepo;
    }

    isConfigured(): boolean {
        return !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
    }

    private assertConfigured(): void {
        if (!process.env.SLACK_CLIENT_ID) {
            throw new Error(
                'SLACK_CLIENT_ID is not set. Add it to your .env file. ' +
                'Get it from your Slack app at https://api.slack.com/apps.'
            );
        }
        if (!process.env.SLACK_CLIENT_SECRET) {
            throw new Error(
                'SLACK_CLIENT_SECRET is not set. Add it to your .env file. ' +
                'Get it from your Slack app at https://api.slack.com/apps.'
            );
        }
    }

    /** Returns the Slack OAuth consent page URL requesting both bot and user scopes.
     *  Pass `state` to round-trip data (e.g. userId) through the OAuth flow. */
    getAuthorizationUrl(state?: string): string {
        this.assertConfigured();
        const clientId    = encodeURIComponent(process.env.SLACK_CLIENT_ID!);
        const redirectUri = encodeURIComponent(process.env.SLACK_REDIRECT_URI ?? getDefaultRedirectUri());
        // scope and user_scope must NOT be percent-encoded — Slack parses : and , literally
        return (
            `https://slack.com/oauth/v2/authorize` +
            `?client_id=${clientId}` +
            `&scope=${SLACK_BOT_SCOPES}` +
            `&user_scope=${SLACK_USER_SCOPES}` +
            `&redirect_uri=${redirectUri}` +
            (state ? `&state=${encodeURIComponent(state)}` : '')
        );
    }

    /**
     * Exchange an authorization code for tokens and save the credential.
     * Stores the user token as the primary access token (so actions are
     * performed on behalf of the connected user, not the bot).
     * The bot token is kept in the refreshToken field for fallback use.
     */
    async handleCallback(code: string, platformUserId?: string): Promise<{ teamName: string; userName: string }> {
        this.assertConfigured();

        const redirectUri = process.env.SLACK_REDIRECT_URI ?? getDefaultRedirectUri();

        const body = new URLSearchParams({
            client_id:     process.env.SLACK_CLIENT_ID!,
            client_secret: process.env.SLACK_CLIENT_SECRET!,
            code,
            redirect_uri:  redirectUri,
        });

        const response = await fetch('https://slack.com/api/oauth.v2.access', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    body.toString(),
        });

        if (!response.ok) {
            throw new Error(`Slack OAuth request failed: ${response.statusText}`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await response.json() as Record<string, any>;

        if (!data.ok) {
            throw new Error(`Slack OAuth error: ${data.error ?? 'unknown'}`);
        }

        const botToken  = (data.access_token as string) ?? '';
        const userToken = (data.authed_user?.access_token as string) ?? '';
        const teamName  = (data.team?.name as string) ?? 'Slack Workspace';
        const teamId    = (data.team?.id  as string) ?? '';
        const userId    = (data.authed_user?.id as string) ?? '';

        // Prefer the user token as the primary token; fall back to bot token
        const primaryToken = userToken || botToken;

        // Label format: "Workspace Name (user ID)" so the dropdown is human-readable
        const label = userToken ? `${teamName} (${userId})` : teamName;

        // Upsert: same workspace + same slackUserId = update existing credential
        const upsertKey = userToken ? `${teamId}:${userId}` : teamId;
        const existing = await this.credentialRepo.findAllForUpsert(platformUserId);
        const match = existing.find((c) => c.provider === 'slack' && c.email === upsertKey);

        if (match) {
            await this.credentialRepo.updateTokens(match.id, {
                accessToken:  primaryToken,
                refreshToken: botToken,
                expiryDate:   0,
            });
        } else {
            await this.credentialRepo.create({
                provider:     'slack',
                label,
                email:        upsertKey,
                accessToken:  primaryToken,
                refreshToken: botToken,
                expiryDate:   0,
                scopes:       SLACK_USER_SCOPES.split(','),
                ...(platformUserId ? { userId: platformUserId } : {}),
            });
        }

        return { teamName, userName: userId };
    }

    /** Returns the primary token (user token when available, bot token otherwise) */
    async getToken(credentialId: string): Promise<string> {
        const cred = await this.credentialRepo.findById(credentialId);
        if (!cred) {
            throw new Error(
                `Slack credential "${credentialId}" not found. ` +
                'Connect your Slack workspace first via Credentials.'
            );
        }
        return cred.accessToken;
    }

    /**
     * Returns the Flux Bot token (bot access token stored in refreshToken).
     * Falls back to the user token if no separate bot token was issued.
     */
    async getFluxBotToken(credentialId: string): Promise<string> {
        const cred = await this.credentialRepo.findById(credentialId);
        if (!cred) {
            throw new Error(
                `Slack credential "${credentialId}" not found. ` +
                'Connect your Slack workspace first via Credentials.'
            );
        }
        return cred.refreshToken || cred.accessToken;
    }

    /** @deprecated Use getToken() instead */
    async getBotToken(credentialId: string): Promise<string> {
        return this.getToken(credentialId);
    }
}
