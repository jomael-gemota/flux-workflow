import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider } from '../LLMProvider';
import { ChatMessage, LLMResponse } from '../../types/llm.types';

// Gemini 2.5+ and all 3.x models (flash, pro, lite) have built-in thinking.
const THINKING_MODEL_RE = /gemini-(2\.5|3)/i;

// These Pro models *require* thinking mode — thinkingBudget: 0 is rejected.
// We leave thinking enabled but reserve extra headroom in maxOutputTokens so
// the thinking tokens don't crowd out the actual response.
const REQUIRES_THINKING_RE = /gemini-3(\.\d+)?-pro/i;
const THINKING_TOKEN_RESERVE = 8192;

export class GeminiProvider implements LLMProvider {
    private client: GoogleGenerativeAI;

    constructor() {
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error('GOOGLE_API_KEY is not set in environment variables');
        this.client = new GoogleGenerativeAI(apiKey);
    }

    async complete(
        messages: ChatMessage[],
        model: string,
        temperature = 0.7,
        maxTokens = 2048,
    ): Promise<LLMResponse> {
        const systemMessage = messages.find(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');

        const supportsThinking = THINKING_MODEL_RE.test(model);
        const requiresThinking = REQUIRES_THINKING_RE.test(model);

        // For models that require thinking (e.g. gemini-3.1-pro-preview), we cannot
        // disable it. We instead pad maxOutputTokens to reserve space for thinking
        // tokens so the actual response isn't squeezed out.
        // For all other thinking-capable models we disable thinking entirely so the
        // full token budget is available for the response.
        const effectiveMaxTokens = requiresThinking
            ? maxTokens + THINKING_TOKEN_RESERVE
            : maxTokens;

        const thinkingConfig = supportsThinking && !requiresThinking
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {};

        const genModel = this.client.getGenerativeModel({
            model,
            ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
            generationConfig: {
                temperature,
                maxOutputTokens: effectiveMaxTokens,
                ...thinkingConfig,
            } as Record<string, unknown>,
        });

        // Build chat history (all messages except the last one)
        const history = conversationMessages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));

        const lastMessage = conversationMessages[conversationMessages.length - 1];
        if (!lastMessage) throw new Error('No user message provided to Gemini');

        const chat = genModel.startChat({ history });
        const result = await chat.sendMessage(lastMessage.content);
        const response = result.response;
        const content = response.text();

        const usage = response.usageMetadata;
        const thinkingTokens = (usage as unknown as Record<string, unknown>)?.thoughtsTokenCount as number ?? 0;
        return {
            content,
            model,
            usage: {
                promptTokens: usage?.promptTokenCount ?? 0,
                completionTokens: (usage?.candidatesTokenCount ?? 0) - thinkingTokens,
                totalTokens: usage?.totalTokenCount ?? 0,
            },
        };
    }
}
