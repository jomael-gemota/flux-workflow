import type { Skill } from '../types';

export const skill: Skill = {
    name: 'condition-branch',
    title: 'Condition (If / Else)',
    summary: 'Branch the workflow based on a true/false condition.',
    whenToUse:
        'Use when the user wants different behaviour based on a value — "only if", ' +
        '"unless", "when X then Y else Z". Pairs naturally with LLM classification.',
    keywords: ['condition', 'if', 'else', 'branch', 'when', 'unless', 'compare', 'check'],
    category: 'logic',
    nodeType: 'condition',
    body: `
# Condition (If / Else)

Routes execution to one of two next-nodes based on a boolean expression.

## Required config
- \`condition\`: A condition object with shape:
  \`\`\`json
  { "type": "leaf", "left": "<value or expression>", "operator": "<op>", "right": "<value or expression>" }
  \`\`\`
- \`trueNext\` (string): Node id to run when the condition is true.
- \`falseNext\` (string): Node id to run when the condition is false.

## Operators
- Equality: \`"eq"\`, \`"neq"\`
- Comparison: \`"gt"\`, \`"gte"\`, \`"lt"\`, \`"lte"\`
- String: \`"contains"\`, \`"startsWith"\`, \`"endsWith"\`
- Null checks: \`"isNull"\`, \`"isNotNull"\`

## Compound conditions
Use \`{ "type": "group", "operator": "and", "conditions": [<leaf>, <leaf>] }\`
or \`{ "type": "group", "operator": "or", "conditions": [...] }\`.

## Example — only continue if AI classified as "urgent"
\`\`\`json
{
  "id": "cond-1",
  "type": "condition",
  "name": "Is Urgent?",
  "config": {
    "condition": {
      "type": "leaf",
      "left": "{{ nodes.llm-classify.content }}",
      "operator": "contains",
      "right": "urgent"
    },
    "trueNext": "slack-1",
    "falseNext": "output-1"
  },
  "next": []
}
\`\`\`

## Important
The \`next\` array stays empty for condition nodes — routing is determined by
\`trueNext\` / \`falseNext\` only. When proposing a condition node, you MUST
also include the two follow-up nodes in your proposal so they can be wired up.

## Fluxelle workflow
1. If the user hasn't specified what to check, use \`ask_user\` with context-
   appropriate options (e.g., field names from an upstream node output).
2. If the user says "if X equals Y", pick \`"eq"\`; "greater than" → \`"gt"\`;
   "contains" → \`"contains"\`; "is empty" → \`"isNull"\` or check length.
3. Always propose BOTH the true-branch node and the false-branch node (even if
   one is just an output/no-op) so the graph is complete.
`,
};
