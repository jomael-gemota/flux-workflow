import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from '../LLMProvider';
import { ChatMessage, LLMResponse } from '../../types/llm.types';

export class AnthropicProvider implements LLMProvider {
    private client: Anthropic;

    constructor() {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in environment variables');

        this.client = new Anthropic({ apiKey });
    }

    async complete(
        messages: ChatMessage[],
        model: string,
        temperature = 0.7,
        maxTokens = 2048
    ): Promise<LLMResponse> {
        const systemMessage = messages.find(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');

        const response = await this.client.messages.create({
            model,
            max_tokens: maxTokens,
            temperature,
            ...(systemMessage ? { system: systemMessage.content } : {}),
            messages: conversationMessages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
        });

        const block = response.content[0];
        if (!block || block.type !== 'text') {
            throw new Error('Anthropic returned an empty or non-text response');
        }

        return {
            content: block.text,
            model: response.model,
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            },
        };
    }
}
