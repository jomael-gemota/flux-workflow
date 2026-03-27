import { FastifyInstance } from 'fastify';
import { GoogleAuthService } from '../services/GoogleAuthService';
import { CredentialRepository } from '../repositories/CredentialRepository';

export async function oauthRoutes(
    fastify: FastifyInstance,
    options: { googleAuth: GoogleAuthService; credentialRepo: CredentialRepository }
): Promise<void> {
    const { googleAuth, credentialRepo } = options;

    /** Check whether Google OAuth is configured */
    fastify.get('/oauth/google/status', async (_request, reply) => {
        const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        const redirectUri  = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/oauth/google/callback';
        return reply.code(200).send({ configured, redirectUri });
    });

    /** Redirect browser to Google consent page */
    fastify.get('/oauth/google/authorize', async (_request, reply) => {
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
            const msg = encodeURIComponent(
                'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file.'
            );
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
            return reply.redirect(`${frontendBase}?oauth_error=${msg}`);
        }
        const url = googleAuth.getAuthUrl();
        return reply.redirect(url);
    });

    /** Google redirects here after the user approves */
    fastify.get<{ Querystring: { code?: string; error?: string } }>(
        '/oauth/google/callback',
        async (request, reply) => {
            const { code, error } = request.query;
            const frontendBase = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

            if (error || !code) {
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(error ?? 'missing_code')}`);
            }

            try {
                const { email, accessToken, refreshToken, expiryDate } =
                    await googleAuth.exchangeCode(code);

                // Upsert: if this email is already connected, update its tokens
                const existing = await credentialRepo.findAll();
                const match = existing.find((c) => c.email === email && c.provider === 'google');

                if (match) {
                    await credentialRepo.updateTokens(match.id, { accessToken, refreshToken, expiryDate });
                } else {
                    await credentialRepo.create({
                        provider:     'google',
                        label:        email,   // default label = email; user can rename later
                        email,
                        accessToken,
                        refreshToken,
                        expiryDate,
                        scopes: [],
                    });
                }

                return reply.redirect(`${frontendBase}?oauth_success=google`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'oauth_error';
                fastify.log.error(err, 'Google OAuth callback failed');
                return reply.redirect(`${frontendBase}?oauth_error=${encodeURIComponent(msg)}`);
            }
        }
    );
}
