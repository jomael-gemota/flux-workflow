import { google } from 'googleapis';
import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { GoogleAuthService } from '../services/GoogleAuthService';
import { ExpressionResolver } from '../engine/ExpressionResolver';

type GSheetsAction =
    // ── read & write ────────────────────────────────────────────────────────
    | 'read' | 'write' | 'append'
    // ── document-level ──────────────────────────────────────────────────────
    | 'create_spreadsheet' | 'delete_spreadsheet'
    // ── sheet-tab level ──────────────────────────────────────────────────────
    | 'get_rows' | 'append_row' | 'append_update_row'
    | 'append_to_row' | 'append_to_column'
    | 'update_row' | 'clear_sheet' | 'clear_data'
    | 'create_sheet' | 'delete_sheet'
    | 'delete_rows_columns'
    | 'insert_rows' | 'insert_columns'
    | 'format_cells';

interface GSheetsConfig {
    credentialId: string;
    action: GSheetsAction;

    // ── spreadsheet identification ────────────────────────────────────────────
    spreadsheetId?: string;
    searchFolderId?: string;
    spreadsheetName?: string;
    owner?: string;

    // ── common values & range fields ──────────────────────────────────────────
    range?: string;
    values?: unknown;
    valueInputOption?: 'RAW' | 'USER_ENTERED';
    /** Comma-separated object property names for object→row mapping. */
    columnKeys?: string;

    // ── create_spreadsheet ───────────────────────────────────────────────────
    title?: string;
    folderId?: string;

    // ── delete_spreadsheet ───────────────────────────────────────────────────
    permanent?: boolean;

    // ── sheet-level target ────────────────────────────────────────────────────
    sheetName?: string;
    newSheetTitle?: string;

    // ── clear_data ────────────────────────────────────────────────────────────
    /** What to clear: a single cell, an A1 range, or the whole sheet tab. */
    clearMode?: 'cell' | 'range' | 'sheet';

    // ── read / get_rows ───────────────────────────────────────────────────────
    /**
     * When true (default) the first row is treated as column headers and data
     * is returned as an array of objects.  When false, the raw 2-D array is
     * returned without any header mapping.
     */
    hasHeaders?: boolean;
    /**
     * Comma-separated list of column header names to include in the output.
     * Only meaningful when hasHeaders=true.  Leave blank to return all columns.
     */
    selectColumns?: string;

    // ── append_update_row (upsert) ────────────────────────────────────────────
    keyColumn?: string;
    keyValue?: string;

    // ── append_to_row ─────────────────────────────────────────────────────────
    /** 1-based row number.  Accepts a literal number or an expression string. */
    rowNumber?: number | string;

    // ── append_to_column ─────────────────────────────────────────────────────
    /** Column letter (A, B, AA …).  New data is written below the last non-empty cell. */
    columnLetter?: string;

    // ── delete_rows_columns ───────────────────────────────────────────────────
    deleteType?: 'rows' | 'columns';
    startIndex?: number;
    endIndex?: number;

    // ── insert_rows / insert_columns ──────────────────────────────────────────
    /** How many rows or columns to insert.  Accepts a literal number or an expression string. */
    insertCount?: number | string;
    /** 0-based index where the new rows/columns are inserted BEFORE.  Accepts a literal number or an expression string. */
    insertStartIndex?: number | string;
    /** Copy formatting from the row/column immediately before the insertion point. */
    inheritFromBefore?: boolean;

    // ── get_rows ──────────────────────────────────────────────────────────────
    filterColumn?: string;
    filterValue?: string;
    maxResults?: number;

    // ── format_cells ─────────────────────────────────────────────────────────
    /**
     * Target range in A1 notation (e.g. "A1:D5", "A:D", "1:3").
     * When supplied, formatRowStart/End and formatColumnStart/End are ignored.
     */
    formatRange?: string;
    /** 1-based start row (inclusive). Accepts a literal number or an expression string. */
    formatRowStart?: number | string;
    /** 1-based end row (inclusive). Accepts a literal number or an expression string. */
    formatRowEnd?: number | string;
    /** Start column letter (A, B …). Accepts a literal letter or an expression string. */
    formatColumnStart?: string;
    /** End column letter (inclusive). Accepts a literal letter or an expression string. */
    formatColumnEnd?: string;
    // Text
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    /** Font size in points. Accepts a literal number or an expression string. */
    fontSize?: number | string;
    /** Hex colour #RRGGBB for the font. Accepts a literal hex or an expression string. */
    fontColor?: string;
    /** Hex colour #RRGGBB for the cell background. Accepts a literal hex or an expression string. */
    backgroundColor?: string;
    // Number format
    numberFormat?: 'NUMBER' | 'TEXT' | 'DATE' | 'DATE_TIME' | 'TIME'
        | 'CURRENCY' | 'PERCENT' | 'SCIENTIFIC' | 'FRACTION' | 'CUSTOM';
    /** Custom number-format pattern (e.g. "#,##0.00" or "yyyy-MM-dd"). */
    numberFormatPattern?: string;
    // Layout
    horizontalAlignment?: 'LEFT' | 'CENTER' | 'RIGHT';
    verticalAlignment?: 'TOP' | 'MIDDLE' | 'BOTTOM';
    wrapStrategy?: 'OVERFLOW_CELL' | 'CLIP' | 'WRAP';
}

// ── module-level helpers ──────────────────────────────────────────────────────

const driveEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** 0-based column index → letter(s). (0→A, 25→Z, 26→AA …) */
function colIdxToLetter(idx: number): string {
    let result = '';
    let n = idx + 1;
    while (n > 0) {
        const rem = (n - 1) % 26;
        result = String.fromCharCode(65 + rem) + result;
        n = Math.floor((n - 1) / 26);
    }
    return result;
}

/** Column letter(s) → 0-based index. (A→0, Z→25, AA→26 …) */
function letterToColIdx(letter: string): number {
    let result = 0;
    for (const ch of letter.toUpperCase()) {
        result = result * 26 + (ch.charCodeAt(0) - 64);
    }
    return result - 1;
}

/**
 * Parse an A1-notation range (with optional sheet name) to a 0-based grid
 * range where endRow/endCol are exclusive, matching the Sheets API convention.
 */
function parseA1Range(a1: string): {
    startRow: number; endRow: number;
    startCol: number; endCol: number;
} {
    const MAX = 10_000_000;
    const raw = a1.includes('!') ? a1.split('!')[1] : a1;
    const [startRef, endRef] = raw.split(':');

    function parseRef(ref: string): { row?: number; col?: number } {
        const m = ref?.match(/^([A-Za-z]*)(\d*)$/);
        if (!m) return {};
        return {
            col: m[1] ? letterToColIdx(m[1]) : undefined,
            row: m[2] ? parseInt(m[2], 10) - 1 : undefined,
        };
    }

    const s = parseRef(startRef ?? '');
    const e = endRef ? parseRef(endRef) : s;

    return {
        startRow: s.row ?? 0,
        endRow:   e.row != null ? e.row + 1 : MAX,
        startCol: s.col ?? 0,
        endCol:   e.col != null ? e.col + 1 : MAX,
    };
}

/** Hex colour string (#RRGGBB or #RGB) → Sheets API colour object (0–1 range). */
function hexToSheetsColor(hex: string): { red: number; green: number; blue: number } {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return {
        red:   parseInt(h.slice(0, 2), 16) / 255,
        green: parseInt(h.slice(2, 4), 16) / 255,
        blue:  parseInt(h.slice(4, 6), 16) / 255,
    };
}

// ── Node class ────────────────────────────────────────────────────────────────

export class GSheetsNode implements NodeExecutor {
    private googleAuth: GoogleAuthService;
    private resolver = new ExpressionResolver();

    constructor(googleAuth: GoogleAuthService) {
        this.googleAuth = googleAuth;
    }

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as GSheetsConfig;
        const { credentialId, action } = config;

        if (!credentialId) throw new Error('Google Sheets node: credentialId is required');
        if (!action)       throw new Error('Google Sheets node: action is required');

        const auth   = await this.googleAuth.getAuthenticatedClient(credentialId);
        const sheets = google.sheets({ version: 'v4', auth });
        const drive  = google.drive({ version: 'v3', auth });

        // ── create_spreadsheet ───────────────────────────────────────────────

        if (action === 'create_spreadsheet') {
            const title    = this.resolver.resolveTemplate(config.title ?? 'Untitled Spreadsheet', context);
            const folderId = config.folderId
                ? this.resolver.resolveTemplate(config.folderId, context).trim()
                : undefined;

            const requestBody: { name: string; mimeType: string; parents?: string[] } = {
                name:     title,
                mimeType: 'application/vnd.google-apps.spreadsheet',
            };
            if (folderId) requestBody.parents = [folderId];

            const res = await drive.files.create({ requestBody, fields: 'id,name,webViewLink' });
            return {
                spreadsheetId: res.data.id,
                title:         res.data.name,
                url:           `https://docs.google.com/spreadsheets/d/${res.data.id}/edit`,
                webViewLink:   res.data.webViewLink,
            };
        }

        const spreadsheetId = await this.resolveSpreadsheetId(config, context, drive);

        // ── delete_spreadsheet ───────────────────────────────────────────────

        if (action === 'delete_spreadsheet') {
            if (config.permanent) {
                await drive.files.delete({ fileId: spreadsheetId, supportsAllDrives: true });
                return { deleted: true, permanent: true, spreadsheetId };
            }
            const res = await drive.files.update({
                fileId: spreadsheetId, requestBody: { trashed: true },
                fields: 'id,name,trashed', supportsAllDrives: true,
            });
            return { deleted: true, permanent: false, movedToTrash: true, spreadsheetId: res.data.id, name: res.data.name };
        }

        // ── read ─────────────────────────────────────────────────────────────

        if (action === 'read') {
            const range = this.resolver.resolveTemplate(config.range ?? '', context);
            if (!range) throw new Error('Google Sheets read: range is required');

            const res  = await sheets.spreadsheets.values.get({ spreadsheetId, range });
            const rows = res.data.values ?? [];

            // raw mode — skip header mapping
            if (config.hasHeaders === false) {
                return { rows, total: rows.length, range: res.data.range };
            }

            if (rows.length < 1) return { rows: [], headers: [], data: [], range: res.data.range };
            if (rows.length < 2) return { rows, headers: rows[0] ?? [], data: [], range: res.data.range };

            const [rawHeaders, ...dataRows] = rows;
            const headers = rawHeaders as string[];
            const wantCols = this.parseSelectColumns(config.selectColumns);

            const data = dataRows.map((row) => {
                const obj: Record<string, unknown> = {};
                headers.forEach((h, i) => {
                    const key = h?.trim();
                    if (!wantCols || wantCols.has(key)) obj[key] = row[i] ?? null;
                });
                return obj;
            });

            return { rows, headers, data, total: data.length, range: res.data.range };
        }

        // ── write ─────────────────────────────────────────────────────────────

