import OpenAI from 'openai';
import { LLMProvider } from '../LLMProvider';
import { ChatMessage, LLMResponse } from '../../types/llm.types';

export class OpenAIProvider implements LLMProvider {
    private client: OpenAI;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY is not set in environment variables');

        this.client = new OpenAI({ apiKey });
    }

    async complete(
        messages: ChatMessage[],
        model: string,
        temperature = 0.7,
        maxTokens = 1000
    ): Promise<LLMResponse> {
        const response = await this.client.chat.completions.create({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
        });

        const choice = response.choices[0];
        if (!choice.message.content) throw new Error('OpenAI returned an empty response');

        return {
            content: choice.message.content,
            model: response.model,
            usage: {
                promptTokens: response.usage?.prompt_tokens ?? 0,
                completionTokens: response.usage?.completion_tokens ?? 0,
                totalTokens: response.usage?.total_tokens ?? 0,
            },
        };
    }
}