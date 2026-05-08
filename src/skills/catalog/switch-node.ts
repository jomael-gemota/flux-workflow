import type { Skill } from '../types';

export const skill: Skill = {
    name: 'switch-node',
    title: 'Switch — Multi-branch Routing',
    summary: 'Route execution to one of many branches based on evaluated conditions.',
    whenToUse:
        'Use when the user needs more than 2 outcomes — e.g. "route to different handlers ' +
        'based on category: billing → A, tech → B, other → C". For simple if/else, use condition-branch.',
    keywords: ['switch', 'route', 'branch', 'multi', 'case', 'match', 'if-else-if', 'router'],
    category: 'logic',
    nodeType: 'switch',
    body: `
# Switch — Multi-branch Routing

Evaluates a series of conditions in order and routes to the first matching
branch, or falls through to \`defaultNext\`.

## Required config
- \`cases\` (array): Ordered list of condition-branch pairs:
  \`\`\`json
  [
    {
      "condition": { "type": "leaf", "left": "<expression>", "operator": "<op>", "right": "<value>" },
      "next": "<node-id>",
      "label": "Optional human label"
    }
  ]
  \`\`\`
- \`defaultNext\` (string): Node id to run if no case matches.

## Condition shape
Same as the condition-branch node:
- \`{ "type": "leaf", "left": "{{ nodes.x.field }}", "operator": "eq", "right": "billing" }\`
- Operators: \`"eq"\`, \`"neq"\`, \`"contains"\`, \`"startsWith"\`, \`"endsWith"\`, \`"gt"\`, \`"gte"\`, \`"lt"\`, \`"lte"\`, \`"isNull"\`, \`"isNotNull"\`
- Compound: \`{ "type": "group", "operator": "and", "conditions": [...] }\`

## Output fields
- \`matchedCase\`: Index of the matched case (0-based) or \`"default"\`
- \`matchedLabel\`: Label of the matched case (if provided)
- \`nextNodeId\`: The node id that execution will continue to

## Important
- The \`next\` array on a switch node stays **empty** — routing is done via \`cases[].next\` and \`defaultNext\`.
- When proposing a switch node, ALWAYS include all branch nodes in the same proposal.

## Fluxelle workflow
1. Ask the user how many branches are needed and what condition determines each branch.
2. Use \`ask_user\` to confirm the condition field and value(s) for each case.
3. Propose the switch node AND all branch nodes together.

## Example — 3-way category router
\`\`\`json
{
  "id": "switch-1",
  "type": "switch",
  "name": "Route by Category",
  "config": {
    "cases": [
      {
        "condition": { "type": "leaf", "left": "{{ nodes.llm-classify.content }}", "operator": "contains", "right": "billing" },
        "next": "billing-handler",
        "label": "Billing"
      },
      {
        "condition": { "type": "leaf", "left": "{{ nodes.llm-classify.content }}", "operator": "contains", "right": "technical" },
        "next": "tech-handler",
        "label": "Technical"
      }
    ],
    "defaultNext": "general-handler"
  },
  "next": []
}
\`\`\`
`,
};
