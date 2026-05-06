import { CredentialRepository } from '../repositories/CredentialRepository';
import { getBaseUrl } from '../utils/baseUrl';
import type { BasecampWebSession } from '../db/models/CredentialModel';

const USER_AGENT = 'WorkflowAutomationPlatform (basecamp-integration)';

const getDefaultRedirectUri = () =>
    `${getBaseUrl()}/api/oauth/basecamp/callback`;

export class BasecampAuthService {
    private credentialRepo: CredentialRepository;

    constructor(credentialRepo: CredentialRepository) {
        this.credentialRepo = credentialRepo;
    }

    isConfigured(): boolean {
        return !!(process.env.BASECAMP_CLIENT_ID && process.env.BASECAMP_CLIENT_SECRET);
    }

    private assertConfigured(): void {
        if (!process.env.BASECAMP_CLIENT_ID) {
            throw new Error(
                'BASECAMP_CLIENT_ID is not set. Add it to your .env file. ' +
                'Register your app at https://launchpad.37signals.com/integrations.'
            );
        }
        if (!process.env.BASECAMP_CLIENT_SECRET) {
            throw new Error(
                'BASECAMP_CLIENT_SECRET is not set. Add it to your .env file. ' +
                'Register your app at https://launchpad.37signals.com/integrations.'
            );
        }
    }

    /** Pass `state` to round-trip data (e.g. userId) through the OAuth flow. */
    getAuthorizationUrl(state?: string): string {
        this.assertConfigured();
        const clientId    = encodeURIComponent(process.env.BASECAMP_CLIENT_ID!);
        const redirectUri = encodeURIComponent(process.env.BASECAMP_REDIRECT_URI ?? getDefaultRedirectUri());
        return (
            `https://launchpad.37signals.com/authorization/new` +
            `?response_type=code` +
            `&client_id=${clientId}` +
            `&redirect_uri=${redirectUri}` +
            (state ? `&state=${encodeURIComponent(state)}` : '')
        );
    }