        if (action === 'write') {
            const range = this.resolver.resolveTemplate(config.range ?? '', context);
            if (!range) throw new Error('Google Sheets write: range is required');

            const columnKeys = this.parseColumnKeys(config.columnKeys);
            const values     = this.resolveValues(config.values, context, columnKeys);
            const res = await this.writeGridValues(sheets, {
                spreadsheetId, range, grid: values,
                valueInputOption: config.valueInputOption ?? 'USER_ENTERED',
                mode: 'update',
            });
            return {
                updatedRange:   res.updatedRange,
                updatedRows:    res.updatedRows,
                updatedColumns: res.updatedColumns,
                updatedCells:   res.updatedCells,
            };
        }

        // ── append (bulk) ─────────────────────────────────────────────────────

        if (action === 'append') {
            const range      = this.resolver.resolveTemplate(config.range ?? 'Sheet1', context);
            const columnKeys = this.parseColumnKeys(config.columnKeys);
            const values     = this.resolveValues(config.values, context, columnKeys);
            const res = await this.writeGridValues(sheets, {
                spreadsheetId, range, grid: values,
                valueInputOption: config.valueInputOption ?? 'USER_ENTERED',
                mode: 'append',
            });
            return {
                spreadsheetId,
                tableRange:    res.tableRange,
                updatedRange:  res.updatedRange,
                updatedRows:   res.updatedRows,
                updatedCells:  res.updatedCells,
            };
        }

        // ── create_sheet ──────────────────────────────────────────────────────

