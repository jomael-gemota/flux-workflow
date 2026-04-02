export type LLMProviderName = 'openai' | 'anthropic' | 'gemini';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMConfig {
    provider: LLMProviderName;
    model: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
}

export interface LLMResponse {
    content: string;
    model: string;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface ConversationMemory {
    messages: ChatMessage[];
}