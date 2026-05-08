import type { Skill } from '../types';

export const skill: Skill = {
    name: 'pattern-form-to-spreadsheet',
    title: 'Pattern — Form Submission → Google Sheet',
    summary: 'Capture inbound webhook data and append it as a row to a Google Sheet.',
    whenToUse:
        'Use when the user wants to log form responses, signups, or any inbound webhook ' +
        'data into a spreadsheet for tracking.',
    keywords: ['form', 'webhook', 'spreadsheet', 'sheets', 'log', 'record', 'capture'],
    category: 'pattern',
    body: `
# Pattern — Form Submission → Google Sheet

A 2-node template:

1. **Trigger (webhook)** — receives form POSTs.
2. **GSheets (append)** — appends one row per submission.

## Example
\`\`\`json
[
  {
    "id": "trigger-1",
    "type": "trigger",
    "name": "Form Webhook",
    "config": { "triggerType": "webhook" },
    "next": ["gsheets-1"]
  },
  {
    "id": "gsheets-1",
    "type": "gsheets",
    "name": "Append Row",
    "config": {
      "credentialId": "",
      "action": "append",
      "spreadsheetId": "",
      "range": "Submissions!A:D",
      "values": [
        "{{ nodes.trigger-1.triggeredAt }}",
        "{{ nodes.trigger-1.body.name }}",
        "{{ nodes.trigger-1.body.email }}",
        "{{ nodes.trigger-1.body.message }}"
      ]
    },
    "next": []
  }
]
\`\`\`

## Fluxelle workflow
1. Call \`list_credentials({ provider: "google" })\` → resolve \`credentialId\`.
2. Call \`list_gsheets\` → present via \`ask_user\` to pick the spreadsheet.
3. Call \`list_gsheet_tabs\` → present tab names via \`ask_user\`.
4. Ask which fields from the incoming webhook body to log (e.g. name, email, message).
5. Propose ALL nodes in one \`propose_workflow_changes\` call with fully-populated config.

The \`values\` array should reference \`{{ nodes.trigger-1.body.<field> }}\` for
each piece of data the user wants to capture.
`,
};
