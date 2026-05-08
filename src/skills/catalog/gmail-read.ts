import type { Skill } from '../types';

export const skill: Skill = {
    name: 'gmail-read',
    title: 'Gmail — Read / Search Emails',
    summary: 'Fetch and read emails from a connected Gmail account with flexible filters.',
    whenToUse:
        'Use when the user wants to read, search, or process emails from Gmail — ' +
        '"get unread emails from John", "find emails with subject containing invoice", ' +
        '"read the latest 5 emails". For sending, use gmail-send.',
    keywords: ['gmail', 'read', 'fetch', 'search', 'email', 'inbox', 'unread', 'list', 'filter'],
    category: 'integration',
    nodeType: 'gmail',
    requiresCredential: 'google',
    body: `
# Gmail — Read / Search Emails

Searches for and reads emails from a connected Gmail account using flexible
filter criteria.

## Required config
- \`credentialId\` (string): Connected Google credential id.
  Call \`list_credentials({ provider: "google" })\` to find it.
- \`action\` (string): \`"list"\` (fetch multiple emails) or \`"read"\` (single message by id).

## For \`action: "list"\` — optional filters
- \`readStatus\` (\`"all" | "read" | "unread"\`): Default \`"all"\`.
- \`fromFilter\` (string | string[]): Filter by sender email or name.
- \`subjectFilter\` (string): Partial subject match.
- \`bodyFilter\` (string): Search within email body.
- \`hasAttachment\` (boolean): Only return emails with attachments.
- \`labelIds\` (string[]): Filter by label ids.
  Call \`list_gmail_labels\` and present via \`ask_user\`.
- \`maxResults\` (number): Default 10.

## For \`action: "read"\`
- \`messageId\` (string): Gmail message id (e.g. from a previous list output or trigger).

## Output fields (list)
- \`messages\`: Array of \`{ id, threadId, subject, from, to, date, snippet, body, labels }\`
- \`count\`: Total found

## Output fields (read)
- \`id\`, \`threadId\`, \`subject\`, \`from\`, \`to\`, \`date\`, \`snippet\`, \`body\`, \`labels\`

## Fluxelle workflow
1. Call \`list_credentials({ provider: "google" })\` → resolve \`credentialId\`.
2. If the user mentions a label (e.g. "starred", "important"), call \`list_gmail_labels\`
   and present via \`ask_user\`.
3. Use \`ask_user\` to clarify filters if they were described vaguely.

## Example — fetch last 5 unread emails
\`\`\`json
{
  "id": "gmail-read-1",
  "type": "gmail",
  "name": "Fetch Unread Emails",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "list",
    "readStatus": "unread",
    "maxResults": 5
  },
  "next": []
}
\`\`\`

Downstream: reference emails as \`{{ nodes.gmail-read-1.messages }}\`.
`,
};
