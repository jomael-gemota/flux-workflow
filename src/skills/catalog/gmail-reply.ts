import type { Skill } from '../types';

export const skill: Skill = {
    name: 'gmail-reply',
    title: 'Gmail — Reply to Email',
    summary: 'Reply to an existing Gmail thread or message.',
    whenToUse:
        'Use when the user wants to reply to an email they have already received — ' +
        '"reply to this email", "reply to the thread", "respond to the sender". ' +
        'For sending a new email, use gmail-send.',
    keywords: ['gmail', 'reply', 'respond', 'thread', 'email', 'answer', 'forward', 'reply-all'],
    category: 'integration',
    nodeType: 'gmail',
    requiresCredential: 'google',
    body: `
# Gmail — Reply to Email

Sends a reply within an existing Gmail thread.

## Required config
- \`credentialId\` (string): Connected Google credential id.
  Call \`list_credentials({ provider: "google" })\` to find it.
- \`action\` (string): \`"reply"\`.
- \`replyToMessageId\` (string): Gmail message id to reply to.
  Typically an expression from an upstream gmail-read node:
  \`"{{ nodes.gmail-read-1.messages[0].id }}"\`.
- \`body\` (string): Reply text. Supports template expressions.

## Optional config
- \`subject\` (string): Overrides the subject (defaults to \`Re: <original>\`).
- \`replyAll\` (boolean): When \`true\`, replies to all original recipients. Default \`false\`.
- \`cc\` (string), \`bcc\` (string): Comma-separated extra recipients.
- \`isHtml\` (boolean): Set \`true\` if \`body\` contains HTML.

## Output fields
- \`messageId\`: Gmail message id of the sent reply
- \`threadId\`: Thread id

## Fluxelle workflow
1. Call \`list_credentials({ provider: "google" })\` → resolve \`credentialId\`.
2. Use \`ask_user\` to ask if this is a Reply or Reply All.
3. The \`replyToMessageId\` usually comes from an upstream gmail-read or trigger node
   — reference it with a template expression.
4. Ask for the reply body if not derived from an LLM node.

## Example — auto-reply to support emails
\`\`\`json
{
  "id": "gmail-reply-1",
  "type": "gmail",
  "name": "Reply to Customer",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "reply",
    "replyToMessageId": "{{ nodes.gmail-read-1.messages[0].id }}",
    "body": "{{ nodes.llm-1.content }}",
    "replyAll": false
  },
  "next": []
}
\`\`\`
`,
};
