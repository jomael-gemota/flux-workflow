import type { Skill } from '../types';

export const skill: Skill = {
    name: 'code',
    title: 'Code — Custom JavaScript',
    summary: 'Run arbitrary JavaScript to transform data, compute values, or call APIs.',
    whenToUse:
        'Use when no built-in node covers the transformation needed — custom calculations, ' +
        'complex data manipulation, calling an npm library, or anything that requires code logic. ' +
        'For simpler field mapping use the Transform node; for iteration use the Loop node.',
    keywords: ['code', 'javascript', 'script', 'custom', 'compute', 'logic', 'function', 'js', 'node'],
    category: 'data',
    nodeType: 'code',
    body: `
# Code — Custom JavaScript

Executes user-supplied JavaScript and exposes the return value as the node output.

## Required config
- \`code\` (string): JavaScript code. The **last expression** or explicit \`return\`
  becomes \`output.result\`. \`await\` is always available.

## Globals available in code
- \`nodes\` — all prior node outputs, keyed by node id.
  E.g. \`nodes['trigger-1'].body.email\`
- \`input\` — workflow-level input payload
- \`console\` — captured into \`output.logs\` (array of \`{ level, message, timestamp }\`)
- \`workflow\` — \`{ id }\`
- \`execution\` — \`{ id, startedAt }\`
- \`require\`, \`fetch\`, \`Buffer\`, \`process\` — full Node.js environment

## Output fields
- \`result\`: Whatever the code returned
- \`logs\`: Array of console messages

## Fluxelle workflow
1. Describe to the user what the code will compute.
2. Write the code using \`nodes['<nodeId>'].<field>\` to reference upstream data.
3. Propose the node with the \`code\` field fully written — never leave it blank.

## Example — compute days until due date
\`\`\`json
{
  "id": "code-1",
  "type": "code",
  "name": "Days Until Due",
  "config": {
    "code": "const due = new Date(nodes['extract-1'].dueDate);\\nconst today = new Date();\\nconst diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));\\nreturn { daysRemaining: diff, overdue: diff < 0 };"
  },
  "next": []
}
\`\`\`

Output: \`{{ nodes.code-1.result.daysRemaining }}\`.

## Example — call a third-party API with fetch
\`\`\`json
{
  "id": "code-2",
  "type": "code",
  "name": "Lookup Exchange Rate",
  "config": {
    "code": "const res = await fetch('https://api.exchangerate.host/convert?from=USD&to=EUR&amount=1');\\nconst data = await res.json();\\nreturn data.result;"
  },
  "next": []
}
\`\`\`
`,
};
