import { NodeExecutor } from "../engine/NodeExecutor";
import { WorkflowNode, ExecutionContext } from "../types/workflow.types";
import { LLMConfig, LLMResponse } from "../types/llm.types";
import { LLMProviderFactory } from "../llm/LLMProviderFactory";
import { ChatMemoryManager } from "../llm/ChatMemoryManager";
import { isLLMNodeConfig } from '../utils/guards';

export class LLMNode implements NodeExecutor {
    constructor(private memoryManager: ChatMemoryManager) {}

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<LLMResponse> {
        if (!isLLMNodeConfig(node.config)) {
            throw new Error(`Node "${node.id}" has an invalid or incomplete LLM config`);
        }

        const config = node.config;
        
        const provider = LLMProviderFactory.create(config.provider);

        const memory = this.memoryManager.getOrCreate(context.executionId);

        if (config.systemPrompt && memory.messages.length === 0) {
            this.memoryManager.addMessage(context.executionId, {
                role: 'system',
                content: config.systemPrompt,
            });
        }

        const resolvedPrompt = this.resolveTemplate(config.userPrompt, context);

        this.memoryManager.addMessage(context.executionId, {
            role: 'user',
            content: resolvedPrompt,
        });

        const response = await provider.complete(
            memory.messages,
            config.model,
            config.temperature,
            config.maxTokens
        );

        this.memoryManager.addMessage(context.executionId, {
            role: 'assistant',
            content: response.content,
        });

        return response;
    }

    private resolveTemplate(template: string, context: ExecutionContext): string {
        return template.replace(/\{\{\s*nodes\.(\S+?)\.output\s*\}\}/g, (_, nodeId) => {
            const value = context.variables[nodeId];
            return value ? JSON.stringify(value) : `[missing: ${nodeId}]`;
        });
    }
}