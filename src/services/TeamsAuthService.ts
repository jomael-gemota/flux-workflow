import { CredentialRepository } from '../repositories/CredentialRepository';
import { CredentialNotificationService } from './CredentialNotificationService';
import { getBaseUrl } from '../utils/baseUrl';

const TEAMS_SCOPES = [
    'openid',
    'offline_access',
    'profile',
    'email',
    'https://graph.microsoft.com/Team.ReadBasic.All',
    'https://graph.microsoft.com/Channel.ReadBasic.All',
    'https://graph.microsoft.com/ChannelMessage.Send',
    'https://graph.microsoft.com/ChannelMessage.Read.All',
    'https://graph.microsoft.com/Chat.ReadWrite',
    'https://graph.microsoft.com/User.ReadBasic.All',
].join(' ');

const getDefaultRedirectUri = () =>
    `${getBaseUrl()}/api/oauth/teams/callback`;

const getTenant = () =>
    process.env.TEAMS_TENANT_ID ?? 'common';

export class TeamsAuthService {
    private credentialRepo: CredentialRepository;
    private credentialNotifier?: CredentialNotificationService;

    constructor(credentialRepo: CredentialRepository, credentialNotifier?: CredentialNotificationService) {
        this.credentialRepo = credentialRepo;
        this.credentialNotifier = credentialNotifier;
    }

    isConfigured(): boolean {
        return !!(process.env.TEAMS_CLIENT_ID && process.env.TEAMS_CLIENT_SECRET);
    }

    private assertConfigured(): void {
        if (!process.env.TEAMS_CLIENT_ID) {
            throw new Error(
                'TEAMS_CLIENT_ID is not set. Add it to your .env file. ' +
                'Get it from your Azure portal app registration.'
            );
        }
        if (!process.env.TEAMS_CLIENT_SECRET) {
            throw new Error(
                'TEAMS_CLIENT_SECRET is not set. Add it to your .env file. ' +
                'Get it from your Azure portal app registration.'
            );
        }
    }

    /** Returns the Microsoft identity platform OAuth consent page URL.
     *  Pass `state` to round-trip data (e.g. userId) through the OAuth flow. */
    getAuthorizationUrl(state?: string): string {
        this.assertConfigured();
        const tenant      = getTenant();
        const clientId    = encodeURIComponent(process.env.TEAMS_CLIENT_ID!);
        const redirectUri = encodeURIComponent(process.env.TEAMS_REDIRECT_URI ?? getDefaultRedirectUri());
        const scope       = encodeURIComponent(TEAMS_SCOPES);
        return (
            `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize` +
            `?client_id=${clientId}` +
            `&response_type=code` +
            `&redirect_uri=${redirectUri}` +
            `&response_mode=query` +
            `&scope=${scope}` +
            (state ? `&state=${encodeURIComponent(state)}` : '')
        );
    }