    async handleCallback(code: string, platformUserId?: string): Promise<{ name: string; email: string }> {
        this.assertConfigured();

        const redirectUri = process.env.BASECAMP_REDIRECT_URI ?? getDefaultRedirectUri();

        const body = new URLSearchParams({
            grant_type:    'authorization_code',
            client_id:     process.env.BASECAMP_CLIENT_ID!,
            client_secret: process.env.BASECAMP_CLIENT_SECRET!,
            redirect_uri:  redirectUri,
            code,
        });

        const tokenRes = await fetch('https://launchpad.37signals.com/authorization/token', {
            method:  'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent':   USER_AGENT,
            },
            body: body.toString(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tokenData = await tokenRes.json() as Record<string, any>;

        if (!tokenRes.ok || tokenData.error) {
            const desc = (tokenData.error_description as string)
                ?? (tokenData.error as string)
                ?? tokenRes.statusText;
            throw new Error(`Basecamp token exchange failed (${tokenRes.status}): ${desc}`);
        }

        const accessToken  = tokenData.access_token  as string;
        const refreshToken = tokenData.refresh_token  as string ?? '';
        const expiresIn    = (tokenData.expires_in as number) ?? 1209600;
        const expiryDate   = Date.now() + expiresIn * 1000;

        // Fetch identity + accounts to discover the accountId
        const authRes = await fetch('https://launchpad.37signals.com/authorization.json', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'User-Agent':  USER_AGENT,
            },
        });

        if (!authRes.ok) {
            throw new Error(`Basecamp authorization.json failed: ${authRes.statusText}`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authData = await authRes.json() as Record<string, any>;
        const identity = authData.identity as { first_name?: string; last_name?: string; email_address?: string } | undefined;
        const accounts = (authData.accounts as Array<{ product: string; id: number; name: string; href: string }>) ?? [];

        const bc3Accounts = accounts.filter((a) => a.product === 'bc3');
        if (bc3Accounts.length === 0) {
            throw new Error(
                'No Basecamp 3/4 account found for this user. ' +
                'Make sure the user has an active Basecamp account.'
            );
        }

        const userName  = identity
            ? `${identity.first_name ?? ''} ${identity.last_name ?? ''}`.trim() || 'Basecamp User'
            : 'Basecamp User';
        const userEmail = identity?.email_address ?? '';

        const existing = await this.credentialRepo.findAllForUpsert(platformUserId);

        for (const bc3Account of bc3Accounts) {
            const accountId = String(bc3Account.id);
            const label     = `${userName} — ${bc3Account.name}`;
            const upsertKey = `${accountId}:${userEmail}`;

            const match = existing.find((c) => c.provider === 'basecamp' && c.email === upsertKey);

            if (match) {
                await this.credentialRepo.updateTokens(match.id, {
                    accessToken,
                    refreshToken,
                    expiryDate,
                });
            } else {
                await this.credentialRepo.create({
                    provider:     'basecamp',
                    label,
                    email:        upsertKey,
                    accessToken,
                    refreshToken,
                    expiryDate,
                    scopes:       [],
                    ...(platformUserId ? { userId: platformUserId } : {}),
                });
            }
        }

        return { name: userName, email: userEmail };
    }

    async getToken(credentialId: string): Promise<string> {
        const cred = await this.credentialRepo.findById(credentialId);
        if (!cred) {
            throw new Error(
                `Basecamp credential "${credentialId}" not found. ` +
                'Connect your Basecamp account first via Credentials.'
            );
        }

        // Refresh if expired or expiring within 5 minutes
        const fiveMinutes = 5 * 60 * 1000;
        if (cred.expiryDate > 0 && Date.now() >= cred.expiryDate - fiveMinutes) {
            if (!cred.refreshToken) {
                throw new Error(
                    'Basecamp access token has expired and no refresh token is available. ' +
                    'Please reconnect your Basecamp account.'
                );
            }
            return this.refreshAccessToken(credentialId, cred.refreshToken);
        }

        return cred.accessToken;
    }

    async getAccountId(credentialId: string): Promise<string> {
        const cred = await this.credentialRepo.findById(credentialId);
        if (!cred) {
            throw new Error(`Basecamp credential "${credentialId}" not found.`);
        }
        const colonIdx = cred.email.indexOf(':');
        if (colonIdx < 1) {
            throw new Error('Basecamp credential is missing accountId. Please reconnect.');
        }
        return cred.email.substring(0, colonIdx);
    }

    /**
     * Returns the Basecamp web-session payload (cookies + identity + expiry)
     * stored on this credential, or `null` when no session has been synced.
     * Read-only; nothing here mutates the credential or refreshes the session.
     */
    async getWebSession(credentialId: string): Promise<BasecampWebSession | null> {
        const cred = await this.credentialRepo.findById(credentialId);
        if (!cred) {
            throw new Error(`Basecamp credential "${credentialId}" not found.`);
        }
        return cred.basecampWebSession ?? null;
    }

    private async refreshAccessToken(credentialId: string, storedRefreshToken: string): Promise<string> {
        this.assertConfigured();

        const body = new URLSearchParams({
            grant_type:    'refresh_token',
            client_id:     process.env.BASECAMP_CLIENT_ID!,
            client_secret: process.env.BASECAMP_CLIENT_SECRET!,
            refresh_token: storedRefreshToken,
        });

        const res = await fetch('https://launchpad.37signals.com/authorization/token', {
            method:  'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent':   USER_AGENT,
            },
            body: body.toString(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await res.json() as Record<string, any>;

        if (!res.ok || data.error) {
            const desc = (data.error_description as string)
                ?? (data.error as string)
                ?? res.statusText;
            throw new Error(`Basecamp token refresh failed (${res.status}): ${desc}`);
        }

        const newAccessToken  = data.access_token  as string;
        const newRefreshToken = (data.refresh_token as string) ?? storedRefreshToken;
        const expiresIn       = (data.expires_in as number) ?? 1209600;
        const newExpiry       = Date.now() + expiresIn * 1000;

        await this.credentialRepo.updateTokens(credentialId, {
            accessToken:  newAccessToken,
            refreshToken: newRefreshToken,
            expiryDate:   newExpiry,
        });

        return newAccessToken;
    }
}
