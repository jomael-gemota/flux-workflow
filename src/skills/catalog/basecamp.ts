import type { Skill } from '../types';

export const skill: Skill = {
    name: 'basecamp',
    title: 'Basecamp — Todos, Messages, Campfire & Team',
    summary: 'Create todos, post messages, send campfire chats, manage todolists, and invite users in Basecamp.',
    whenToUse:
        'Use for any Basecamp action — creating or completing todos, posting message board ' +
        'announcements, chatting in Campfire, listing todos, or managing team membership.',
    keywords: [
        'basecamp', 'todo', 'task', 'message', 'campfire', 'chat', 'project',
        'invite', 'team', 'todolist', 'complete', 'assign',
    ],
    category: 'integration',
    nodeType: 'basecamp',
    requiresCredential: 'basecamp',
    body: `
# Basecamp — Todos, Messages, Campfire & Team

Automate Basecamp tasks: create todos, post to message boards, send Campfire
messages, list todos, and manage team members.

## Required config (all actions)
- \`credentialId\` (string): Connected Basecamp credential id.
  Call \`list_credentials({ provider: "basecamp" })\` to find it.
- \`action\` (string): One of the actions listed below.
- \`projectId\` (string): Basecamp project id (required for most actions).
  Call \`list_basecamp_projects\` and present via \`ask_user\` — never leave blank.

---

## Action: \`"create_todo"\`
Create a new todo in a todolist.
- \`todolistId\` (string): The todolist to add the todo to.
  Call \`list_basecamp_todolists\` and present via \`ask_user\`.
- \`content\` (string): Todo title/description. Supports template expressions.
- \`description\` (string, optional): Rich-text description.
- \`assigneeIds\` (string, optional): Comma-separated Basecamp person ids.
  Call \`list_basecamp_people\` and present via \`ask_user\`.
- \`dueOn\` (string, optional): Due date in \`YYYY-MM-DD\` format or common date expressions.
- \`attachmentContent\` / \`attachmentName\` / \`attachmentMimeType\` (string, optional):
  For attaching a file — typically expressions from a GDrive download node.

### Output
- \`todoId\`, \`todoUrl\`, \`content\`

---

## Action: \`"complete_todo"\` / \`"uncomplete_todo"\`
Mark a todo as done or reopen it.
- \`todoId\` (string): The todo id (from a previous create_todo or list_todos output).

---

## Action: \`"list_todos"\`
Fetch todos from a todolist.
- \`todolistId\` (string). Call \`list_basecamp_todolists\` → \`ask_user\`.
- \`completed\` (boolean, optional): Default \`false\` (active todos only).

### Output
- \`todos\`: Array of \`{ id, content, completed, dueOn, assignees, url }\`

---

## Action: \`"post_message"\`
Post an announcement to the project message board.
- \`subject\` (string): Message subject.
- \`text\` (string): Message body (plain text or HTML).

### Output
- \`messageId\`, \`messageUrl\`

---

## Action: \`"post_comment"\`
Comment on an existing recording (todo, message, etc.).
- \`recordingId\` (string): The id of the item to comment on.
- \`text\` (string): Comment content.

---

## Action: \`"send_campfire"\`
Send a message to the project Campfire (group chat).
- \`text\` (string): Message content. Supports template expressions.

### Output
- \`chatLineId\`, \`text\`

---

## Action: \`"invite_users"\`
Invite a new person to the Basecamp account.
- \`inviteEmail\` (string): Email address of the person to invite.
- \`inviteName\` (string): Full name.
- \`inviteTitle\` (string, optional), \`inviteCompany\` (string, optional).

---

## Action: \`"remove_user"\`
Remove a person from the Basecamp account.
- \`removeName\` (string): Full name of the person to remove (preferred).
  OR \`removeEmail\` (string): Email address.

---

## Fluxelle workflow
1. Call \`list_credentials({ provider: "basecamp" })\` → resolve \`credentialId\`.
2. Call \`list_basecamp_projects\` → present via \`ask_user\` to pick the project.
3. For todo actions: call \`list_basecamp_todolists\` → present via \`ask_user\`.
4. For assignments: call \`list_basecamp_people\` → present via \`ask_user\`.
5. Ask for any remaining required fields (content, subject, due date, etc.).

## Example — create a todo assigned to a team member
\`\`\`json
{
  "id": "basecamp-1",
  "type": "basecamp",
  "name": "Create Follow-up Todo",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "create_todo",
    "projectId": "<resolved-from-list_basecamp_projects>",
    "todolistId": "<resolved-from-list_basecamp_todolists>",
    "content": "Follow up: {{ nodes.llm-1.content }}",
    "assigneeIds": "<resolved-from-list_basecamp_people>",
    "dueOn": "{{ nodes.trigger-1.body.dueDate }}"
  },
  "next": []
}
\`\`\`

## Example — send a Campfire message
\`\`\`json
{
  "id": "basecamp-fire-1",
  "type": "basecamp",
  "name": "Announce in Campfire",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "send_campfire",
    "projectId": "<resolved-from-list_basecamp_projects>",
    "text": "✅ Deployment complete! {{ nodes.trigger-1.body.version }}"
  },
  "next": []
}
\`\`\`
`,
};
