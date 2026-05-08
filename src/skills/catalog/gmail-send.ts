import type { Skill } from '../types';

export const skill: Skill = {
    name: 'gmail-send',
    title: 'Gmail — Send Email',
    summary: 'Send an email from a connected Gmail account.',
    whenToUse:
        'Use when the user wants to send an email — notification, summary, alert, or generated message. ' +
        'For replying to an existing thread, use the gmail-reply skill.',
    keywords: ['gmail', 'email', 'send', 'mail', 'message', 'notify'],
    category: 'integration',
    nodeType: 'gmail',
    requiresCredential: 'google',
    body: `
# Gmail — Send Email

Sends an email from a connected Google account.

## Required config
- \`credentialId\` (string): Id of the user's connected Google credential.
  Call \`list_credentials({ provider: "google" })\` to find it. If none are
  connected, tell the user to add one via Settings → Credentials.
- \`action\` (string): Must be \`"send"\`.
- \`to\` (string): Recipient email — comma-separated for multiple recipients.
  Supports template expressions. Always ask the user for the recipient address
  if it has not been provided; do not leave this field blank.
- \`subject\` (string): Email subject. Supports template expressions.
- \`body\` (string): Plain-text or HTML body. Supports template expressions.

## Optional config
- \`cc\` (string), \`bcc\` (string): Comma-separated lists.
- \`isHtml\` (boolean): Defaults to \`false\`. Set \`true\` if \`body\` contains HTML.

## Output fields
- \`messageId\`: Gmail message id of the sent message
- \`threadId\`: Thread id

## Example — daily summary email
\`\`\`json
{
  "id": "gmail-1",
  "type": "gmail",
  "name": "Email Daily Summary",
  "config": {
    "credentialId": "",
    "action": "send",
    "to": "team@example.com",
    "subject": "Daily Summary — {{ nodes.trigger-1.scheduledAt }}",
    "body": "{{ nodes.llm-1.content }}"
  },
  "next": []
}
\`\`\`
`,
};
