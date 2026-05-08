import type { Skill } from '../types';

export const skill: Skill = {
    name: 'gsheets-append-row',
    title: 'Google Sheets — Append Row',
    summary: 'Append a new row of data to a Google Sheet.',
    whenToUse:
        'Use when the user wants to log, record, or save data to a spreadsheet — ' +
        'form responses, audit trails, exports, etc.',
    keywords: ['sheets', 'spreadsheet', 'google', 'append', 'row', 'log', 'record', 'save'],
    category: 'integration',
    nodeType: 'gsheets',
    requiresCredential: 'google',
    body: `
# Google Sheets — Append Row

Adds a new row to the bottom of a sheet range.

## Required config
- \`credentialId\` (string): Connected Google credential id.
  Call \`list_credentials({ provider: "google" })\` to find it.
- \`action\` (string): Must be \`"append"\`.
- \`spreadsheetId\` (string): The Google Sheets document id (the long id from its URL).
  Call \`list_gsheets\` and present options via \`ask_user\` — never leave blank.
- \`range\` (string): A1-notation range — e.g. \`"Sheet1!A:Z"\`.
  After the user picks a spreadsheet, call \`list_gsheet_tabs\` to offer real
  tab names. Combine with column range: \`"<TabName>!A:Z"\`.
- \`values\` (array): One row as an array of cell values, e.g. \`["{{ nodes.trigger-1.body.name }}", "{{ nodes.trigger-1.body.email }}"]\`.
  May also be an array-of-arrays for multiple rows.

## Optional config
- \`valueInputOption\` (\`"RAW" | "USER_ENTERED"\`): Defaults to \`"USER_ENTERED"\` so formulas / dates parse.

## Output fields
- \`updatedRange\`: The range that was updated
- \`updatedRows\`: Number of rows added

## Example
\`\`\`json
{
  "id": "gsheets-1",
  "type": "gsheets",
  "name": "Log Submission",
  "config": {
    "credentialId": "",
    "action": "append",
    "spreadsheetId": "1abc...xyz",
    "range": "Submissions!A:C",
    "values": [
      "{{ nodes.trigger-1.triggeredAt }}",
      "{{ nodes.trigger-1.body.email }}",
      "{{ nodes.llm-1.content }}"
    ]
  },
  "next": []
}
\`\`\`
`,
};
