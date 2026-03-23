import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { WorkflowRunner } from './engine/WorkflowRunner';
import { NodeExecutorRegistry } from './engine/NodeExecutorRegistry';
import { HttpNode } from './nodes/HttpNode';
import { LLMNode } from './nodes/LLMNode';
import { ChatMemoryManager } from './llm/ChatMemoryManager';

import { WorkflowRepository } from './repositories/WorkflowRepository';
import { ExecutionRepository } from './repositories/ExecutionRepository';
import { WorkflowService } from './services/WorkflowService';

import { workflowRoutes } from './routes/workflows';
import { executionRoutes } from './routes/executions';
import { webhookRoutes } from './routes/webhooks';

import { getDatabase } from './db/database';
import crypto from 'crypto';

import sensible from '@fastify/sensible';
import { registerErrorHandler } from './errors/errorHandler';

async function bootstrap() {
    // 1. Engine setup
    const registry = new NodeExecutorRegistry();
    const memoryManager = new ChatMemoryManager();
    registry.register('http', new HttpNode());
    registry.register('llm', new LLMNode(memoryManager));
    const runner = new WorkflowRunner(registry);

    // 2. Repositories & services
    const workflowRepo = new WorkflowRepository();
    const executionRepo = new ExecutionRepository();
    const workflowService = new WorkflowService(runner, workflowRepo, executionRepo);

	seedSampleWorkflow(workflowRepo);

    // 3. Seed a default API key on first run if none exist
    const db = getDatabase();
    const existing = db.prepare('SELECT COUNT(*) as count FROM api_keys').get() as { count: number };
    if (existing.count === 0) {
      const defaultKey = `sk-${crypto.randomUUID()}`;
      db.prepare('INSERT INTO api_keys (id, key, name) VALUES (?, ?, ?)')
        .run(crypto.randomUUID(), defaultKey, 'default');
      console.log(`\n🔑 Default API Key generated (save this — shown once):\n   ${defaultKey}\n`);
    }

    // 4. Fastify server
    const fastify = Fastify({
		logger: true,
		genReqId: () => crypto.randomUUID(),
	});

    await fastify.register(helmet);
    await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
	await fastify.register(sensible);

    // 5. Register routes
	registerErrorHandler(fastify);
    await fastify.register(workflowRoutes, { workflowService, workflowRepo });
    await fastify.register(executionRoutes, { executionRepo });
    await fastify.register(webhookRoutes, { workflowService, workflowRepo });

    // 6. Health check
    fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

    // 7. Start
    const PORT = Number(process.env.PORT ?? 3000);
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 Platform running at http://localhost:${PORT}`);
}

function seedSampleWorkflow(workflowRepo: WorkflowRepository): void {
	const existing = workflowRepo.findById('workflow-002');
	if (existing) {
		console.log('📋 Sample workflow already exists in DB, skipping seed.');
		return;
	}

	workflowRepo.save({
		id: 'workflow-002',
		name: 'Fetch + Summarize Workflow',
		version: 1,
		entryNodeId: 'node-1',
		nodes: [
			{
				id: 'node-1',
				type: 'http',
				name: 'Fetch a fact',
				config: {
					url: 'https://uselessfacts.jsph.pl/api/v2/facts/random',
					method: 'GET',
				},
				next: ['node-2'],
			},
			{
				id: 'node-2',
				type: 'llm',
				name: 'Summarize the fact',
				config: {
					provider: 'openai',
					model: 'gpt-4o-mini',
					temperature: 0.7,
					maxTokens: 200,
					systemPrompt: 'You are a helpful assistant that explains facts in simple terms.',
					userPrompt: 'Explain this fact in one friendly sentence: {{ nodes.node-1.output }}',
				},
				next: [],
			},
		],
	});

	console.log('✅ Sample workflow seeded successfully.');
}

bootstrap().catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});