    /**
     * Exchange an authorization code for tokens, fetch the user's profile,
     * and upsert a Credential document.
     */
    async handleCallback(code: string, platformUserId?: string): Promise<{ displayName: string; email: string }> {
        this.assertConfigured();

        const tenant      = getTenant();
        const redirectUri = process.env.TEAMS_REDIRECT_URI ?? getDefaultRedirectUri();

        const body = new URLSearchParams({
            client_id:     process.env.TEAMS_CLIENT_ID!,
            client_secret: process.env.TEAMS_CLIENT_SECRET!,
            code,
            redirect_uri:  redirectUri,
            grant_type:    'authorization_code',
            scope:         TEAMS_SCOPES,
        });

        const tokenRes = await fetch(
            `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    body.toString(),
            }
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tokenData = await tokenRes.json() as Record<string, any>;

        if (!tokenRes.ok || tokenData.error) {
            const desc = (tokenData.error_description as string)
                ?? (tokenData.error as string)
                ?? tokenRes.statusText;
            throw new Error(
                `Teams token exchange failed (${tokenRes.status}): ${desc}`
            );
        }

        const accessToken  = tokenData.access_token  as string;
        const refreshToken = tokenData.refresh_token  as string ?? '';
        const expiresIn    = (tokenData.expires_in   as number) ?? 3600;
        const expiryDate   = Date.now() + expiresIn * 1000;

        // Fetch the signed-in user's profile from Graph
        const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profile = profileRes.ok ? (await profileRes.json() as Record<string, any>) : {};

        const displayName = (profile.displayName as string) ?? 'Teams User';
        const email       = (profile.mail as string) ?? (profile.userPrincipalName as string) ?? '';
        const userId      = (profile.id as string) ?? email;

        const label = displayName ? `${displayName} (${email})` : email;

        // Upsert: same MS user ID = update existing credential
        const existing = await this.credentialRepo.findAllForUpsert(platformUserId);
        const match = existing.find((c) => c.provider === 'teams' && c.email === userId);

        if (match) {
            await this.credentialRepo.updateTokens(match.id, {
                accessToken,
                refreshToken,
                expiryDate,
                scopes: TEAMS_SCOPES.split(' '),
            });
        } else {
            await this.credentialRepo.create({
                provider:     'teams',
                label,
                email:        userId,
                accessToken,
                refreshToken,
                expiryDate,
                scopes:       TEAMS_SCOPES.split(' '),
                ...(platformUserId ? { userId: platformUserId } : {}),
            });
        }

        this.credentialNotifier
            ?.notify({
                event:        match ? 'reconnected' : 'connected',
                provider:     'teams',
                label,
                accountEmail: email || userId,
                ownerUserId:  platformUserId,
            })
            .catch((e) => console.error('[TeamsAuth] credential notification failed:', e));

        return { displayName, email };
    }

    /** Returns true when the stored credential includes the given Graph scope. */
    async hasScope(credentialId: string, scope: string): Promise<boolean> {
        const cred = await this.credentialRepo.findById(credentialId);
        return cred?.scopes.includes(scope) ?? false;
    }

    /**
     * Returns a valid access token for the given credential, refreshing it if
     * it has expired or is about to expire (within 5 minutes).
     */
    async getToken(credentialId: string): Promise<string> {
        const cred = await this.credentialRepo.findById(credentialId);
        if (!cred) {
            throw new Error(
                `Teams credential "${credentialId}" not found. ` +
                'Connect your Microsoft account first via Credentials.'
            );
        }

        // Refresh if expired or expiring within 5 minutes
        const fiveMinutes = 5 * 60 * 1000;
        if (cred.expiryDate > 0 && Date.now() >= cred.expiryDate - fiveMinutes) {
            if (!cred.refreshToken) {
                throw new Error(
                    'Teams access token has expired and no refresh token is available. ' +
                    'Please reconnect your Microsoft account.'
                );
            }
            return this.refreshAccessToken(credentialId, cred.refreshToken);
        }

        return cred.accessToken;
    }

    /** Use the stored refresh token to get a new access token */
    private async refreshAccessToken(credentialId: string, storedRefreshToken: string): Promise<string> {
        this.assertConfigured();

        const tenant = getTenant();
        const body = new URLSearchParams({
            client_id:     process.env.TEAMS_CLIENT_ID!,
            client_secret: process.env.TEAMS_CLIENT_SECRET!,
            grant_type:    'refresh_token',
            refresh_token: storedRefreshToken,
            scope:         TEAMS_SCOPES,
        });

        const res = await fetch(
            `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    body.toString(),
            }
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await res.json() as Record<string, any>;

        if (!res.ok || data.error) {
            const desc = (data.error_description as string)
                ?? (data.error as string)
                ?? res.statusText;
            throw new Error(
                `Teams token refresh failed (${res.status}): ${desc}`
            );
        }

        const newAccessToken  = data.access_token  as string;
        const newRefreshToken = (data.refresh_token as string) ?? storedRefreshToken;
        const expiresIn       = (data.expires_in   as number) ?? 3600;
        const newExpiry       = Date.now() + expiresIn * 1000;

        await this.credentialRepo.updateTokens(credentialId, {
            accessToken:  newAccessToken,
            refreshToken: newRefreshToken,
            expiryDate:   newExpiry,
        });

        return newAccessToken;
    }
}
