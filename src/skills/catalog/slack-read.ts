import type { Skill } from '../types';

export const skill: Skill = {
    name: 'slack-read',
    title: 'Slack — Read Messages',
    summary: 'Fetch recent messages from a Slack channel or DM conversation.',
    whenToUse:
        'Use when the user wants to read, monitor, or process messages from a Slack channel ' +
        'or direct message — e.g. "get the last 10 messages from #support".',
    keywords: ['slack', 'read', 'fetch', 'messages', 'channel', 'thread', 'dm', 'inbox'],
    category: 'integration',
    nodeType: 'slack',
    requiresCredential: 'slack',
    body: `
# Slack — Read Messages

Fetches recent messages from a Slack channel or DM.

## Required config
- \`credentialId\` (string): Connected Slack credential id.
  Call \`list_credentials({ provider: "slack" })\` to find it.
- \`action\` (string): \`"read_messages"\` (channel/DM) or \`"read_thread"\` (thread replies).
- For \`read_messages\`:
  - \`readSource\` (\`"channel" | "dm"\`): Where to read from.
  - \`channel\` (string): Channel id/name (when \`readSource === "channel"\`).
    Call \`list_slack_channels\` and present via \`ask_user\`.
  - \`readUserId\` (string): User id (when \`readSource === "dm"\`).
    Call \`list_slack_users\` and present via \`ask_user\`.
- For \`read_thread\`:
  - \`channel\` (string): Channel where the thread lives.
  - \`threadTs\` (string): The parent message timestamp (e.g. from a trigger output).

## Optional config
- \`limit\` (number): Max messages to return (default 20).

## Output fields
- \`messages\`: Array of \`{ ts, text, userId, username, formattedTs }\`
- \`count\`: Number of messages returned

## Fluxelle workflow
1. Call \`list_credentials({ provider: "slack" })\` → resolve \`credentialId\`.
2. Use \`ask_user\` to ask whether to read from a channel or DM.
3. Call \`list_slack_channels\` or \`list_slack_users\` accordingly and present via \`ask_user\`.
4. Ask how many messages they want (default 20).

## Example — read last 10 messages from #support
\`\`\`json
{
  "id": "slack-read-1",
  "type": "slack",
  "name": "Read #support",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "read_messages",
    "readSource": "channel",
    "channel": "<resolved-from-list_slack_channels>",
    "limit": 10
  },
  "next": []
}
\`\`\`

Downstream: reference messages as \`{{ nodes.slack-read-1.messages }}\`.
`,
};