        if (action === 'create_sheet') {
            const newTitle = this.resolver.resolveTemplate(config.newSheetTitle ?? 'Sheet', context);
            const res = await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests: [{ addSheet: { properties: { title: newTitle } } }] },
            });
            const added = res.data.replies?.[0]?.addSheet?.properties;
            return { spreadsheetId, sheetId: added?.sheetId, title: added?.title };
        }

        // ── delete_sheet ──────────────────────────────────────────────────────

        if (action === 'delete_sheet') {
            const sheetName = this.resolver.resolveTemplate(config.sheetName ?? '', context);
            if (!sheetName) throw new Error('Google Sheets delete_sheet: sheetName is required');
            const sheetId = await this.getSheetId(sheets, spreadsheetId, sheetName);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests: [{ deleteSheet: { sheetId } }] },
            });
            return { spreadsheetId, deleted: true, sheetTitle: sheetName };
        }

        // ── clear_sheet ───────────────────────────────────────────────────────

        if (action === 'clear_sheet') {
            const sheetName = this.resolver.resolveTemplate(config.sheetName ?? '', context);
            const range     = this.resolver.resolveTemplate(config.range ?? '', context);
            const target    = range || sheetName || 'Sheet1';
            const res = await sheets.spreadsheets.values.clear({ spreadsheetId, range: target });
            return { spreadsheetId, clearedRange: res.data.clearedRange };
        }

        // ── clear_data (single cell / range / whole sheet) ────────────────────

        if (action === 'clear_data') {
            const mode      = config.clearMode ?? 'range';
            const sheetName = this.resolver.resolveTemplate(config.sheetName ?? '', context).trim();
            const range     = this.resolver.resolveTemplate(config.range ?? '', context).trim();

            let target: string;
            if (mode === 'sheet') {
                target = sheetName || 'Sheet1';
            } else {
                target = range || sheetName;
                if (!target) {
                    throw new Error(
                        `Google Sheets clear_data: a ${mode === 'cell' ? 'cell reference' : 'range'} is required`,
                    );
                }
            }

            const res = await sheets.spreadsheets.values.clear({ spreadsheetId, range: target });
            return { spreadsheetId, clearMode: mode, clearedRange: res.data.clearedRange };
        }

        // ── get_rows ──────────────────────────────────────────────────────────

        if (action === 'get_rows') {
            const sheetName = this.resolver.resolveTemplate(config.sheetName ?? 'Sheet1', context);
            const range     = config.range
                ? this.resolver.resolveTemplate(config.range, context)
                : sheetName;
            const filterCol = config.filterColumn
                ? this.resolver.resolveTemplate(config.filterColumn, context).trim()
                : '';
            const filterVal = config.filterValue
                ? this.resolver.resolveTemplate(config.filterValue, context).trim()
                : '';

            const res  = await sheets.spreadsheets.values.get({ spreadsheetId, range });
            const rows = res.data.values ?? [];
            const max  = config.maxResults ?? 0;

            if (config.hasHeaders === false) {
                const data = max > 0 ? rows.slice(0, max) : rows;
                return { rows: data, total: data.length };
            }

            if (rows.length < 2) return { rows, headers: rows[0] ?? [], data: [], total: 0 };

            const [rawHeaders, ...dataRows] = rows;
            const headers   = rawHeaders as string[];
            const wantCols  = this.parseSelectColumns(config.selectColumns);

            let data = dataRows.map((row) => {
                const obj: Record<string, unknown> = {};
                headers.forEach((h, i) => {
                    const key = h?.trim();
                    if (!wantCols || wantCols.has(key)) obj[key] = row[i] ?? null;
                });
                return obj;
            });

            if (filterCol && filterVal) {
                data = data.filter(
                    (obj) => String(obj[filterCol] ?? '').toLowerCase().includes(filterVal.toLowerCase()),
                );
            }
            if (max > 0) data = data.slice(0, max);

            return { data, total: data.length, headers: wantCols ? headers.filter((h) => wantCols.has(h)) : headers };
        }

        // ── append_row ────────────────────────────────────────────────────────

        if (action === 'append_row') {
            const sheetName  = this.resolver.resolveTemplate(config.sheetName ?? 'Sheet1', context);
            const columnKeys = this.parseColumnKeys(config.columnKeys);
            const grid       = this.resolveValues(config.values, context, columnKeys);
            const res = await this.writeGridValues(sheets, {
                spreadsheetId, range: sheetName, grid,
                valueInputOption: config.valueInputOption ?? 'USER_ENTERED',
                mode: 'append',
            });
            return {
                spreadsheetId,
                appendedRows:  grid.length,
                tableRange:    res.tableRange,
                updatedRange:  res.updatedRange,
                updatedRows:   res.updatedRows,
            };
        }

        // ── append_update_row (upsert) ─────────────────────────────────────────

        if (action === 'append_update_row') {
            const sheetName  = this.resolver.resolveTemplate(config.sheetName ?? 'Sheet1', context);
            const keyColumn  = this.resolver.resolveTemplate(config.keyColumn ?? '', context).trim();
            const keyValue   = this.resolver.resolveTemplate(config.keyValue  ?? '', context).trim();
            const columnKeys = this.parseColumnKeys(config.columnKeys);

            const grid    = this.resolveValues(config.values, context, columnKeys);
            const flatRow = grid[0] ?? [];

            const readRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
            const rows    = readRes.data.values ?? [];
            const headers = rows[0] as string[] | undefined;

            let keyColIdx = -1;
            if (keyColumn && headers) {
                keyColIdx = headers.findIndex((h) => h?.toString().toLowerCase() === keyColumn.toLowerCase());
                if (keyColIdx < 0 && /^[A-Za-z]{1,3}$/.test(keyColumn)) {
                    keyColIdx = letterToColIdx(keyColumn);
                }
            }

            if (keyColumn && keyValue && keyColIdx >= 0) {
                const matchIdx = rows.findIndex((r, i) => i > 0 && r[keyColIdx]?.toString() === keyValue);
                if (matchIdx > 0) {
                    const updateRange = `${sheetName}!A${matchIdx + 1}`;
                    const res = await this.writeGridValues(sheets, {
                        spreadsheetId, range: updateRange, grid: [flatRow],
                        valueInputOption: config.valueInputOption ?? 'USER_ENTERED',
                        mode: 'update',
                    });
                    return { action: 'updated', spreadsheetId, rowIndex: matchIdx, updatedRange: res.updatedRange };
                }
            }

            const res = await this.writeGridValues(sheets, {
                spreadsheetId, range: sheetName, grid: [flatRow],
                valueInputOption: config.valueInputOption ?? 'USER_ENTERED',
                mode: 'append',
            });
            return { action: 'appended', spreadsheetId, updatedRange: res.updatedRange };
        }

        // ── update_row ────────────────────────────────────────────────────────

        if (action === 'update_row') {
            const range = this.resolver.resolveTemplate(config.range ?? '', context);
            if (!range) throw new Error('Google Sheets update_row: range (e.g. Sheet1!A2) is required');

            const columnKeys = this.parseColumnKeys(config.columnKeys);
            const values     = this.resolveValues(config.values, context, columnKeys);
            const res = await this.writeGridValues(sheets, {
                spreadsheetId, range, grid: values,
                valueInputOption: config.valueInputOption ?? 'USER_ENTERED',
                mode: 'update',
            });
            return {
                spreadsheetId,
                updatedRange:   res.updatedRange,
                updatedRows:    res.updatedRows,
                updatedColumns: res.updatedColumns,
                updatedCells:   res.updatedCells,
            };
        }

        // ── append_to_row (horizontal append) ─────────────────────────────────

        if (action === 'append_to_row') {
            const sheetName  = this.resolver.resolveTemplate(config.sheetName ?? 'Sheet1', context);
            const rowNumber  = Number(this.resolver.resolveTemplate(String(config.rowNumber ?? 1), context));
            const columnKeys = this.parseColumnKeys(config.columnKeys);
            const grid       = this.resolveValues(config.values, context, columnKeys);
            const newCells   = grid[0] ?? [];   // horizontal → we use the first row of the grid

            // Read the target row to find the last non-empty column
            const rowRange = `${sheetName}!${rowNumber}:${rowNumber}`;
            const readRes  = await sheets.spreadsheets.values.get({ spreadsheetId, range: rowRange });
            const existing = readRes.data.values?.[0] ?? [];

            // Trim trailing blanks to find true last used column
            let lastColIdx = existing.length - 1;
            while (lastColIdx >= 0 && (existing[lastColIdx] == null || existing[lastColIdx] === '')) {
                lastColIdx--;
            }
            const startColIdx    = lastColIdx + 1;
            const startColLetter = colIdxToLetter(startColIdx);
            const writeRange     = `${sheetName}!${startColLetter}${rowNumber}`;

            await this.writeGridValues(sheets, {
                spreadsheetId, range: writeRange, grid: [newCells],
                valueInputOption: config.valueInputOption ?? 'USER_ENTERED',
                mode: 'update',
            });

            return {
                spreadsheetId,
                sheetName,
                rowNumber,
                startColumn:    startColLetter,
                appendedCells:  newCells.length,
                writeRange,
            };
        }

        // ── append_to_column (vertical append) ────────────────────────────────

        if (action === 'append_to_column') {
            const sheetName    = this.resolver.resolveTemplate(config.sheetName ?? 'Sheet1', context);
            const columnLetter = (this.resolver.resolveTemplate(config.columnLetter ?? 'A', context) || 'A').toUpperCase();
            const columnKeys   = this.parseColumnKeys(config.columnKeys);
            const grid         = this.resolveValues(config.values, context, columnKeys);

            // Each row of the grid provides the value for the column; extract first cell
            const newCells: unknown[][] = grid.map((row) => [row[0] ?? '']);

            // Read the entire column to find the last non-empty row
            const colRange = `${sheetName}!${columnLetter}:${columnLetter}`;
            const readRes  = await sheets.spreadsheets.values.get({ spreadsheetId, range: colRange });
            const existing = readRes.data.values ?? [];

            let lastRowIdx = existing.length - 1;
            while (lastRowIdx >= 0 && (existing[lastRowIdx]?.[0] == null || existing[lastRowIdx]?.[0] === '')) {
                lastRowIdx--;
            }
            const startRowNumber = lastRowIdx + 2; // 1-based
            const writeRange     = `${sheetName}!${columnLetter}${startRowNumber}`;

            await this.writeGridValues(sheets, {
                spreadsheetId, range: writeRange, grid: newCells,
                valueInputOption: config.valueInputOption ?? 'USER_ENTERED',
                mode: 'update',
            });

            return {
                spreadsheetId,
                sheetName,
                column:       columnLetter,
                startRow:     startRowNumber,
                appendedRows: newCells.length,
                writeRange,
            };
        }

        // ── insert_rows ───────────────────────────────────────────────────────

        if (action === 'insert_rows') {
            const sheetName   = this.resolver.resolveTemplate(config.sheetName ?? '', context);
            if (!sheetName) throw new Error('Google Sheets insert_rows: sheetName is required');

            const insertCount      = Number(this.resolver.resolveTemplate(String(config.insertCount  ?? 1), context));
            const insertStartIndex = Number(this.resolver.resolveTemplate(String(config.insertStartIndex ?? 0), context));
            const inheritBefore    = config.inheritFromBefore ?? false;

            const sheetId = await this.getSheetId(sheets, spreadsheetId, sheetName);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        insertDimension: {
                            range: {
                                sheetId,
                                dimension:  'ROWS',
                                startIndex: insertStartIndex,
                                endIndex:   insertStartIndex + insertCount,
                            },
                            inheritFromBefore: inheritBefore,
                        },
                    }],
                },
            });
            return { spreadsheetId, sheetName, insertedRows: insertCount, startIndex: insertStartIndex };
        }

        // ── insert_columns ────────────────────────────────────────────────────

        if (action === 'insert_columns') {
            const sheetName   = this.resolver.resolveTemplate(config.sheetName ?? '', context);
            if (!sheetName) throw new Error('Google Sheets insert_columns: sheetName is required');

            const insertCount = Number(this.resolver.resolveTemplate(String(config.insertCount ?? 1), context));
            // Accept either a 0-based index or a column letter (or an expression resolving to either)
            const rawColStart = this.resolver.resolveTemplate(
                String(config.columnLetter || (config.insertStartIndex ?? 0)),
                context,
            ).trim();
            let insertStartIndex = /^[A-Za-z]+$/.test(rawColStart)
                ? letterToColIdx(rawColStart.toUpperCase())
                : Number(rawColStart) || 0;
            const inheritBefore = config.inheritFromBefore ?? false;

            const sheetId = await this.getSheetId(sheets, spreadsheetId, sheetName);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        insertDimension: {
                            range: {
                                sheetId,
                                dimension:  'COLUMNS',
                                startIndex: insertStartIndex,
                                endIndex:   insertStartIndex + insertCount,
                            },
                            inheritFromBefore: inheritBefore,
                        },
                    }],
                },
            });
            return {
                spreadsheetId,
                sheetName,
                insertedColumns: insertCount,
                startIndex:      insertStartIndex,
                startColumn:     colIdxToLetter(insertStartIndex),
            };
        }

        // ── delete_rows_columns ───────────────────────────────────────────────

        if (action === 'delete_rows_columns') {
            const sheetName  = this.resolver.resolveTemplate(config.sheetName ?? '', context);
            if (!sheetName) throw new Error('Google Sheets delete_rows_columns: sheetName is required');

            const deleteType = config.deleteType ?? 'rows';
            const startIndex = config.startIndex ?? 0;
            const endIndex   = config.endIndex   ?? startIndex + 1;

            const sheetId = await this.getSheetId(sheets, spreadsheetId, sheetName);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        deleteDimension: {
                            range: {
                                sheetId,
                                dimension:  deleteType === 'rows' ? 'ROWS' : 'COLUMNS',
                                startIndex,
                                endIndex,
                            },
                        },
                    }],
                },
            });
            return { spreadsheetId, sheetName, deleted: true, deleteType, startIndex, endIndex };
        }

        // ── format_cells ──────────────────────────────────────────────────────

        if (action === 'format_cells') {
            const sheetName = this.resolver.resolveTemplate(config.sheetName ?? '', context);
            if (!sheetName) throw new Error('Google Sheets format_cells: sheetName is required');

            const sheetId = await this.getSheetId(sheets, spreadsheetId, sheetName);

            // Determine the grid range to format
            let startRowIndex: number;
            let endRowIndex:   number;
            let startColIndex: number;
            let endColIndex:   number;

            if (config.formatRange) {
                const p = parseA1Range(this.resolver.resolveTemplate(config.formatRange, context));
                startRowIndex = p.startRow;
                endRowIndex   = p.endRow;
                startColIndex = p.startCol;
                endColIndex   = p.endCol;
            } else {
                const rowStartRaw = config.formatRowStart != null
                    ? this.resolver.resolveTemplate(String(config.formatRowStart), context) : null;
                const rowEndRaw = config.formatRowEnd != null
                    ? this.resolver.resolveTemplate(String(config.formatRowEnd), context) : null;
                const colStartRaw = config.formatColumnStart
                    ? this.resolver.resolveTemplate(config.formatColumnStart, context).trim().toUpperCase() : '';
                const colEndRaw = config.formatColumnEnd
                    ? this.resolver.resolveTemplate(config.formatColumnEnd, context).trim().toUpperCase() : '';

                startRowIndex = rowStartRaw != null ? Number(rowStartRaw) - 1 : 0;
                endRowIndex   = rowEndRaw   != null ? Number(rowEndRaw)       : startRowIndex + 1;
                startColIndex = colStartRaw ? letterToColIdx(colStartRaw) : 0;
                endColIndex   = colEndRaw   ? letterToColIdx(colEndRaw) + 1 : startColIndex + 1;
            }

            // Resolve dynamic style values
            const resolvedFontSize      = config.fontSize != null
                ? Number(this.resolver.resolveTemplate(String(config.fontSize), context)) || undefined
                : undefined;
            const resolvedFontColor     = config.fontColor
                ? this.resolver.resolveTemplate(config.fontColor, context).trim() : '';
            const resolvedBgColor       = config.backgroundColor
                ? this.resolver.resolveTemplate(config.backgroundColor, context).trim() : '';

            // Build userEnteredFormat and fields mask
            const fmt: Record<string, unknown> = {};
            const fieldParts: string[] = [];

            // ── text format ──────────────────────────────────────────────────
            const hasTF = config.bold != null || config.italic != null
                || config.underline != null || config.strikethrough != null
                || resolvedFontSize  != null || resolvedFontColor;
            if (hasTF) {
                const tf: Record<string, unknown> = {};
                if (config.bold          != null) tf.bold          = config.bold;
                if (config.italic        != null) tf.italic        = config.italic;
                if (config.underline     != null) tf.underline     = config.underline;
                if (config.strikethrough != null) tf.strikethrough = config.strikethrough;
                if (resolvedFontSize     != null) tf.fontSize      = resolvedFontSize;
                if (resolvedFontColor)            tf.foregroundColor = hexToSheetsColor(resolvedFontColor);
                fmt.textFormat = tf;
                fieldParts.push('userEnteredFormat.textFormat');
            }

            // ── background color ─────────────────────────────────────────────
            if (resolvedBgColor) {
                fmt.backgroundColor = hexToSheetsColor(resolvedBgColor);
                fieldParts.push('userEnteredFormat.backgroundColor');
            }

            // ── number format ────────────────────────────────────────────────
            if (config.numberFormat) {
                const nfType = config.numberFormat === 'CUSTOM' ? 'TEXT' : config.numberFormat;
                fmt.numberFormat = {
                    type:    nfType,
                    pattern: config.numberFormatPattern ?? '',
                };
                fieldParts.push('userEnteredFormat.numberFormat');
            }

            // ── layout ───────────────────────────────────────────────────────
            if (config.horizontalAlignment) {
                fmt.horizontalAlignment = config.horizontalAlignment;
                fieldParts.push('userEnteredFormat.horizontalAlignment');
            }
            if (config.verticalAlignment) {
                fmt.verticalAlignment = config.verticalAlignment;
                fieldParts.push('userEnteredFormat.verticalAlignment');
            }
            if (config.wrapStrategy) {
                fmt.wrapStrategy = config.wrapStrategy;
                fieldParts.push('userEnteredFormat.wrapStrategy');
            }

            if (fieldParts.length === 0) {
                throw new Error('Google Sheets format_cells: at least one formatting option must be specified');
            }

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        repeatCell: {
                            range: {
                                sheetId,
                                startRowIndex,
                                endRowIndex,
                                startColumnIndex: startColIndex,
                                endColumnIndex:   endColIndex,
                            },
                            cell:   { userEnteredFormat: fmt },
                            fields: fieldParts.join(','),
                        },
                    }],
                },
            });

            return {
                spreadsheetId,
                sheetName,
                formatted:    true,
                range:        config.formatRange ?? `R${startRowIndex + 1}C${startColIndex + 1}:R${endRowIndex}C${endColIndex}`,
                fieldsApplied: fieldParts,
            };
        }

        throw new Error(`Google Sheets node: unknown action "${action}"`);
    }

    // ── private helpers ───────────────────────────────────────────────────────

    private async resolveSpreadsheetId(
        config: GSheetsConfig,
        context: ExecutionContext,
        drive: ReturnType<typeof google.drive>,
    ): Promise<string> {
        const directId = config.spreadsheetId
            ? this.resolver.resolveTemplate(config.spreadsheetId, context).trim()
            : '';
        if (directId) return directId;

        const qParts = [
            `mimeType = 'application/vnd.google-apps.spreadsheet'`,
            `trashed = false`,
        ];

        const folderIdVal = config.searchFolderId
            ? this.resolver.resolveTemplate(config.searchFolderId, context).trim() : '';
        if (folderIdVal) qParts.push(`'${driveEscape(folderIdVal)}' in parents`);

        const nameVal = config.spreadsheetName
            ? this.resolver.resolveTemplate(config.spreadsheetName, context).trim() : '';
        if (nameVal) qParts.push(`name contains '${driveEscape(nameVal)}'`);

        const ownerVal = config.owner
            ? this.resolver.resolveTemplate(config.owner, context).trim() : '';
        if (ownerVal) qParts.push(`'${driveEscape(ownerVal)}' in owners`);

        const res  = await drive.files.list({ q: qParts.join(' and '), pageSize: 1, fields: 'files(id,name)', orderBy: 'modifiedTime desc' });
        const file = res.data.files?.[0];
        if (!file?.id) throw new Error('Google Sheets: no spreadsheet found matching the search criteria. Provide spreadsheetId, spreadsheetName, or owner.');
        return file.id;
    }

    private async getSheetId(
        sheets: ReturnType<typeof google.sheets>,
        spreadsheetId: string,
        sheetName: string,
    ): Promise<number> {
        const res   = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
        const sheet = res.data.sheets?.find((s) => s.properties?.title === sheetName);
        if (!sheet || sheet.properties?.sheetId == null) {
            throw new Error(`Google Sheets: sheet tab "${sheetName}" was not found in the spreadsheet`);
        }
        return sheet.properties.sheetId;
    }

    /** Parses "name,email,status" → Set{"name","email","status"}, or undefined for "all". */
    private parseSelectColumns(raw?: string): Set<string> | undefined {
        if (!raw) return undefined;
        const cols = raw.split(',').map((c) => c.trim()).filter(Boolean);
        return cols.length > 0 ? new Set(cols) : undefined;
    }

    /** Parses "name,email,status" → ["name","email","status"], or undefined. */
    private parseColumnKeys(raw?: string): string[] | undefined {
        if (!raw) return undefined;
        const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
        return keys.length > 0 ? keys : undefined;
    }

    /**
     * Resolves the `values` config field and normalises the result to a 2-D
     * cell grid that the Sheets API expects.
     *
     * Supported input shapes:
     *  • String expression  → resolved, then normalised
     *  • 2-D array          → cells serialised and returned as-is
     *  • 1-D array          → wrapped as a single row
     *  • Array of objects   → each object becomes one row
     *  • Single object      → one row of the object's values
     *  • Primitive          → single-cell grid
     *
     * Formula strings (starting with `=`) are preserved verbatim here. Under
     * USER_ENTERED, Google Sheets evaluates them into live formulas; under RAW
     * ("Paste as values"), `writeGridValues()` evaluates them and pastes the
     * computed result as a plain value.
     */
    private resolveValues(
        values: unknown,
        context: ExecutionContext,
        columnKeys?: string[],
    ): unknown[][] {
        let resolved: unknown = values;

        if (typeof values === 'string') {
            const trimmed = values.trim();
            if (!trimmed) return [[]];

            if (this.isSingleExpression(trimmed)) {
                // The whole field is one expression (e.g. {{nodes.x.data}}).
                // Resolve it to its native value so arrays/objects keep their
                // structure. (Unchanged behavior.)
                resolved = this.resolver.resolve(trimmed, context);
            } else if (this.looksLikeJson(trimmed)) {
                // JSON grid/row/record, possibly containing embedded {{...}}
                // tokens. Prefer parsing the raw text first so the recommended
                // quoted form (e.g. '[["{{a}}","{{b}}"]]') keeps its structure;
                // per-cell tokens are resolved later in serializeCell().
                const rawParsed = this.tryParseJson(trimmed);
                if (rawParsed !== undefined) {
                    resolved = rawParsed;
                } else {
                    // Raw text isn't valid JSON — usually because of *unquoted*
                    // tokens like '[[{{a}}, {{b}}]]'. Substitute tokens as JSON
                    // values so the result parses, then fall back to a plain
                    // template if it still isn't JSON.
                    const substituted = this.resolver.resolveTemplateJson(trimmed, context);
                    const parsed = this.tryParseJson(substituted);
                    resolved = parsed !== undefined
                        ? parsed
                        : this.resolver.resolveTemplate(trimmed, context);
                }
            } else {
                // Plain text, possibly mixing literals and {{...}} tokens
                // (e.g. 'Order: {{nodes.x.result}}'). Resolve every token.
                resolved = this.resolver.resolveTemplate(trimmed, context);
            }
        }

        return this.normalizeToGrid(resolved, context, columnKeys);
    }

    /**
     * True when the entire string is a single `{{...}}` expression with no other
     * tokens or surrounding text. Only these should be resolved to a native
     * value; anything else is a template with embedded tokens.
     */
    private isSingleExpression(trimmed: string): boolean {
        const match = trimmed.match(/^\{\{\s*(.+?)\s*\}\}$/);
        if (!match) return false;
        const inner = match[1];
        return !inner.includes('{{') && !inner.includes('}}');
    }

    /** A string is a JSON candidate only when it opens with an array/object. */
    private looksLikeJson(trimmed: string): boolean {
        return trimmed.length >= 2 && (trimmed[0] === '[' || trimmed[0] === '{');
    }

    /**
     * Parse a string into a structured array/object when it is valid JSON that
     * represents a grid, row, or record. Returns `undefined` for any other
     * string (plain text, numbers, formulas, or non-JSON).
     */
    private tryParseJson(str: string): unknown {
        const trimmed = str.trim();
        if (!this.looksLikeJson(trimmed)) return undefined;
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) || (parsed !== null && typeof parsed === 'object')) {
                return parsed;
            }
        } catch {
            // not valid JSON
        }
        return undefined;
    }

    private normalizeToGrid(value: unknown, context: ExecutionContext, columnKeys?: string[]): unknown[][] {
        if (value == null) return [['']];

        if (Array.isArray(value)) {
            if (value.length === 0) return [[]];
            const first = value[0];

            if (Array.isArray(first)) {
                return (value as unknown[][]).map((row) =>
                    (Array.isArray(row) ? row : [row]).map((c) => this.serializeCell(c, context)),
                );
            }
            if (first !== null && typeof first === 'object') {
                return (value as Record<string, unknown>[]).map((obj) => this.objectToRow(obj, context, columnKeys));
            }
            return [value.map((v) => this.serializeCell(v, context))];
        }

        if (typeof value === 'object' && value !== null) {
            return [this.objectToRow(value as Record<string, unknown>, context, columnKeys)];
        }

        return [[this.serializeCell(value, context)]];
    }

    /** A cell is a Google Sheets formula only when it is a string starting with `=`. */
    private isFormulaCell(v: unknown): boolean {
        return typeof v === 'string' && v.startsWith('=');
    }

    /** True when any cell in the grid is a formula string. */
    private gridHasFormula(grid: unknown[][]): boolean {
        return grid.some((row) => row.some((cell) => this.isFormulaCell(cell)));
    }

    /**
     * Single write path for every value-writing action (write / append /
     * append_row / update_row / append_to_row / append_to_column / upsert).
     *
     * Normal case (USER_ENTERED, or RAW without formulas): performs one ordinary
     * update/append with the requested valueInputOption.
     *
     * "Paste as values" with formulas (RAW + a cell starting with `=`): Google
     * Sheets would store the formula as literal text under RAW, but the user
     * wants the computed output pasted as a value. So we (1) write with
     * USER_ENTERED so Sheets evaluates each formula in its real target position,
     * (2) read the written range back unformatted, (3) rewrite the range as RAW
     * with a merged grid where formula cells hold their computed value and literal
     * cells keep the user's original input verbatim.
     *
     * Returns a normalized subset of fields used across all callers.
     */
    private async writeGridValues(
        sheets: ReturnType<typeof google.sheets>,
        params: {
            spreadsheetId: string;
            range: string;
            grid: unknown[][];
            valueInputOption: 'RAW' | 'USER_ENTERED';
            mode: 'update' | 'append';
        },
    ): Promise<{
        updatedRange?: string | null;
        updatedRows?: number | null;
        updatedColumns?: number | null;
        updatedCells?: number | null;
        tableRange?: string | null;
    }> {
        const { spreadsheetId, range, grid, valueInputOption, mode } = params;
        const needsCompute = valueInputOption === 'RAW' && this.gridHasFormula(grid);

        // Effective option for the initial write: force USER_ENTERED so formulas
        // evaluate when we need to paste their computed results.
        const initialOption = needsCompute ? 'USER_ENTERED' : valueInputOption;

        let writtenRange: string | null | undefined;
        let normalized: {
            updatedRange?: string | null;
            updatedRows?: number | null;
            updatedColumns?: number | null;
            updatedCells?: number | null;
            tableRange?: string | null;
        };

        if (mode === 'update') {
            const res = await sheets.spreadsheets.values.update({
                spreadsheetId, range,
                valueInputOption: initialOption,
                requestBody: { values: grid },
            });
            writtenRange = res.data.updatedRange;
            normalized = {
                updatedRange:   res.data.updatedRange,
                updatedRows:    res.data.updatedRows,
                updatedColumns: res.data.updatedColumns,
                updatedCells:   res.data.updatedCells,
            };
        } else {
            const res = await sheets.spreadsheets.values.append({
                spreadsheetId, range,
                valueInputOption: initialOption,
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: grid },
            });
            writtenRange = res.data.updates?.updatedRange;
            normalized = {
                updatedRange:   res.data.updates?.updatedRange,
                updatedRows:    res.data.updates?.updatedRows,
                updatedColumns: res.data.updates?.updatedColumns,
                updatedCells:   res.data.updates?.updatedCells,
                tableRange:     res.data.tableRange,
            };
        }

        if (!needsCompute || !writtenRange) return normalized;

        // Read back the computed results, then paste them as values (RAW).
        const readRes = await sheets.spreadsheets.values.get({
            spreadsheetId, range: writtenRange,
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        const computed = readRes.data.values ?? [];

        const merged = grid.map((row, r) =>
            row.map((cell, c) => (this.isFormulaCell(cell) ? (computed[r]?.[c] ?? '') : cell)),
        );

        const rewrite = await sheets.spreadsheets.values.update({
            spreadsheetId, range: writtenRange,
            valueInputOption: 'RAW',
            requestBody: { values: merged },
        });

        return {
            ...normalized,
            updatedRange:   rewrite.data.updatedRange ?? normalized.updatedRange,
            updatedRows:    rewrite.data.updatedRows ?? normalized.updatedRows,
            updatedColumns: rewrite.data.updatedColumns ?? normalized.updatedColumns,
            updatedCells:   rewrite.data.updatedCells ?? normalized.updatedCells,
        };
    }

    private objectToRow(obj: Record<string, unknown>, context: ExecutionContext, columnKeys?: string[]): unknown[] {
        if (columnKeys && columnKeys.length > 0) {
            return columnKeys.map((k) => this.serializeCell(obj[k], context));
        }
        return Object.values(obj).map((v) => this.serializeCell(v, context));
    }

    private serializeCell(v: unknown, context: ExecutionContext): unknown {
        if (v == null)             return '';
        // Resolve any embedded {{...}} tokens in cell text (e.g. a parsed JSON
        // cell "{{nodes.x.name}}" or concatenated "Order: {{n}}").
        if (typeof v === 'string') return this.resolver.resolveTemplate(v, context);
        if (typeof v === 'number') return v;
        if (typeof v === 'boolean') return v;
        return JSON.stringify(v);
    }
}
