import type { FastifyInstance } from 'fastify';
import { NotificationSettingsRepository } from '../repositories/NotificationSettingsRepository';
import { EmailNotificationService } from '../services/EmailNotificationService';
import type { JwtPayload } from '../types/auth.types';
import type { WorkflowNotifOverride } from '../db/models/NotificationSettingsModel';

interface NotificationRouteOptions {
    notificationSettingsRepo: NotificationSettingsRepository;
    emailNotificationService: EmailNotificationService;
}

async function requireAuth(req: any, reply: any) {
    await req.jwtVerify();
}

/** Default values used when a workflow has never been configured. */
const DEFAULT_WORKFLOW_OVERRIDE: WorkflowNotifOverride = {
    enabled:         false,
    notifyOnFailure: true,
    notifyOnPartial: true,
    notifyOnSuccess: false,
    recipients:      [],
};

function workflowSettingsResponse(
    settings: any,
    ownerEmail: string,
    workflowId: string,
) {
    const stored = (settings.workflowOverrides as Record<string, WorkflowNotifOverride>)?.[workflowId];
    const workflowOverride: WorkflowNotifOverride = stored ?? { ...DEFAULT_WORKFLOW_OVERRIDE };

    return {
        ownerEmail,
        smtpConfigured: EmailNotificationService.isConfigured(),
        workflowOverride,
    };
}

export async function notificationRoutes(
    fastify: FastifyInstance,
    opts: NotificationRouteOptions,
) {
    const { notificationSettingsRepo, emailNotificationService } = opts;

    /**
     * GET /api/notifications/settings?workflowId=<id>
     * Returns per-workflow notification settings.
     * `workflowId` is required; the endpoint returns a 400 without it.
     */
    fastify.get<{ Querystring: { workflowId?: string } }>(
        '/notifications/settings',
        { preHandler: [requireAuth] },
        async (req, reply) => {
            const user = (req as any).user as JwtPayload;
            const { workflowId } = req.query;

            if (!workflowId) {
                return reply.code(400).send({ message: 'workflowId query parameter is required.' });
            }

            const settings = await notificationSettingsRepo.get(user.sub);
            return workflowSettingsResponse(settings, user.email, workflowId);
        },
    );

    /**
     * PATCH /api/notifications/workflows/:workflowId/settings
     * Save the complete per-workflow notification configuration.
     * Body: WorkflowNotifOverride
     */
    fastify.patch<{
        Params: { workflowId: string };
        Body: WorkflowNotifOverride;
    }>(
        '/notifications/workflows/:workflowId/settings',
        { preHandler: [requireAuth] },
        async (req) => {
            const user = (req as any).user as JwtPayload;
            const { workflowId } = req.params;
            const { enabled, notifyOnFailure, notifyOnPartial, notifyOnSuccess, recipients } = req.body;

            // Clean recipients — owner's email is always pinned when notifications are on
            const ownerEmail = user.email.trim().toLowerCase();
            const cleaned = (recipients ?? [])
                .map((e: string) => e.trim().toLowerCase())
                .filter((e: string) => e.includes('@'));
            if (enabled && !cleaned.includes(ownerEmail)) {
                cleaned.unshift(ownerEmail);
            }

            const override: WorkflowNotifOverride = {
                enabled:         Boolean(enabled),
                notifyOnFailure: notifyOnFailure !== false,
                notifyOnPartial: notifyOnPartial !== false,
                notifyOnSuccess: Boolean(notifyOnSuccess),
                recipients:      cleaned,
            };

            const updated = await notificationSettingsRepo.setWorkflowOverride(user.sub, workflowId, override);
            return workflowSettingsResponse(updated, user.email, workflowId);
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
