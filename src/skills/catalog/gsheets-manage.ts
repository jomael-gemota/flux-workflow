import type { Skill } from '../types';

export const skill: Skill = {
    name: 'gsheets-manage',
    title: 'Google Sheets — Manage (Write, Update, Create, Delete)',
    summary: 'Write, update, clear, create, or delete Google Sheets and tabs.',
    whenToUse:
        'Use when the user wants to write data to specific cells, update existing rows, ' +
        'clear a sheet, create a new spreadsheet, or delete rows/columns. ' +
        'For simply appending rows, use gsheets-append-row.',
    keywords: [
        'sheets', 'spreadsheet', 'google', 'write', 'update', 'create', 'delete',
        'clear', 'insert', 'row', 'column', 'format',
    ],
    category: 'integration',
    nodeType: 'gsheets',
    requiresCredential: 'google',
    body: `
# Google Sheets — Manage

Full suite of write, update, and management actions for Google Sheets.

## Required config (all actions)
- \`credentialId\` (string): Connected Google credential id.
  Call \`list_credentials({ provider: "google" })\` to find it.
- \`action\` (string): One of the actions below.

---

## Action: \`"write"\`
Write/overwrite data to a range.
- \`spreadsheetId\`, \`range\` (string): Target range.
- \`values\` (array): 2-D array of cell values.
- \`valueInputOption\` (\`"RAW" | "USER_ENTERED"\`): Default \`"USER_ENTERED"\`.

## Action: \`"update_row"\`
Update a specific row by matching a value in a key column.
- \`spreadsheetId\`, \`sheetName\` (string).
- \`values\` (object): \`{ columnName: value }\` map of fields to update.
- \`columnKeys\` (string): Comma-separated column names that define the row key.

## Action: \`"clear_sheet"\`
Clear all data from a sheet tab (keeps the tab itself).
- \`spreadsheetId\`, \`sheetName\` or \`range\` (string).

## Action: \`"create_spreadsheet"\`
Create a new Google Sheets spreadsheet.
- \`title\` (string): Name of the new spreadsheet.
- \`folderId\` (string, optional): Google Drive folder id to save in.
  Call \`list_gdrive_items\` and present folders via \`ask_user\`.

## Action: \`"delete_spreadsheet"\`
Delete (trash) a spreadsheet.
- \`spreadsheetId\` (string).
- \`permanent\` (boolean): Default \`false\` (moves to trash).

## Action: \`"create_sheet"\` / \`"delete_sheet"\`
Add or remove a tab within a spreadsheet.
- \`spreadsheetId\` (string).
- \`sheetName\` (string): Tab to delete.
- \`newSheetTitle\` (string): New tab name (for create).

## Action: \`"insert_rows"\` / \`"insert_columns"\`
Insert blank rows or columns at a position.
- \`spreadsheetId\`, \`sheetName\` (string).
- \`range\` (string): Where to insert.

## Action: \`"delete_rows_columns"\`
Delete rows or columns by index.
- \`spreadsheetId\`, \`sheetName\` (string), \`range\` (string).

## Fluxelle workflow
1. Call \`list_credentials({ provider: "google" })\` → resolve \`credentialId\`.
2. Use \`ask_user\` to clarify what action the user wants if not obvious.
3. Call \`list_gsheets\` and present via \`ask_user\` to pick the spreadsheet.
4. Call \`list_gsheet_tabs\` and present tab names via \`ask_user\`.
5. Propose the node with all fields populated.

## Example — overwrite data in a range
\`\`\`json
{
  "id": "gsheets-write-1",
  "type": "gsheets",
  "name": "Write Report Data",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "write",
    "spreadsheetId": "<resolved-from-list_gsheets>",
    "range": "Report!A2:C10",
    "values": [
      ["{{ nodes.transform-1.date }}", "{{ nodes.transform-1.total }}", "{{ nodes.transform-1.status }}"]
    ],
    "valueInputOption": "USER_ENTERED"
  },
  "next": []
}
\`\`\`
`,
};
