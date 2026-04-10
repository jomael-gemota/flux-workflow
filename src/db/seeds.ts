import { WorkflowRepository } from '../repositories/WorkflowRepository';
import { WorkflowDefinition } from '../types/workflow.types';

const sampleWorkflows: WorkflowDefinition[] = [
    {
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
    },
    {
        id: 'workflow-condition-test',
        name: 'Condition Branch Test',
        version: 1,
        entryNodeId: 'node-1',
        nodes: [
            {
                id: 'node-1',
                type: 'http',
                name: 'Fetch a number fact',
                config: {
                    url: 'http://numbersapi.com/42/math?json',
                    method: 'GET',
                },
                next: ['node-2'],
            },
            {
                id: 'node-2',
                type: 'condition',
                name: 'Check if found',
                config: {
                    condition: {
                        type: 'leaf',
                        left: 'nodes.node-1.output.found',
                        operator: 'eq',
                        right: true,
                    },
                    trueNext: 'node-3',
                    falseNext: 'node-4',
                },
                next: [],
            },
            {
                id: 'node-3',
                type: 'http',
                name: 'Fact was found',
                config: { url: 'https://httpbin.org/get?branch=true', method: 'GET' },
                next: [],
            },
            {
                id: 'node-4',
                type: 'http',
                name: 'Fact was not found',
                config: { url: 'https://httpbin.org/get?branch=false', method: 'GET' },
                next: [],
            },
        ],
    },
    {
        id: 'workflow-switch-test',
        name: 'Switch Branch Test',
        version: 1,
        entryNodeId: 'node-1',
        nodes: [
            {
                id: 'node-1',
                type: 'http',
                name: 'Fetch random fact',
                config: {
                    url: 'https://uselessfacts.jsph.pl/api/v2/facts/random',
                    method: 'GET',
                },
                next: ['node-2'],
            },
            {
                id: 'node-2',
                type: 'switch',
                name: 'Route by language',
                config: {
                    cases: [
                        {
                            label: 'English',
                            condition: {
                                type: 'leaf',
                                left: 'nodes.node-1.output.language',
                                operator: 'eq',
                                right: 'en',
                            },
                            next: 'node-3',
                        },
                        {
                            label: 'German',
                            condition: {
                                type: 'leaf',
                                left: 'nodes.node-1.output.language',
                                operator: 'eq',
                                right: 'de',
                            },
                            next: 'node-4',
                        },
                    ],
                    defaultNext: 'node-5',
                },
                next: [],
            },
            {
                id: 'node-3',
                type: 'http',
                name: 'English branch',
                config: { url: 'https://httpbin.org/get?lang=en', method: 'GET' },
                next: [],
            },
            {
                id: 'node-4',
                type: 'http',
                name: 'German branch',
                config: { url: 'https://httpbin.org/get?lang=de', method: 'GET' },
                next: [],
            },
            {
                id: 'node-5',
                type: 'http',
                name: 'Default branch',
                config: { url: 'https://httpbin.org/get?lang=unknown', method: 'GET' },
                next: [],
            },
        ],
    },
];

export async function runSeeds(workflowRepo: WorkflowRepository): Promise<void> {
    let seeded = 0;
    let skipped = 0;

    for (const workflow of sampleWorkflows) {
        const existing = await workflowRepo.findById(workflow.id);
        if (existing) { skipped++; continue; }
        await workflowRepo.save(workflow);
        seeded++;
    }

    // console.log(`🌱 Seeds: ${seeded} inserted, ${skipped} already existed.`);
}