import { ChatMessage, LLMResponse } from '../types/llm.types';

export interface LLMProvider {
    complete(msesages: ChatMessage[], model: string, temperature?: number, maxeTokens?: number): Promise<LLMResponse>;
}