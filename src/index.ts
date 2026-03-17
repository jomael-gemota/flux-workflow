import 'dotenv/config';
import { WorkflowRunner } from './engine/WorkflowRunner';
import { NodeExecutorRegistry } from './engine/NodeExecutorRegistry';
import { HttpNode } from './nodes/HttpNode';
import { LLMNode } from './nodes/LLMNode';
import { ChatMemoryManager } from './llm/ChatMemoryManager';
import { WorkflowDefinition } from './types/workflow.types';

const registry = new NodeExecutorRegistry();
const memoryManager = new ChatMemoryManager();

registry.register('http', new HttpNode());
registry.register('llm', new LLMNode(memoryManager));

const runner = new WorkflowRunner(registry);

// 3. Define a sample workflow (this is your "workflow JSON")
const sampleWorkflow: WorkflowDefinition = {
  id: 'workflow-001',
  name: 'My First Workflow',
  version: 1,
  entryNodeId: 'node-1',
  nodes: [
    {
      id: 'node-1',
      type: 'http',
      name: 'Fetch a first fact',
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
        model: 'gpt-4o-mini',       // cost-effective for testing
        temperature: 0.7,
        maxTokens: 200,
        systemPrompt: 'You are a helpful assistant that explains facts in simple terms.',
        userPrompt: 'Explain this fact in one friendly sentence: {{ nodes.node-1.output }}',
      },
      next: [],
    },
  ],
};

// 4. Run the workflow and print results
async function main() {
  console.log('🚀 Starting workflow:', sampleWorkflow.name);
  console.log('─'.repeat(40));

  try {
    const { executionId, results } = await runner.run(sampleWorkflow, { startedBy: 'manual' });

    for (const result of results) {
      console.log(`\n📦 Node: ${result.nodeId} [${result.status}] (${result.durationMs}ms)`);
      if (result.status === 'success') {
        const output = result.output as any;
        // Pretty print LLM response vs raw HTTP response
        console.log('   Output:', output?.content ?? JSON.stringify(output, null, 2));
      } else {
        console.log('   Error:', result.error);
      }
    }

    // Inspect memory after run
    console.log('\n🧠 Conversation History:');
    console.log(memoryManager.getHistory(executionId));

    console.log('\n✅ Workflow completed!');
  } catch (err) {
    console.error('❌ Workflow failed:', err);
  }
}

main();