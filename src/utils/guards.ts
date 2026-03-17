import { LLMConfig } from '../types/llm.types';

export interface LLMNodeConfig extends LLMConfig {
  userPrompt: string;
}

export function isLLMNodeConfig(config: unknown): config is LLMNodeConfig {
  if (typeof config !== 'object' || config === null) return false;

  const c = config as Record<string, unknown>;

  return (
    typeof c.provider === 'string' &&
    typeof c.model === 'string' &&
    typeof c.userPrompt === 'string'
  );
}