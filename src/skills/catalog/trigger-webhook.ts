import type { Skill } from '../types';

export const skill: Skill = {
    name: 'trigger-webhook',
    title: 'Webhook Trigger',
    summary: 'Start a workflow when an external service POSTs to a unique URL.',
    whenToUse:
        'Use when the user wants the workflow to fire from an external system: ' +
        'form submissions, Stripe events, GitHub webhooks, custom integrations, etc.',
    keywords: ['trigger', 'webhook', 'http', 'post', 'callback', 'external', 'event'],
    category: 'trigger',
    nodeType: 'trigger',
    body: `
# Webhook Trigger

Generates a public URL that, when POSTed to, starts the workflow with the
request body / headers / query as the trigger output.

## Config
- \`triggerType\` (string): Must be \`"webhook"\`.

## Output fields
- \`triggerType\`: \`"webhook"\`
- \`body\`: Parsed JSON body of the inbound request
- \`headers\`: Request headers
- \`query\`: Query-string params

## Example
\`\`\`json
{
  "id": "trigger-1",
  "type": "trigger",
  "name": "Form Submission",
  "config": { "triggerType": "webhook" },
  "next": []
}
\`\`\`

Downstream nodes can reference inbound data with expressions like
\`{{ nodes.trigger-1.body.email }}\`.
`,
};
