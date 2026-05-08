import type { Skill } from '../types';

export const skill: Skill = {
    name: 'output-result',
    title: 'Output — Final Result',
    summary: 'Capture and expose the final result of a workflow run.',
    whenToUse:
        'Use as the LAST step of a workflow when the user wants the run to "return" a value — ' +
        'visible in execution logs and as the response body for synchronous webhook calls.',
    keywords: ['output', 'result', 'return', 'final', 'response', 'finish'],
    category: 'data',
    nodeType: 'output',
    body: `
# Output — Final Result

Sets the workflow's final result. Multiple output nodes are allowed; the last
one to execute wins.

## Required config
- \`value\` (string): An expression resolving to the result value. Common forms:
    - \`"{{ nodes.llm-1.content }}"\` — bare token (returns the raw value)
    - \`"Done — {{ nodes.transform-1.summary }}"\` — mixed template (returns string)

## Example
\`\`\`json
{
  "id": "output-1",
  "type": "output",
  "name": "Final Result",
  "config": { "value": "{{ nodes.transform-1.output }}" },
  "next": []
}
\`\`\`
`,
};
