import { LLMProviderName } from "../types/llm.types";
import { LLMProvider } from "./LLMProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";

export class LLMProviderFactory {
    static create(providerName: LLMProviderName): LLMProvider {
        switch (providerName) {
            case 'openai':
                return new OpenAIProvider();
            default:
                throw new Error(`Unsupported LLM provider: ${providerName}`);
        }
    }
}