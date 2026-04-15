import OpenAI from 'openai';
import { LLMProvider } from '../LLMProvider';
import { ChatMessage, LLMResponse } from '../../types/llm.types';

// GPT-5.x and o-series models use max_completion_tokens; older models use max_tokens.
const MAX_COMPLETION_TOKENS_RE = /^(gpt-5|o\d)/i;

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
        maxTokens = 2048
    ): Promise<LLMResponse> {
        const usesCompletionTokens = MAX_COMPLETION_TOKENS_RE.test(model);

        const response = await this.client.chat.completions.create({
            model,
            messages,
            temperature,
            ...(usesCompletionTokens
                ? { max_completion_tokens: maxTokens }
                : { max_tokens: maxTokens }),
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