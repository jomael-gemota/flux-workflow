import type { Skill } from '../types';

export const skill: Skill = {
    name: 'gdocs',
    title: 'Google Docs — Create, Read, Append, Rename',
    summary: 'Create new documents, read content, append text/links/images, or rename Google Docs.',
    whenToUse:
        'Use for any Google Docs operation — creating a new doc, reading its content, ' +
        'appending text or images to an existing doc, or renaming it.',
    keywords: [
        'docs', 'google docs', 'document', 'create', 'read', 'append', 'write', 'rename', 'gdocs',
    ],
    category: 'integration',
    nodeType: 'gdocs',
    requiresCredential: 'google',
    body: `
# Google Docs — Create, Read, Append, Rename

Create, read, append content to, or rename a Google Docs document.

## Required config (all actions)
- \`credentialId\` (string): Connected Google credential id.
  Call \`list_credentials({ provider: "google" })\` to find it.
- \`action\` (string): \`"create"\` | \`"read"\` | \`"append"\` | \`"rename"\`.

---

## Action: \`"create"\`
Create a new Google Doc.
- \`title\` (string): Document title.
- \`content\` (string, optional): Initial text content. Supports template expressions.
- \`folderId\` (string, optional): Drive folder to save the document in.
  Call \`list_gdrive_items\` and present folders via \`ask_user\`.

### Output
- \`documentId\`, \`title\`, \`documentUrl\`

---

## Action: \`"read"\`
Read the text content of a document.
- \`documentId\` (string): Direct Google Docs document id.
  Call \`list_gdrive_items\` and present docs via \`ask_user\`.
- OR use \`documentName\` (string) + optional \`searchFolderId\` to find by name.

### Output
- \`content\` (string): Plain text of the document
- \`title\`, \`documentId\`

---

## Action: \`"append"\`
Append content to an existing document.
- \`documentId\` (string): Target document.
- \`text\` (string, optional): Text to append. Supports template expressions.
- \`appendLink\` (boolean, optional): Also append a hyperlink.
  - \`linkText\` (string), \`linkUrl\` (string)
- \`appendImage\` (boolean, optional): Also append an image.
  - \`imageUrl\` (string): Publicly accessible image URL.
  - \`imageWidth\` / \`imageHeight\` (number, optional): Dimensions in points.

### Output
- \`documentId\`, \`revisionsId\`

---

## Action: \`"rename"\`
Rename a Google Doc.
- \`documentId\` (string): Target document.
- \`newTitle\` (string): New document title.

### Output
- \`documentId\`, \`title\`

---

## Fluxelle workflow
1. Call \`list_credentials({ provider: "google" })\` → resolve \`credentialId\`.
2. Use \`ask_user\` to clarify the action if not obvious.
3. For \`read\`, \`append\`, \`rename\`: call \`list_gdrive_items\` and present docs via \`ask_user\`.
4. For \`create\`: ask for a title and optional initial content (can be LLM output).

## Example — create a doc with AI-generated content
\`\`\`json
{
  "id": "gdocs-1",
  "type": "gdocs",
  "name": "Create Summary Doc",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "create",
    "title": "Weekly Summary — {{ nodes.trigger-1.scheduledAt }}",
    "content": "{{ nodes.llm-1.content }}"
  },
  "next": []
}
\`\`\`

## Example — append text to an existing doc
\`\`\`json
{
  "id": "gdocs-2",
  "type": "gdocs",
  "name": "Append to Meeting Notes",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "append",
    "documentId": "<resolved-from-list_gdrive_items>",
    "text": "\\n\\n{{ nodes.llm-1.content }}"
  },
  "next": []
}
\`\`\`
`,
};
