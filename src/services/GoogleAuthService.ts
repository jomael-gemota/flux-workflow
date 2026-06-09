import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { CredentialRepository } from '../repositories/CredentialRepository';
import { getBaseUrl } from '../utils/baseUrl';

const SCOPES = [
    'https://mail.google.com/',                        // full Gmail access: read, compose, send, permanent delete
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

const getDefaultRedirectUri = () =>
    `${getBaseUrl()}/api/oauth/google/callback`;

/**
 * True when the error indicates the refresh token itself is dead
 * (revoked / expired) and only a full OAuth reconnect can fix it.
 */
export function isInvalidGrantError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { message?: string; response?: { data?: { error?: string } } };
    return (
        e.response?.data?.error === 'invalid_grant' ||
        (typeof e.message === 'string' && e.message.includes('invalid_grant'))
    );
}

/** Thrown when a Google credential needs a full OAuth reconnect. */
export class GoogleReauthRequiredError extends Error {
    constructor(email: string) {
        super(
            `Google account "${email}" needs to be reconnected: its access was revoked by Google ` +
            `(common causes: password change, security review, or manual revocation). ` +
            `Open Credentials and click "Connect Account" with this same account — do not delete it.`
        );
        this.name = 'GoogleReauthRequiredError';
    }
}

export class GoogleAuthService {
    private credentialRepo: CredentialRepository;

    constructor(credentialRepo: CredentialRepository) {
        this.credentialRepo = credentialRepo;
    }

    private isConfigured(): boolean {
        return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    }

    private assertConfigured(): void {
        if (!process.env.GOOGLE_CLIENT_ID) {
            throw new Error(
                'GOOGLE_CLIENT_ID is not set. Add it to your .env file. ' +
                'Get it from https://console.cloud.google.com → APIs & Services → Credentials.'
            );
        }
        if (!process.env.GOOGLE_CLIENT_SECRET) {
            throw new Error(
                'GOOGLE_CLIENT_SECRET is not set. Add it to your .env file. ' +
                'Get it from https://console.cloud.google.com → APIs & Services → Credentials.'
            );
        }
    }

    private createOAuth2Client(): OAuth2Client {
        this.assertConfigured();
        return new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI ?? getDefaultRedirectUri()
        );
    }

    /** Returns the Google consent page URL. Pass `state` to round-trip data (e.g. userId). */
    getAuthUrl(state?: string): string {
        const client = this.createOAuth2Client();
        return client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent',   // always show consent to guarantee refresh_token
            ...(state ? { state } : {}),
        });
    }

    /** Exchange an authorization code for tokens and return the user's email */
    async exchangeCode(code: string): Promise<{
        email: string;
        accessToken: string;
        refreshToken: string;
        expiryDate: number;
    }> {
        const client = this.createOAuth2Client();
        const { tokens } = await client.getToken(code);

        if (!tokens.access_token || !tokens.refresh_token) {
            throw new Error('Google OAuth did not return expected tokens');
        }

        client.setCredentials(tokens);

        // Fetch the account email via the userinfo endpoint
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const { data } = await oauth2.userinfo.get();

        return {
            email:        data.email ?? 'unknown@google.com',
            accessToken:  tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiryDate:   tokens.expiry_date ?? Date.now() + 3600 * 1000,
        };
    }

    /**
     * Returns an authenticated OAuth2Client for the given stored credential.
     * Automatically refreshes the access token when it is expired.
     */
    async getAuthenticatedClient(credentialId: string): Promise<OAuth2Client> {
        const cred = await this.credentialRepo.findById(credentialId);
        if (!cred) {
            throw new Error(`Credential "${credentialId}" not found. Connect your Google account first.`);
        }

        const client = this.createOAuth2Client();
        client.setCredentials({
            access_token:  cred.accessToken,
            refresh_token: cred.refreshToken,
            expiry_date:   cred.expiryDate,
        });

        // If token is expired (or within 60 s of expiry), refresh it
        const isExpired = cred.expiryDate < Date.now() + 60_000;
        if (isExpired) {
            try {
                const { credentials } = await client.refreshAccessToken();
                await this.credentialRepo.updateTokens(credentialId, {
                    accessToken:  credentials.access_token!,
                    refreshToken: credentials.refresh_token ?? cred.refreshToken,
                    expiryDate:   credentials.expiry_date ?? Date.now() + 3600 * 1000,
                });
                client.setCredentials(credentials);
            } catch (err) {
                if (isInvalidGrantError(err)) {
                    await this.credentialRepo
                        .updateStatus(credentialId, 'reauth_required')
                        .catch(() => { /* status update is best-effort */ });
                    throw new GoogleReauthRequiredError(cred.email);
                }
                throw err;
            }
        }

        return client;
    }

    /**
     * Force-exercise the refresh token regardless of the access token's expiry.
     * Persists the new tokens on success (which also resets the credential to
     * `active`). Throws GoogleReauthRequiredError when the refresh token is dead.
     * Used by the hourly credential health check.
     */
    async forceRefreshCredential(credentialId: string): Promise<void> {
        const cred = await this.credentialRepo.findById(credentialId);
        if (!cred) {
            throw new Error(`Credential "${credentialId}" not found.`);
        }

        const client = this.createOAuth2Client();
        client.setCredentials({ refresh_token: cred.refreshToken });

        try {
            const { credentials } = await client.refreshAccessToken();
            await this.credentialRepo.updateTokens(credentialId, {
                accessToken:  credentials.access_token!,
                refreshToken: credentials.refresh_token ?? cred.refreshToken,
                expiryDate:   credentials.expiry_date ?? Date.now() + 3600 * 1000,
            });
        } catch (err) {
            if (isInvalidGrantError(err)) {
                throw new GoogleReauthRequiredError(cred.email);
            }
            throw err;
        }
    }
}
