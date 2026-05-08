import type { Skill } from '../types';

export const skill: Skill = {
    name: 'loop',
    title: 'Loop — Iterate Over a List',
    summary: 'Iterate over an array, run N times, or loop while a condition is true, accumulating results.',
    whenToUse:
        'Use when the user wants to process each item in a list — "for each email", ' +
        '"repeat 5 times", "process every row in the sheet". Runs the loop body as ' +
        'JavaScript and collects results; does not fan out to separate workflow nodes.',
    keywords: ['loop', 'iterate', 'foreach', 'repeat', 'each', 'array', 'list', 'batch', 'while'],
    category: 'data',
    nodeType: 'loop',
    body: `
# Loop — Iterate Over a List

A self-contained loop node. It runs a JavaScript \`body\` expression for each
iteration and returns all results plus a final accumulator value.

## Required config
- \`mode\` (string): \`"forEach"\` | \`"times"\` | \`"while"\` | \`"batch"\`.
- \`body\` (string): JavaScript expression executed each iteration.
  The **last expression** (or explicit \`return\`) becomes the iteration result.

## Mode-specific config

### \`"forEach"\`
Iterate over an array from an upstream node.
- \`items\` (string): Expression resolving to an array.
  E.g. \`"{{ nodes.gsheets-read-1.rows }}"\` or \`"nodes.gmail-read-1.messages"\`.
- Available in \`body\`: \`item\`, \`index\`, \`acc\`, \`nodes\`, \`input\`.

### \`"times"\`
Run N times.
- \`count\` (string | number): Number of iterations (or expression resolving to a number).
- Available: \`index\`, \`acc\`, \`nodes\`, \`input\`.

### \`"while"\`
Run until a JavaScript condition returns false.
- \`condition\` (string): JS expression evaluated each iteration.
- Available: \`index\`, \`acc\`, \`nodes\`, \`input\`.
- \`maxIterations\` (number): Safety cap (default 1000).

### \`"batch"\`
Process an array in chunks.
- \`items\` (string): Array expression.
- \`batchSize\` (number): Chunk size (default 10).
- Available in \`body\`: \`batch\` (the chunk), \`index\`, \`acc\`, \`nodes\`, \`input\`.

## Optional config
- \`initialAcc\` (string): JavaScript expression for the initial accumulator value.
- \`maxIterations\` (number): Hard cap to prevent infinite loops.

## Output fields
- \`results\`: Array of per-iteration return values
- \`acc\`: Final accumulator value
- \`count\`: Number of iterations completed

## Fluxelle workflow
1. Use \`ask_user\` to clarify the mode if not obvious.
2. Point \`items\` at the correct upstream array with a template expression.
3. Write the \`body\` to compute the per-item result using the \`item\` variable.

## Example — sum all amounts from a spreadsheet
\`\`\`json
{
  "id": "loop-1",
  "type": "loop",
  "name": "Sum Amounts",
  "config": {
    "mode": "forEach",
    "items": "{{ nodes.gsheets-read-1.rows }}",
    "initialAcc": "0",
    "body": "return acc + Number(item.Amount || 0);"
  },
  "next": []
}
\`\`\`

Output: \`{{ nodes.loop-1.acc }}\` = total, \`{{ nodes.loop-1.results }}\` = per-row values.

## Example — process each email (forEach)
\`\`\`json
{
  "id": "loop-2",
  "type": "loop",
  "name": "Process Emails",
  "config": {
    "mode": "forEach",
    "items": "{{ nodes.gmail-read-1.messages }}",
    "body": "return { from: item.from, snippet: item.snippet };"
  },
  "next": []
}
\`\`\`
`,
};
