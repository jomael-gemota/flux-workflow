import type { Skill } from '../types';

export const skill: Skill = {
    name: 'slack-send-message',
    title: 'Slack — Send Message',
    summary: 'Post a message to one or more Slack channels.',
    whenToUse:
        'Use when the user wants to send a message, notification, or alert to a Slack channel. ' +
        'For direct messages to a user, use the slack-send-dm skill instead.',
    keywords: ['slack', 'send', 'message', 'post', 'notify', 'channel', 'alert', 'team'],
    category: 'integration',
    nodeType: 'slack',
    requiresCredential: 'slack',
    body: `
# Slack — Send Message

Posts a text message to one or more Slack channels using a connected Slack
credential.

## Required config
- \`credentialId\` (string): Id of the user's connected Slack credential.
  If you don't know it, leave it as an empty string \`""\` and tell the user
  they need to connect Slack via Settings → Credentials.
- \`action\` (string): Must be \`"send_message"\`.
- \`channels\` (string): Comma-separated channel names or ids — e.g. \`"#general,#alerts"\` or \`"C0123,C0456"\`.
- \`text\` (string): Message body. Supports template expressions like \`{{ nodes.<id>.output.<field> }}\`.

## Optional config
- \`senderType\` (\`"user" | "bot"\`): Defaults to \`"user"\`. Use \`"bot"\` to send as Fluxelle AI.
- \`botUsername\`, \`botIconEmoji\`, \`botIconUrl\`: Only applied when \`senderType === "bot"\`.

## Output fields
- \`channel\`: The channel id where the message landed
- \`ts\`: The Slack message timestamp (use this to reply in a thread later)
- \`messageCount\`: Number of channels messaged (when multi-channel)

## Example — notify on #alerts
\`\`\`json
{
  "id": "slack-1",
  "type": "slack",
  "name": "Notify #alerts",
  "config": {
    "credentialId": "",
    "action": "send_message",
    "channels": "#alerts",
    "text": "🚨 New urgent ticket: {{ nodes.llm-1.output.content }}"
  },
  "next": []
}
\`\`\`
`,
};
