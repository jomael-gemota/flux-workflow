import type { FastifyInstance } from 'fastify';
import { NotificationSettingsRepository } from '../repositories/NotificationSettingsRepository';
import { EmailNotificationService } from '../services/EmailNotificationService';
import type { JwtPayload } from '../types/auth.types';

interface NotificationRouteOptions {
    notificationSettingsRepo: NotificationSettingsRepository;
    emailNotificationService: EmailNotificationService;
}

async function requireAuth(req: any, reply: any) {
    await req.jwtVerify();
}

function settingsResponse(settings: any, ownerEmail: string) {
    return {
        enabled:         settings.enabled,
        notifyOnFailure: settings.notifyOnFailure,
        notifyOnPartial: settings.notifyOnPartial,
        notifyOnSuccess: settings.notifyOnSuccess ?? false,
        recipients:      settings.recipients as string[],
        ownerEmail,
        smtpConfigured:  EmailNotificationService.isConfigured(),
    };
}

export async function notificationRoutes(
    fastify: FastifyInstance,
    opts: NotificationRouteOptions,
) {
    const { notificationSettingsRepo, emailNotificationService } = opts;

    /** GET /api/notifications/settings — fetch current notification settings */
    fastify.get(
        '/notifications/settings',
        { preHandler: [requireAuth] },
        async (req) => {
            const user = (req as any).user as JwtPayload;
            const settings = await notificationSettingsRepo.get();

            // Ensure the owner is in the recipients list on first load
            if (user.email && !settings.recipients.includes(user.email.toLowerCase())) {
                await notificationSettingsRepo.update({
                    recipients: [user.email.toLowerCase(), ...settings.recipients],
                });
                settings.recipients = [user.email.toLowerCase(), ...settings.recipients];
            }

            return settingsResponse(settings, user.email);
        },
    );

    /** PATCH /api/notifications/settings — update notification settings */
    fastify.patch<{
        Body: {
            enabled?:         boolean;
            notifyOnFailure?: boolean;
            notifyOnPartial?: boolean;
            notifyOnSuccess?: boolean;
            recipients?:      string[];
        };
    }>(
        '/notifications/settings',
        { preHandler: [requireAuth] },
        async (req) => {
            const user = (req as any).user as JwtPayload;
            const { enabled, notifyOnFailure, notifyOnPartial, notifyOnSuccess, recipients } = req.body;

            const patch: Record<string, unknown> = {};
            if (enabled         !== undefined) patch.enabled         = enabled;
            if (notifyOnFailure !== undefined) patch.notifyOnFailure = notifyOnFailure;
            if (notifyOnPartial !== undefined) patch.notifyOnPartial = notifyOnPartial;
            if (notifyOnSuccess !== undefined) patch.notifyOnSuccess = notifyOnSuccess;
            if (recipients !== undefined) {
                // Clean the list, then enforce that the owner's email is always present
                const ownerEmail = user.email.trim().toLowerCase();
                const cleaned = recipients
                    .map((e) => e.trim().toLowerCase())
                    .filter((e) => e.includes('@'));
                // Prepend owner email if missing
                if (!cleaned.includes(ownerEmail)) {
                    cleaned.unshift(ownerEmail);
                }
                patch.recipients = cleaned;
            }

            const updated = await notificationSettingsRepo.update(patch as any);
            return settingsResponse(updated, user.email);
        },
    );

    /** POST /api/notifications/test — send a test email to a given address */
    fastify.post<{
        Body: { email: string };
    }>(
        '/notifications/test',
        { preHandler: [requireAuth] },
        async (req, reply) => {
            const { email } = req.body;
            if (!email || !email.includes('@')) {
                return reply.code(400).send({ message: 'A valid email address is required.' });
            }
            try {
                await emailNotificationService.sendTestEmail(email);
                return { sent: true };
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return reply.code(500).send({ message });
            }
        },
    );
}
