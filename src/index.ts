import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import { existsSync } from 'fs';
import { join } from 'path';

import { WorkflowRunner } from './engine/WorkflowRunner';
import { NodeExecutorRegistry } from './engine/NodeExecutorRegistry';
import { HttpNode } from './nodes/HttpNode';
import { LLMNode } from './nodes/LLMNode';
import { ChatMemoryManager } from './llm/ChatMemoryManager';
import { GmailNode } from './nodes/GmailNode';
import { GDriveNode } from './nodes/GDriveNode';
import { GDocsNode } from './nodes/GDocsNode';
import { GSheetsNode } from './nodes/GSheetsNode';
import { SlackNode } from './nodes/SlackNode';
import { TeamsNode } from './nodes/TeamsNode';
import { BasecampNode } from './nodes/BasecampNode';
import { TriggerNode } from './nodes/TriggerNode';

import { WorkflowRepository } from './repositories/WorkflowRepository';
import { ExecutionRepository } from './repositories/ExecutionRepository';
import { CredentialRepository } from './repositories/CredentialRepository';
import { WorkflowService } from './services/WorkflowService';
import { GoogleAuthService } from './services/GoogleAuthService';
import { SlackAuthService } from './services/SlackAuthService';
import { TeamsAuthService } from './services/TeamsAuthService';
import { BasecampAuthService } from './services/BasecampAuthService';

import { workflowRoutes } from './routes/workflows';
import { executionRoutes } from './routes/executions';
import { webhookRoutes } from './routes/webhooks';
import { apiKeyRoutes } from './routes/apiKeys';
import { oauthRoutes } from './routes/oauthRoutes';
import { credentialRoutes } from './routes/credentialRoutes';
import { gmailDataRoutes } from './routes/gmailDataRoutes';
import { gdriveDataRoutes } from './routes/gdriveDataRoutes';
import { gsheetsDataRoutes } from './routes/gsheetsDataRoutes';
import { slackDataRoutes } from './routes/slackDataRoutes';
import { teamsDataRoutes } from './routes/teamsDataRoutes';
import { basecampDataRoutes } from './routes/basecampDataRoutes';
import { authRoutes } from './routes/authRoutes';
import { adminRoutes } from './routes/adminRoutes';
import { surveillanceRoutes } from './routes/surveillanceRoutes';
import { projectRoutes } from './routes/projectRoutes';
import { fileRoutes } from './routes/fileRoutes';
import { UserAuthService } from './services/UserAuthService';
import { EmailNotificationService } from './services/EmailNotificationService';
import { NotificationSettingsRepository } from './repositories/NotificationSettingsRepository';
import { notificationRoutes } from './routes/notificationRoutes';

import { connectDatabase } from './db/database';
import { getBaseUrl } from './utils/baseUrl';
import crypto from 'crypto';

import sensible from '@fastify/sensible';
import { registerErrorHandler } from './errors/errorHandler';

import { ConditionNode } from './nodes/ConditionNode';
import { SwitchNode } from './nodes/SwitchNode';
import { TransformNode } from './nodes/TransformNode';
import { ExtractNode } from './nodes/ExtractNode';
import { OutputNode } from './nodes/OutputNode';
import { MessageFormatterNode } from './nodes/MessageFormatterNode';
import { runSeeds } from './db/seeds';

import { ApiKeyModel } from './db/models/ApiKeyModel';
import { createWorkflowWorker } from './queue/WorkflowWorker';
import { WorkflowScheduler } from './scheduler/WorkflowScheduler';
import { PollingService } from './services/PollingService';
import { PushSubscriptionService } from './services/PushSubscriptionService';
import { TriggerTestService } from './services/TriggerTestService';
import { pushNotificationRoutes } from './routes/pushNotificationRoutes';

