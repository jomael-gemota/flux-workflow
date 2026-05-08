import type { Skill } from '../types';

export const skill: Skill = {
    name: 'message-formatter',
    title: 'Message Formatter — Rich Notifications',
    summary: 'Format data into rich, platform-native messages for Slack, Teams, Gmail, or Google Docs.',
    whenToUse:
        'Use when the user wants to send a well-formatted notification with tables, ' +
        'bold text, bullet points, or structured data — not just a plain text message. ' +
        'Place this node BEFORE the Slack/Teams/Gmail/GDocs node and reference its output.',
    keywords: [
        'formatter', 'format', 'template', 'rich', 'table', 'html', 'markdown', 'message',
        'notification', 'layout', 'slack', 'teams', 'gmail', 'gdocs',
    ],
    category: 'data',
    nodeType: 'formatter',
    body: `
# Message Formatter — Rich Notifications

Transforms workflow data into a richly formatted message optimized for a
specific platform. The output \`html\` or \`text\` field is then passed to the
corresponding notification node.

## Required config
- \`medium\` (string): Target platform — \`"slack"\` | \`"teams"\` | \`"gmail"\` | \`"gdocs"\`.
- \`template\` (string): Message template with template expressions.
  Supports markdown-style markup; the formatter converts it to the correct
  format for the chosen medium (mrkdwn for Slack, Adaptive Cards for Teams, HTML for Gmail/GDocs).

## Optional config
- \`teamsLayout\` (\`"table" | "text"\`): Layout style for Teams messages.
- \`gmailLayout\` (\`"table" | "text"\`): Layout style for Gmail messages.

## Output fields
- \`text\`: Formatted output string (mrkdwn, HTML, or plain text depending on platform).
  Pass this to the downstream notification node's \`text\` or \`body\` field.

## Fluxelle workflow
1. Use \`ask_user\` to confirm the target platform if not already known.
2. Build a sensible default template from the data available in upstream nodes.
3. Propose the formatter node AND the downstream notification node together.

## Example — Slack table of results
\`\`\`json
{
  "id": "formatter-1",
  "type": "formatter",
  "name": "Format Slack Summary",
  "config": {
    "medium": "slack",
    "template": "*Daily Report* — {{ nodes.trigger-1.scheduledAt }}\\n\\n{{ nodes.transform-1.output }}"
  },
  "next": ["slack-1"]
}
\`\`\`

Then reference the output:
\`\`\`json
{
  "id": "slack-1",
  "type": "slack",
  "name": "Post Report",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "send_message",
    "channels": "#reports",
    "text": "{{ nodes.formatter-1.text }}"
  },
  "next": []
}
\`\`\`

## Tips
- For complex tables, pass an object or array expression as the template and
  the formatter will auto-render it as a key-value table.
- For Gmail, set \`isHtml: true\` on the Gmail node when using this formatter.
`,
};
