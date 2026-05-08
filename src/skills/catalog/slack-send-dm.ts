import type { Skill } from '../types';

export const skill: Skill = {
    name: 'slack-send-dm',
    title: 'Slack — Send Direct Message',
    summary: 'Send a private Slack DM to one or more users.',
    whenToUse:
        'Use when the user wants to send a private/direct message to a specific Slack user ' +
        '(not to a channel). For channel messages use the slack-send-message skill.',
    keywords: ['slack', 'dm', 'direct message', 'private', 'user', 'message', 'notify'],
    category: 'integration',
    nodeType: 'slack',
    requiresCredential: 'slack',
    body: `
# Slack — Send Direct Message

Opens a DM conversation with one or more users and sends a message.

## Required config
- \`credentialId\` (string): Connected Slack credential id.
  Call \`list_credentials({ provider: "slack" })\` to find it. If none are
  connected, tell the user to add one via Settings → Credentials.
- \`action\` (string): Must be \`"send_dm"\`.
- \`userIds\` (string): Comma-separated Slack user ids — e.g. \`"U0123,U0456"\`.
  After resolving \`credentialId\`, call \`list_slack_users\` and present matching
  users via \`ask_user\` — never leave this blank.
- \`text\` (string): Message body. Supports template expressions.

## Optional config
- \`senderType\` (\`"user" | "bot"\`): Defaults to \`"user"\`.
- \`botUsername\`, \`botIconEmoji\`, \`botIconUrl\`: Only applied when \`senderType === "bot"\`.

## Output fields
- \`channel\`: The DM conversation id
- \`ts\`: Slack message timestamp

## Fluxelle workflow
1. Call \`list_credentials({ provider: "slack" })\` → resolve \`credentialId\`.
2. Call \`list_slack_users\` → present via \`ask_user\` for the recipient(s).
3. Ask for the message text if not provided.
4. Propose the node with all fields populated.

## Example
\`\`\`json
{
  "id": "slack-dm-1",
  "type": "slack",
  "name": "DM John",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "send_dm",
    "userIds": "<resolved-from-list_slack_users>",
    "text": "Hey! Your report is ready: {{ nodes.llm-1.content }}"
  },
  "next": []
}
\`\`\`
`,
};