async function bootstrap() {

    await connectDatabase();
    
    // 1. Engine setup
    const registry = new NodeExecutorRegistry();
    const memoryManager = new ChatMemoryManager();
    registry.register('trigger', new TriggerNode());
    registry.register('http', new HttpNode());
    registry.register('llm', new LLMNode(memoryManager));
	registry.register('condition', new ConditionNode());
	registry.register('switch', new SwitchNode());
    registry.register('transform', new TransformNode());
    registry.register('extract', new ExtractNode());
    registry.register('output', new OutputNode());
    registry.register('formatter', new MessageFormatterNode());
    const runner = new WorkflowRunner(registry);

    // 2a. User auth service
    const userAuth = new UserAuthService();

    // 2. Repositories & services
    const workflowRepo    = new WorkflowRepository();
    const executionRepo   = new ExecutionRepository();
    const credentialRepo  = new CredentialRepository();
    const googleAuth      = new GoogleAuthService(credentialRepo);
    const slackAuth       = new SlackAuthService(credentialRepo);
    const teamsAuth       = new TeamsAuthService(credentialRepo);
    const basecampAuth    = new BasecampAuthService(credentialRepo);
    registry.register('gmail',    new GmailNode(googleAuth));
    registry.register('gdrive',   new GDriveNode(googleAuth));
    registry.register('gdocs',    new GDocsNode(googleAuth));
    registry.register('gsheets',  new GSheetsNode(googleAuth));
    registry.register('slack',    new SlackNode(slackAuth));
    registry.register('teams',    new TeamsNode(teamsAuth));
    registry.register('basecamp', new BasecampNode(basecampAuth));
    const notificationSettingsRepo = new NotificationSettingsRepository();
    const emailNotificationService = new EmailNotificationService(notificationSettingsRepo);
    const workflowService = new WorkflowService(runner, workflowRepo, executionRepo, emailNotificationService);

	await runSeeds(workflowRepo);

    // 3. Start background worker (only when Redis is available)
    if (process.env.REDIS_URL) {
        createWorkflowWorker(runner, workflowRepo, executionRepo, emailNotificationService);
    } else {
        // console.log('ℹ️  No REDIS_URL set — running without background worker (synchronous mode)');
    }

    // 4. Start cron scheduler + polling service
    const scheduler = new WorkflowScheduler(workflowRepo, workflowService);
    await scheduler.start();

    const pollingService = new PollingService(
        workflowRepo, workflowService, credentialRepo,
        basecampAuth, slackAuth, teamsAuth, googleAuth,
    );
    await pollingService.start();

    const pushSubscriptionService = new PushSubscriptionService(
        workflowRepo, googleAuth, basecampAuth,
    );

    // Hourly cron: renew Google Drive push subscriptions that are about to expire
    setInterval(
        () => pushSubscriptionService.renewExpiring().catch((err) =>
            console.error('[PushSubscriptionService] renewal cron error:', err)
        ),
        60 * 60 * 1000, // every hour
    );

    const triggerTestService = new TriggerTestService(googleAuth, slackAuth, teamsAuth, basecampAuth);

    // 3. Seed a default API key on first run if none exist
    const existingKey = await ApiKeyModel.findOne();
    if (!existingKey) {
        const defaultKey = `sk-${crypto.randomUUID()}`;
        await ApiKeyModel.create({
        keyId: crypto.randomUUID(),
        key: defaultKey,
        name: 'default',
        });
        console.log(`\n🔑 Default API Key generated (save this — shown once):\n   ${defaultKey}\n`);
    }

    // 4. Fastify server
    const fastify = Fastify({
		logger: false,
		genReqId: () => crypto.randomUUID(),
		// Raise from the default 1 MB to 50 MB to accommodate base64-encoded
		// file attachments stored inside workflow node configs.
		bodyLimit: 50 * 1024 * 1024,
	});

    await fastify.register(cors, { origin: process.env.CORS_ORIGIN ?? '*', credentials: true });
    await fastify.register(helmet, { contentSecurityPolicy: false }); // CSP handled by Vite in dev
    await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
    await fastify.register(sensible);

    // JWT plugin — all routes can call request.jwtVerify() / fastify.jwt.sign()
    await fastify.register(fastifyJwt, {
        secret: process.env.JWT_SECRET ?? 'flux-dev-secret-change-in-production',
    });
    // Convenience decorator used by authRoutes /auth/me
    fastify.decorate('authenticate', async (request: any, reply: any) => {
        try { await request.jwtVerify(); }
        catch (err) { reply.send(err); }
    });

    // 5. Register routes (all API routes under /api prefix)
	registerErrorHandler(fastify);
    await fastify.register(workflowRoutes,   {
        prefix: '/api', workflowService, workflowRepo, executionRepo, registry, scheduler,
        triggerTestService,
        onWorkflowUpdated: async (wfId: string) => {
            await pollingService.refresh(wfId);
            await pushSubscriptionService.syncWorkflow(wfId).catch((err) =>
                console.error('[PushSubscriptionService] syncWorkflow error:', err)
            );
        },
    });
    await fastify.register(executionRoutes,  { prefix: '/api', executionRepo, workflowService });
    await fastify.register(webhookRoutes,    { workflowService, workflowRepo });   // no prefix — called by external systems
    await fastify.register(apiKeyRoutes,     { prefix: '/api' });
    await fastify.register(oauthRoutes,          { prefix: '/api', googleAuth, slackAuth, teamsAuth, basecampAuth, credentialRepo });
    await fastify.register(credentialRoutes,     { prefix: '/api', credentialRepo });
    await fastify.register(gmailDataRoutes,      { prefix: '/api', googleAuth });
    await fastify.register(gdriveDataRoutes,     { prefix: '/api', googleAuth });
    await fastify.register(gsheetsDataRoutes,    { prefix: '/api', googleAuth });
    await fastify.register(slackDataRoutes,      { prefix: '/api', slackAuth });
    await fastify.register(teamsDataRoutes,      { prefix: '/api', teamsAuth });
    await fastify.register(basecampDataRoutes,   { prefix: '/api', basecampAuth });
    await fastify.register(notificationRoutes, { prefix: '/api', notificationSettingsRepo, emailNotificationService });
    await fastify.register(projectRoutes, { prefix: '/api' });
    await fastify.register(fileRoutes,   { prefix: '/api' });
    // Auth & admin (no prefix-level auth guard — each route manages its own)
    await fastify.register(authRoutes,  { prefix: '/api', userAuth });
    await fastify.register(adminRoutes,      { prefix: '/api' });
    await fastify.register(surveillanceRoutes, { prefix: '/api', scheduler });
    // Push notification ingress — no /api prefix; called directly by external services
    await fastify.register(pushNotificationRoutes, { pollingService, pushSubscriptionService });

    // 6. Health check
    fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

    // 7. Serve frontend SPA in production (or when dist/public exists locally)
    const publicPath = join(__dirname, 'public');
    if (existsSync(publicPath)) {
        await fastify.register(fastifyStatic, { root: publicPath, prefix: '/' });
        fastify.setNotFoundHandler((req, reply) => {
            if (req.url.startsWith('/api/') || req.url.startsWith('/webhook/')) {
                reply.code(404).send({ message: `Route ${req.method}:${req.url} not found`, error: 'Not Found', statusCode: 404 });
            } else {
                reply.sendFile('index.html');
            }
        });
    }

    // 8. Start
    const PORT = Number(process.env.PORT ?? 3000);
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 Platform running at ${getBaseUrl()}`);
}

bootstrap().catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});