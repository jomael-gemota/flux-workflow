import type { Skill } from '../types';

export const skill: Skill = {
    name: 'pattern-summarize-and-notify',
    title: 'Pattern — Summarize & Notify',
    summary:
        'Take inbound text, summarize it with AI, and post the summary to Slack / Teams / Email.',
    whenToUse:
        'Use when the user describes an end-to-end flow like "summarize support emails ' +
        'and post to Slack" or "TL;DR new GitHub issues into Teams". Compose this ' +
        'into 3-4 nodes: Trigger → LLM (summarize) → Notification node.',
    keywords: [
        'summarize', 'notify', 'tldr', 'pattern', 'template', 'classify-and-route',
        'email-to-slack', 'webhook-to-teams',
    ],
    category: 'pattern',
    body: `
# Pattern — Summarize & Notify

A reusable template combining 3 nodes:

1. **Trigger** — typically \`webhook\` or \`cron\`.
2. **LLM** — summarize the inbound text.
3. **Notification** — Slack \`send_message\`, Teams \`send_message\`, or Gmail \`send\`.

## Recommended structure

\`\`\`
trigger-1  →  llm-1 (summarize)  →  slack-1 / teams-1 / gmail-1
\`\`\`

## Example — webhook → summarize → Slack
\`\`\`json
[
  {
    "id": "trigger-1",
    "type": "trigger",
    "name": "Inbound Webhook",
    "config": { "triggerType": "webhook" },
    "next": ["llm-1"]
  },
  {
    "id": "llm-1",
    "type": "llm",
    "name": "Summarize",
    "config": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "systemPrompt": "You write concise 2-sentence summaries.",
      "userPrompt": "Summarize:\\n\\n{{ nodes.trigger-1.body.text }}",
      "temperature": 0.3,
      "maxTokens": 200
    },
    "next": ["slack-1"]
  },
  {
    "id": "slack-1",
    "type": "slack",
    "name": "Post to Slack",
    "config": {
      "credentialId": "",
      "action": "send_message",
      "channels": "#updates",
      "text": "📰 *Summary*\\n{{ nodes.llm-1.content }}"
    },
    "next": []
  }
]
\`\`\`

When the user invokes this pattern, first call \`list_credentials\` to find
the right credential for the notification node, then call the appropriate
\`list_slack_channels\` / \`list_teams\` / etc. tool, present choices via
\`ask_user\`, and only once you have a confirmed \`credentialId\` and
target, propose ALL nodes in a single \`propose_workflow_changes\` call
with fully-populated config (no empty string ids).
`,
};
