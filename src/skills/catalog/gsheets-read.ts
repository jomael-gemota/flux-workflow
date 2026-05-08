import type { Skill } from '../types';

export const skill: Skill = {
    name: 'gsheets-read',
    title: 'Google Sheets — Read Data',
    summary: 'Read rows from a Google Sheet with optional column filtering.',
    whenToUse:
        'Use when the user wants to read data from a spreadsheet — "get all rows", ' +
        '"read the Names column", "fetch rows from Sheet2". For writing or appending, ' +
        'use the gsheets-append-row or gsheets-write skills.',
    keywords: ['sheets', 'spreadsheet', 'google', 'read', 'get', 'fetch', 'rows', 'data'],
    category: 'integration',
    nodeType: 'gsheets',
    requiresCredential: 'google',
    body: `
# Google Sheets — Read Data

Reads rows from a Google Sheet range and returns them as structured objects.

## Required config
- \`credentialId\` (string): Connected Google credential id.
  Call \`list_credentials({ provider: "google" })\` to find it.
- \`action\` (string): \`"read"\` or \`"get_rows"\` (both work identically).
- \`spreadsheetId\` (string): The spreadsheet id (from the URL).
  Call \`list_gsheets\` and present via \`ask_user\` — never leave blank.
- \`range\` (string): A1-notation range — e.g. \`"Sheet1!A:Z"\` or \`"Data!A1:E100"\`.
  Call \`list_gsheet_tabs\` and present tab names via \`ask_user\`.

## Optional config
- \`hasHeaders\` (boolean): Default \`true\`. When true, returns rows as key-value objects
  using the first row as column headers.
- \`selectColumns\` (string): Comma-separated column header names to include.
  Leave blank to return all columns.
- \`sheetName\` (string): Alternate way to specify the tab name (without A1 range).

## Output fields
- \`rows\`: Array of objects (when \`hasHeaders: true\`) or 2-D array
- \`count\`: Number of data rows
- \`columns\`: Array of column header names (when \`hasHeaders: true\`)

## Fluxelle workflow
1. Call \`list_credentials({ provider: "google" })\` → resolve \`credentialId\`.
2. Call \`list_gsheets\` → present via \`ask_user\` to pick the spreadsheet.
3. Call \`list_gsheet_tabs\` → present tab names via \`ask_user\`.
4. Ask if they want specific columns (suggest all if they're unsure).

## Example — read all rows from "Contacts" sheet
\`\`\`json
{
  "id": "gsheets-read-1",
  "type": "gsheets",
  "name": "Read Contacts Sheet",
  "config": {
    "credentialId": "<resolved-from-list_credentials>",
    "action": "get_rows",
    "spreadsheetId": "<resolved-from-list_gsheets>",
    "range": "Contacts!A:Z",
    "hasHeaders": true
  },
  "next": []
}
\`\`\`

Downstream: reference rows as \`{{ nodes.gsheets-read-1.rows }}\`.
`,
};
