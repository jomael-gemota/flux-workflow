import type { Skill } from '../types';

export const skill: Skill = {
    name: 'teams-send-message',
    title: 'Microsoft Teams — Send Message',
    summary: 'Post a message to a Microsoft Teams channel.',
    whenToUse:
        'Use when the user wants to send a message or notification into a Microsoft Teams channel.',
    keywords: ['teams', 'microsoft', 'send', 'message', 'channel', 'notify'],
    category: 'integration',
    nodeType: 'teams',
    requiresCredential: 'teams',
    body: `
# Microsoft Teams — Send Message

Posts a message to a specific Teams channel via Microsoft Graph.

## Required config
- \`credentialId\` (string): Connected Teams credential id.
  Call \`list_credentials({ provider: "teams" })\` to find it.
- \`action\` (string): Must be \`"send_message"\`.
- \`teamId\` (string): Microsoft Teams team id (guid).
  After resolving \`credentialId\`, call \`list_teams\` and present options via
  \`ask_user\` — never leave this blank.
- \`channelId\` (string): Channel id within that team.
  After the user picks a team, call \`list_teams_channels\` and present options
  via \`ask_user\`.
- \`text\` (string): Message body. Supports template expressions and basic HTML.

## Output fields
- \`messageId\`: Teams message id

## Example
\`\`\`json
{
  "id": "teams-1",
  "type": "teams",
  "name": "Notify Engineering",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "send_message",
    "teamId": "<resolved-from-list_teams>",
    "channelId": "<resolved-from-list_teams_channels>",
    "text": "{{ nodes.llm-1.content }}"
  },
  "next": []
}
\`\`\`
`,
};
