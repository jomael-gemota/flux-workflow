import type { Skill } from '../types';

export const skill: Skill = {
    name: 'llm-prompt',
    title: 'AI / LLM Prompt',
    summary:
        'Send a prompt to an AI model (OpenAI, Anthropic, Gemini, Llama) and use the response.',
    whenToUse:
        'Use whenever the user wants to summarize, classify, extract, generate, ' +
        'rewrite, translate, or otherwise process text with AI. Default for any ' +
        '"summarize", "classify", "ask AI", "generate" intent.',
    keywords: [
        'llm', 'ai', 'gpt', 'openai', 'anthropic', 'claude', 'gemini', 'llama',
        'summarize', 'classify', 'extract', 'generate', 'rewrite', 'translate', 'prompt',
    ],
    category: 'ai',
    nodeType: 'llm',
    body: `
# AI / LLM Prompt

Calls a chat-completion model with a system prompt + user prompt and returns
the response text.

## Required config
- \`provider\` (string): \`"openai"\` | \`"anthropic"\` | \`"gemini"\` | \`"meta"\`. Default \`"openai"\`.
- \`model\` (string): A model id for the chosen provider. Sensible defaults:
    - openai: \`"gpt-4o-mini"\` (fast, cheap), \`"gpt-4o"\` (better quality)
    - anthropic: \`"claude-3-5-sonnet-latest"\`
    - gemini: \`"gemini-2.0-flash"\`
    - meta: \`"Llama-3.3-70B-Instruct"\`
- \`userPrompt\` (string): The prompt sent to the model. SUPPORTS template
  expressions referencing other nodes — e.g. \`{{ nodes.trigger-1.body.text }}\`.

## Optional config
- \`systemPrompt\` (string): System-role instruction. Use to set persona / output format.
- \`temperature\` (number, 0-2): Default \`0.7\`. Lower = more deterministic.
- \`maxTokens\` (number): Default \`500\`. Cap for response length.

## Output fields
- \`content\`: The model's response text — use this in downstream nodes via
  \`{{ nodes.<this-node-id>.content }}\`.
- \`model\`: Model id actually used.
- \`usage.totalTokens\`, \`usage.promptTokens\`, \`usage.completionTokens\`: Token counts.

## Example — summarize an email body
\`\`\`json
{
  "id": "llm-1",
  "type": "llm",
  "name": "Summarize Email",
  "config": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "systemPrompt": "You write concise 2-sentence summaries.",
    "userPrompt": "Summarize this email:\\n\\n{{ nodes.trigger-1.body.text }}",
    "temperature": 0.3,
    "maxTokens": 200
  },
  "next": []
}
\`\`\`

## Tips
- For deterministic classification, set \`temperature: 0\`.
- Reference earlier-node output explicitly in the prompt so the model has context.
- If the user wants the AI to output JSON, instruct it in the \`systemPrompt\`
  and add a downstream **Extract** node to parse fields out of \`content\`.

## Fluxelle workflow
1. If the user hasn't specified a provider/model, use \`ask_user\` to present
   choices. Recommended defaults to offer:
   - **OpenAI GPT-4o mini** (fast, affordable — good for most tasks)
   - **OpenAI GPT-4o** (most capable, best quality)
   - **Anthropic Claude 3.5 Sonnet** (excellent reasoning)
   - **Google Gemini 2.0 Flash** (fast, multimodal)
2. Map their choice to the correct \`provider\` + \`model\` values.
3. If the user's prompt intent is clear, propose the node with a sensible
   \`systemPrompt\` already filled in — don't leave it blank.
`,
};
