import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider } from '../LLMProvider';
import { ChatMessage, LLMResponse } from '../../types/llm.types';

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
        maxTokens = 1000,
    ): Promise<LLMResponse> {
        const systemMessage = messages.find(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');

        const genModel = this.client.getGenerativeModel({
            model,
            ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens,
            },
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
        return {
            content,
            model,
            usage: {
                promptTokens: usage?.promptTokenCount ?? 0,
                completionTokens: usage?.candidatesTokenCount ?? 0,
                totalTokens: usage?.totalTokenCount ?? 0,
            },
        };
    }
}
