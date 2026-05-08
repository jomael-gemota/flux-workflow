import type { Skill } from '../types';

export const skill: Skill = {
    name: 'teams-send-dm',
    title: 'Microsoft Teams — Send Direct Message',
    summary: 'Send a private chat message to a Microsoft Teams user.',
    whenToUse:
        'Use when the user wants to send a private/direct message to a specific Teams user ' +
        '(not to a channel). For channel messages use the teams-send-message skill.',
    keywords: ['teams', 'microsoft', 'dm', 'direct message', 'private', 'user', 'chat', 'notify'],
    category: 'integration',
    nodeType: 'teams',
    requiresCredential: 'teams',
    body: `
# Microsoft Teams — Send Direct Message

Sends a 1:1 chat message to a Teams user via Microsoft Graph.

## Required config
- \`credentialId\` (string): Connected Teams credential id.
  Call \`list_credentials({ provider: "teams" })\` to find it.
- \`action\` (string): Must be \`"send_dm"\`.
- \`userId\` (string): Azure AD / Teams user id (guid).
  Call \`list_teams_users\` and present via \`ask_user\` — never leave blank.
- \`text\` (string): Message body. Supports template expressions and HTML.

## Output fields
- \`messageId\`: Teams message id

## Fluxelle workflow
1. Call \`list_credentials({ provider: "teams" })\` → resolve \`credentialId\`.
2. Call \`list_teams_users\` → present via \`ask_user\` to pick the recipient.
3. Ask for the message body if not provided.
4. Propose the node with all fields populated.

## Example
\`\`\`json
{
  "id": "teams-dm-1",
  "type": "teams",
  "name": "DM User",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "send_dm",
    "userId": "<resolved-from-list_teams_users>",
    "text": "Your report is ready: {{ nodes.llm-1.content }}"
  },
  "next": []
}
\`\`\`
`,
};
