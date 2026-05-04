import { Settings2, Star, Braces, Play, Loader2, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Clock, Copy, Check, ArrowRight, Power, X, AlertTriangle, Save, Wand2, Info } from 'lucide-react';
import { useRef, useState, useEffect, useMemo, type ReactNode } from 'react';
import { HttpBodyEditor, type BodyLanguage } from './HttpBodyEditor';
import { useWorkflowStore } from '../../store/workflowStore';
import type { CanvasNode } from '../../store/workflowStore';
import { Select } from '../ui/Input';
import { useTestNode, useNodeTestResults, useLastRunResults } from '../../hooks/useNodeTest';
import type { NodeTestResult } from '../../types/workflow';
import { useCredentialList } from '../../hooks/useCredentials';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useSaveWorkflow } from '../../hooks/useSaveWorkflow';
import { useGmailLabels, useGmailMessageLabels, isExpression } from '../../hooks/useGmailData';
import { useGDriveItems } from '../../hooks/useGDriveData';
import { useGSheetsSheets } from '../../hooks/useGSheetsData';
import { useSlackChannels, useSlackUsers } from '../../hooks/useSlackData';
import { stageFile } from '../../api/client';
import { useTeamsTeams, useTeamsChannels, useTeamsUsers } from '../../hooks/useTeamsData';
import { useBasecampProjects, useBasecampTodolists, useBasecampTodos, useBasecampTodoGroups, useBasecampPeople, useBasecampCompanies } from '../../hooks/useBasecampData';
import { NodeIcon } from '../nodes/NodeIcons';

// ── Output field catalogue (human-friendly labels per node type) ──────────────

interface OutputField {
  key: string;
  label: string;
}

const NODE_OUTPUT_FIELDS: Record<string, OutputField[]> = {
  trigger: [
    { key: 'triggerType',  label: 'Trigger type (manual/webhook/cron/app_event)' },
    { key: 'triggeredAt',  label: 'Trigger timestamp (ISO)' },
    // webhook
    { key: 'body',         label: 'Request body (webhook)' },
    { key: 'headers',      label: 'Request headers (webhook)' },
    { key: 'query',        label: 'Query params (webhook)' },
    // cron
    { key: 'scheduledAt',  label: 'Scheduled time (cron)' },
    // app event (all app types)
    { key: 'items',        label: 'Triggered event items array (app event)' },
    { key: 'count',        label: 'Number of triggered items (app event)' },
    { key: 'polledAt',     label: 'Poll timestamp ISO (app event)' },
  ],
  http: [
    { key: 'status', label: 'HTTP status code' },
    { key: 'body', label: 'Full response body (JSON)' },
    { key: 'headers', label: 'Response headers' },
  ],
  llm: [
    { key: 'content', label: 'AI response text' },
    { key: 'model', label: 'Model used' },
    { key: 'usage.totalTokens', label: 'Total tokens used' },
    { key: 'usage.promptTokens', label: 'Prompt tokens' },
    { key: 'usage.completionTokens', label: 'Completion tokens' },
  ],
  condition: [
    { key: 'result', label: 'Condition result (true / false)' },
    { key: 'nextNodeId', label: 'Next node ID' },
  ],
  switch: [
    { key: 'matchedCase', label: 'Matched case label' },
    { key: 'nextNodeId', label: 'Next node ID' },
  ],
  transform: [{ key: '…', label: 'Use the key names you defined in Mappings' }],
  extract: [{ key: '…', label: 'Use the key names you defined as Fields' }],
  formatter: [
    { key: 'formattedText', label: 'Formatted message text (ready to send)' },
    { key: 'medium',        label: 'Target medium (slack / teams / gmail / gdocs)' },
  ],
  output: [{ key: 'value', label: 'Resolved output value' }],
  gmail: [
    // send / reply
    { key: 'messageId',    label: 'Message ID (send / reply / send_flux / reply_flux / mark_read|mark_unread message mode)' },
    { key: 'threadId',     label: 'Thread ID (send / reply / reply_flux / mark_read|mark_unread thread mode)' },
    { key: 'labelIds',     label: 'Label IDs applied (send / reply / mark_*)' },
    // mark_read / mark_unread
    { key: 'markedAs',     label: 'Resulting state — "read" or "unread" (mark_read / mark_unread)' },
    { key: 'target',       label: 'Whether the action applied to a "message" or the entire "thread"' },
    { key: 'messageCount', label: 'Number of messages affected when target is "thread"' },
    // send_flux / reply_flux
    { key: 'accepted',     label: 'Accepted recipients array (send_flux / reply_flux)' },
    { key: 'rejected',     label: 'Rejected recipients array (send_flux / reply_flux)' },
    { key: 'from',         label: 'From address used (send_flux / read)' },
    { key: 'to',           label: 'To address (send_flux)' },
    { key: 'subject',      label: 'Subject line (send_flux / reply_flux / read)' },
    { key: 'usedTemplate', label: 'Whether Flux template was applied (send_flux / reply_flux)' },
    { key: 'repliedTo',    label: 'Original message ID that was replied to (reply / reply_flux)' },
    { key: 'replyAll',     label: 'Whether Reply All mode was used (reply / reply_flux)' },
    // list / get_many — thread structure
    { key: 'threads',         label: 'Thread list — array of { threadId, messages[] } (list)' },
    { key: 'totalThreads',    label: 'Total threads returned (list)' },
    { key: 'totalMessages',   label: 'Total messages across all threads (list)' },
    { key: 'matchedMessages', label: 'Matched message count from search (list)' },
    // per-thread message fields — expand threads[0].messages to see these
    { key: 'threads[0].threadId',              label: 'Thread ID of first thread (list)' },
    { key: 'threads[0].messages[0].id',        label: 'Message ID — first msg of first thread (list)' },
    { key: 'threads[0].messages[0].threadId',  label: 'Thread ID on the message object (list)' },
    { key: 'threads[0].messages[0].subject',   label: 'Subject of first message (list)' },
    { key: 'threads[0].messages[0].from',      label: 'Sender address of first message (list)' },
    { key: 'threads[0].messages[0].to',        label: 'Recipient address of first message (list)' },
    { key: 'threads[0].messages[0].date',      label: 'Date header of first message (list)' },
    { key: 'threads[0].messages[0].snippet',   label: 'Short preview snippet of first message (list)' },
    { key: 'threads[0].messages[0].body',      label: 'Full body text of first message (list)' },
    // read
    { key: 'id',       label: 'Message ID (read)' },
    { key: 'snippet',  label: 'Short preview snippet (read)' },
    { key: 'body',     label: 'Full body text (read)' },
  ],
  gdrive: [
    { key: 'files',        label: 'File/folder list (list)' },
    { key: 'total',        label: 'Total matched count (list)' },
    { key: 'id',           label: 'File ID (upload / create / copy)' },
    { key: 'name',         label: 'File name' },
    { key: 'webViewLink',  label: 'File open link' },
    { key: 'content',      label: 'File text content (download)' },
    { key: 'skipped',      label: 'Skipped flag — true when no file was found and Skip if no file found is on' },
    { key: 'folderId',     label: 'Folder ID (create_folder)' },
    { key: 'permissionId', label: 'Permission ID (share)' },
    { key: 'deleted',      label: 'Deleted flag (delete)' },
    { key: 'movedTo',      label: 'Moved-to folder ID (move)' },
    { key: 'newName',      label: 'New name after rename' },
  ],
  gdocs: [
    { key: 'documentId',  label: 'Document ID' },
    { key: 'title',       label: 'Document title' },
    { key: 'text',        label: 'Document text content (read)' },
    { key: 'url',         label: 'Edit URL (create)' },
    { key: 'webViewLink', label: 'Open link (create / rename)' },
    { key: 'newTitle',    label: 'New title after rename' },
    { key: 'appended',    label: 'Appended content types (append)' },
    { key: 'revisionId',  label: 'Revision ID (read)' },
  ],
  gsheets: [
    { key: 'data',           label: 'Rows as objects (read / get_rows)' },
    { key: 'headers',        label: 'Column headers (read / get_rows)' },
    { key: 'rows',           label: 'Raw rows 2-D array (read)' },
    { key: 'total',          label: 'Total rows returned' },
    { key: 'updatedRows',    label: 'Rows updated (write / append / update_row)' },
    { key: 'appendedRows',   label: 'Rows appended (append_row)' },
    { key: 'updatedRange',   label: 'Updated range (write / append / update_row)' },
    { key: 'spreadsheetId',  label: 'Spreadsheet ID' },
    { key: 'url',            label: 'Open URL (create_spreadsheet)' },
    { key: 'deleted',        label: 'Deleted flag (delete_*)' },
    { key: 'sheetId',        label: 'Sheet ID (create_sheet)' },
    { key: 'clearedRange',   label: 'Cleared range (clear_sheet)' },
    { key: 'action',         label: '"appended" or "updated" (append_update_row)' },
    { key: 'rowIndex',       label: 'Matched row index (append_update_row)' },
    { key: 'startColumn',    label: 'Start column letter (append_to_row)' },
    { key: 'appendedCells',  label: 'Cells appended (append_to_row)' },
    { key: 'startRow',       label: 'Start row number (append_to_column)' },
    { key: 'column',         label: 'Column letter (append_to_column)' },
    { key: 'insertedRows',   label: 'Inserted row count (insert_rows)' },
    { key: 'insertedColumns', label: 'Inserted column count (insert_columns)' },
    { key: 'startIndex',     label: 'Start index (insert_*/delete_*)' },
    { key: 'formatted',      label: 'Formatted flag (format_cells)' },
    { key: 'fieldsApplied',  label: 'Format fields applied (format_cells)' },
  ],
  basecamp: [
    { key: 'id',          label: 'To-do / resource ID (create / complete)' },
    { key: 'title',       label: 'To-do title / name (create)' },
    { key: 'description', label: 'To-do description (create)' },
    { key: 'appUrl',      label: 'To-do link — open in Basecamp (create)' },
    { key: 'url',         label: 'To-do API URL (create)' },
    { key: 'dueOn',       label: 'Due date YYYY-MM-DD (create)' },
    { key: 'assignees',   label: 'Assignees array [{id, name, email}] (create)' },
    { key: 'createdAt',   label: 'Creation timestamp ISO (create)' },
    { key: 'projectId',   label: 'Project ID used (create)' },
    { key: 'todolistId',  label: 'To-do list ID used (create)' },
    { key: 'status',      label: 'Action status (created / posted / sent / invited / reinvited / granted_project_access / already_member)' },
    { key: 'message',     label: 'Human-readable summary when an existing user was matched or a ghost record was recovered (invite_users)' },
    { key: 'completed',   label: 'Completion flag (complete / uncomplete)' },
    { key: 'todos',       label: 'To-do list array (list_todos)' },
    { key: 'count',       label: 'To-do count (list_todos)' },
    { key: 'name',                label: 'Invited person\'s name (invite_users)' },
    { key: 'email',               label: 'Invited person\'s email address (invite_users)' },
    { key: 'company',             label: 'Invited person\'s company name (invite_users)' },
    { key: 'projectAutoSelected', label: 'True when no Project was specified and one was auto-picked (invite_users)' },
    { key: 'organizations', label: 'Organizations array [{id, name}] (list_organizations)' },
  ],
  slack: [
    { key: 'ok',        label: 'Slack API success flag' },
    { key: 'messageId', label: 'Message timestamp / ID (send)' },
    { key: 'channelId', label: 'Channel ID (send)' },
    { key: 'messages',  label: 'Message list (list_messages)' },
    { key: 'users',     label: 'User list (list_users)' },
    { key: 'channels',  label: 'Channel list (list_channels)' },
    { key: 'files',     label: 'File list (list_files)' },
    { key: 'total',     label: 'Total items returned' },
  ],
  teams: [
    { key: 'id',       label: 'Message / resource ID' },
    { key: 'status',   label: 'Operation status' },
    { key: 'messages', label: 'Message list' },
    { key: 'members',  label: 'Member list' },
    { key: 'channels', label: 'Channel list' },
    { key: 'chats',    label: 'Chat list' },
    { key: 'total',    label: 'Total items returned' },
  ],
};

// ── "No data" badge ───────────────────────────────────────────────────────────

function NoDataBadge() {
  return (
    <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/40">
      no data
    </span>
  );
}

// Render a value preview — short and readable
function ValuePreview({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <NoDataBadge />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <NoDataBadge />;
    return (
      <span className="text-slate-600 dark:text-slate-400">[{value.length} item{value.length !== 1 ? 's' : ''}]</span>
    );
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length === 0) return <NoDataBadge />;
    return <span className="text-slate-600 dark:text-slate-400">{'{'}{keys.slice(0, 2).join(', ')}{keys.length > 2 ? ', …' : ''}{'}'}</span>;
  }
  const str = String(value);
  return (
    <span className="text-emerald-700 dark:text-emerald-400 font-mono">
      {str.length > 40 ? str.slice(0, 40) + '…' : str}
    </span>
  );
}

// ── Expression display helpers ────────────────────────────────────────────────

const NODE_TYPE_LABEL: Record<string, string> = {
  http: 'HTTP', llm: 'AI', trigger: 'Trigger', condition: 'Condition',
  switch: 'Switch', transform: 'Transform', extract: 'Extract', output: 'Output',
  formatter: 'Formatter',
  gmail: 'Gmail', gdrive: 'Drive', gdocs: 'Docs', gsheets: 'Sheets',
  basecamp: 'Basecamp',
};

function nodeTypeLabel(type: string) {
  return NODE_TYPE_LABEL[type] ?? type.toUpperCase();
}

type ExprSegment =
  | { kind: 'text'; text: string }
  | { kind: 'expr'; nodeType: string; nodeName: string; field: string };

function parseExprSegments(value: string, nodes: CanvasNode[]): ExprSegment[] {
  const parts = value.split(/(\{\{nodes\.[^}]+\}\})/g);
  return parts.flatMap((part): ExprSegment[] => {
    const m = part.match(/^\{\{nodes\.([^.}]+)\.([^}]+)\}\}$/);
    if (m) {
      const node = nodes.find(n => n.id === m[1]);
      return [{
        kind: 'expr',
        nodeType: node?.data.nodeType ?? '',
        nodeName: node?.data.label ?? m[1],
        field: m[2],
      }];
    }
    return part ? [{ kind: 'text', text: part }] : [];
  });
}

const EXPR_RE = /\{\{nodes\.[^}]+\}\}/;

/**
 * Walk a dotted path (with bracket array indices) against an object — mirrors
 * the backend `ExpressionResolver.walkPath` so the frontend preview agrees
 * with what the workflow runtime will see. Supports `body[0]` and bare `[0]`
 * segments.
 *
 * Returns `undefined` for any "not present" outcome; callers decide how to
 * render that.
 */
function walkResolvedPath(obj: unknown, fieldPath: string): unknown {
  let current: unknown = obj;
  for (const rawKey of fieldPath.split('.')) {
    if (current == null) return undefined;

    // "key[0]" — access a property and then an array index in one segment
    const propPlusBracket = rawKey.match(/^(.+?)\[(\d+)\]$/);
    if (propPlusBracket) {
      const [, propKey, idxStr] = propPlusBracket;
      if (typeof current !== 'object') return undefined;
      const next = (current as Record<string, unknown>)[propKey];
      if (!Array.isArray(next)) return undefined;
      current = next[parseInt(idxStr, 10)];
      continue;
    }
    // "[0]" — index into the current array
    const bareBracket = rawKey.match(/^\[(\d+)\]$/);
    if (bareBracket) {
      if (!Array.isArray(current)) return undefined;
      current = current[parseInt(bareBracket[1], 10)];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[rawKey];
  }
  return current;
}

/**
 * Resolve a single `{{nodes.<id>...}}` token to its raw (un-stringified) value
 * using cached test-result outputs. Returns `undefined` when the path can't be
 * resolved (node not tested, key missing, etc.).
 *
 * Also handles bare `{{nodes.<id>}}` — returns the whole node output object.
 */
function resolveTokenRaw(
  token: string,
  testResults: Record<string, NodeTestResult>,
): unknown {
  // Token shape: {{nodes.<id>}} or {{nodes.<id>.<path>}}
  const m = token.match(/^\{\{\s*nodes\.([^.}\s]+)(?:\.([^}]+))?\s*\}\}$/);
  if (!m) return undefined;
  const [, nodeId, fieldPath] = m;
  const output = testResults[nodeId]?.output;
  if (output == null) return undefined;
  if (!fieldPath) return output;
  return walkResolvedPath(output, fieldPath);
}

/**
 * Resolves a string with `{{nodes...}}` tokens to a plain string for places
 * that expect text (e.g. inline previews). Returns `null` when *any* token in
 * the string fails to resolve. Non-string resolved values are stringified
 * (objects → JSON, primitives → String()).
 */
function resolveValue(
  value: string,
  testResults: Record<string, NodeTestResult>,
): string | null {
  if (!EXPR_RE.test(value)) return value; // nothing to resolve
  let allResolved = true;
  const result = value.replace(/\{\{nodes\.[^}]+\}\}/g, (token) => {
    const raw = resolveTokenRaw(token, testResults);
    if (raw == null) { allResolved = false; return ''; }
    if (typeof raw === 'string')               return raw;
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
    try { return JSON.stringify(raw); } catch { return String(raw); }
  });
  return allResolved ? result : null;
}

/**
 * Like {@link resolveValue} but returns the *raw* resolved value when the
 * input is a single bare token like `{{nodes.gmail.threads[0].messages}}`.
 * This lets the Extract panel detect whether the source is an array (→
 * iteration mode) instead of a coerced string. For mixed templates (text
 * around tokens), defers to `resolveValue` and returns the merged string.
 *
 * Returns `null` only when the expression contains tokens that can't be
 * resolved at all — same "unresolved" sentinel as `resolveValue`.
 */
function resolveValueRaw(
  value: string,
  testResults: Record<string, NodeTestResult>,
): unknown {
  const trimmed = value.trim();
  if (!EXPR_RE.test(trimmed)) return trimmed;

  // Single bare token → return the raw value (object, array, string, …)
  const single = trimmed.match(/^\{\{[^}]+\}\}$/);
  if (single) {
    const raw = resolveTokenRaw(trimmed, testResults);
    return raw === undefined ? null : raw;
  }

  // Mixed template → fall back to string substitution semantics
  return resolveValue(value, testResults);
}

function ExprToken({ nodeType, nodeName, field }: { nodeType: string; nodeName: string; field: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 border border-blue-300 dark:border-blue-700/50 text-[10px] font-medium mx-0.5 align-middle whitespace-nowrap">
      <span className="text-blue-700 dark:text-blue-400 font-bold uppercase text-[9px]">{nodeTypeLabel(nodeType)}</span>
      <span className="text-blue-400 dark:text-blue-600">·</span>
      <span className="text-gray-900 dark:text-slate-200">{nodeName}</span>
      <span className="text-blue-400 dark:text-blue-600">·</span>
      <span className="font-mono text-blue-700 dark:text-blue-300">{field}</span>
    </span>
  );
}

function DisplayValue({ value, nodes, placeholder }: { value: string; nodes: CanvasNode[]; placeholder?: string }) {
  if (!value) return <span className="text-slate-400 dark:text-slate-500 text-xs italic">{placeholder ?? ''}</span>;
  const segs = parseExprSegments(value, nodes);
  return (
    <>
      {segs.map((seg, i) =>
        seg.kind === 'text'
          ? <span key={i} className="text-gray-800 dark:text-slate-200 text-xs">{seg.text}</span>
          : <ExprToken key={i} nodeType={seg.nodeType} nodeName={seg.nodeName} field={seg.field} />
      )}
    </>
  );
}

// ── Variable picker panel ─────────────────────────────────────────────────────

/**
 * Build a "predicted" output-field list for an Extract node that hasn't been
 * tested yet, based on the configured fields and source mode. This way users
 * can insert `{{nodes.<extract>.items[0].<field>}}` chips downstream before
 * actually running the node.
 *
 *   - mode = 'each-item'                       → expose `items[0].<field>` + count
 *   - mode = 'auto' / 'single' / 'first-match' → expose flat `<field>` chips
 *
 * (For `auto`, runtime behavior depends on whether the source resolves to an
 * array, so we default to the flat shape; users can adjust the inserted
 * expression if they need to drill into items. `first-match` always produces
 * flat output by design.)
 */
function buildExtractPredictedFields(
  config: Record<string, unknown> | undefined,
): Array<{ key: string; label: string; hasReal: boolean }> {
  const cfg = (config ?? {}) as { mode?: string; fields?: Array<{ name?: string }> };
  const mode = cfg.mode ?? 'auto';
  const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
  const named = fields.filter((f) => typeof f?.name === 'string' && f.name.length > 0) as Array<{ name: string }>;

  if (named.length === 0) {
    return [];
  }

  if (mode === 'each-item') {
    return [
      { key: 'count', label: 'Number of items in the list', hasReal: false },
      ...named.map((f) => ({
        key: `items[0].${f.name}`,
        label: `(per-item) "${f.name}" — replace [0] with the desired index`,
        hasReal: false,
      })),
    ];
  }

  return named.map((f) => ({ key: f.name, label: `Extracted value: ${f.name}`, hasReal: false }));
}

export function VariablePickerPanel({
  nodes,
  testResults,
  onInsert,
}: {
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  onInsert: (expression: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (nodes.length === 0) return null;

  return (
    <div className="mt-1 border border-blue-300 dark:border-blue-800/50 rounded-md overflow-hidden shadow-lg">
      <div className="bg-blue-50 dark:bg-slate-800 px-2.5 py-1.5 border-b border-blue-200 dark:border-slate-700">
        <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
          Click a field to insert it
        </p>
        <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">
          Arrays &amp; objects can be expanded ▶ to insert individual values.
        </p>
      </div>

      <div className="max-h-72 overflow-y-auto bg-white dark:bg-slate-900">
        {nodes.map((n) => {
          const testResult = testResults[n.id];
          const realOutput = testResult?.status === 'success' && testResult.output != null
            ? (testResult.output as Record<string, unknown>)
            : null;

          // Detect GSheets app-event trigger for Zapier-style column display
          const isGSheetsAppEvent =
            n.data.nodeType === 'trigger' &&
            (n.data.config as Record<string, unknown>)?.appType === 'gsheets';

          const fields: Array<{ key: string; label: string; realValue?: unknown; hasReal: boolean }> =
            realOutput
              ? Object.entries(realOutput).map(([key, val]) => ({
                  key,
                  label: key,
                  realValue: val,
                  hasReal: true,
                }))
              : n.data.nodeType === 'extract'
                ? buildExtractPredictedFields(n.data.config as Record<string, unknown>)
                : (NODE_OUTPUT_FIELDS[n.data.nodeType] ?? []).map((f) => ({
                    ...f,
                    hasReal: false,
                  }));

          return (
            <div key={n.id} className="px-2.5 py-2 border-b border-slate-200 dark:border-slate-700/60 last:border-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    n.data.nodeType === 'http'      ? 'bg-blue-500' :
                    n.data.nodeType === 'llm'       ? 'bg-emerald-500' :
                    n.data.nodeType === 'trigger'   ? 'bg-violet-500' :
                    n.data.nodeType === 'transform' ? 'bg-cyan-500' :
                    n.data.nodeType === 'condition' ? 'bg-amber-500' :
                    n.data.nodeType === 'switch'    ? 'bg-orange-500' :
                    'bg-rose-500'
                  }`}
                />
                <span className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">{n.data.label}</span>
                <span className="text-[9px] text-slate-500 dark:text-slate-500 shrink-0">{n.data.nodeType}</span>
                {realOutput
                  ? <span className="text-[9px] text-emerald-600 dark:text-emerald-400 shrink-0 ml-auto font-medium">● live data</span>
                  : <span className="text-[9px] text-slate-400 dark:text-slate-600 shrink-0 ml-auto italic">test node to see real fields</span>
                }
              </div>

              <div className="space-y-1">
                {n.data.nodeType === 'transform' && !realOutput ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onInsert(`{{nodes.${n.id}.YOUR_KEY}}`)}
                      className="inline-flex items-center gap-1 text-[10px] bg-slate-100 dark:bg-slate-700 hover:bg-blue-600 border border-slate-300 dark:border-slate-600 text-emerald-700 dark:text-emerald-300 hover:text-white hover:border-blue-600 rounded px-1.5 py-0.5 font-mono transition-colors"
                      title="Replace YOUR_KEY with your mapping key name"
                    >
                      .YOUR_KEY
                    </button>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">← replace with your mapping key</span>
                  </div>
                ) : fields.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onInsert(`{{nodes.${n.id}}}`)}
                    className="text-[10px] bg-slate-100 dark:bg-slate-700 hover:bg-blue-600 border border-slate-300 dark:border-slate-600 text-emerald-700 dark:text-emerald-300 hover:text-white hover:border-blue-600 rounded px-1.5 py-0.5 font-mono transition-colors"
                  >
                    {`{{nodes.${n.id}}}`}
                  </button>
                ) : (
                  fields.map((f) => {
                    if (f.key === '…') return null;

                    const expandKey = `${n.id}::${f.key}`;
                    const isArr = f.hasReal && Array.isArray(f.realValue);
                    const isObj = f.hasReal && !isArr && typeof f.realValue === 'object' && f.realValue !== null;

                    // Auto-expand the "items" field for GSheets triggers when live data is present
                    const autoExpand = isGSheetsAppEvent && f.key === 'items' && isArr;
                    const isOpen = expanded[expandKey] ?? autoExpand;

                    const firstItem = isArr && (f.realValue as unknown[]).length > 0
                      ? (f.realValue as unknown[])[0]
                      : null;
                    const firstIsObj = firstItem !== null && typeof firstItem === 'object';

                    // Shared chip class — readable in light AND dark mode
                    const chipCls = 'inline-flex items-center gap-1 text-[10px] bg-slate-100 dark:bg-slate-700 hover:bg-blue-600 dark:hover:bg-blue-700 border border-slate-300 dark:border-slate-600 hover:border-blue-600 text-emerald-700 dark:text-emerald-300 hover:text-white rounded px-1.5 py-0.5 transition-colors font-mono';
                    const chipValCls = 'font-sans text-slate-500 dark:text-slate-400 ml-0.5';

                    return (
                      <div key={f.key} className="space-y-0.5">
                        {/* Top-level field row */}
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onInsert(`{{nodes.${n.id}.${f.key}}}`)}
                            title={`Insert: {{nodes.${n.id}.${f.key}}}`}
                            className={chipCls}
                          >
                            <span>.{f.key}</span>
                            {f.hasReal ? (
                              <span className={chipValCls}>
                                = <ValuePreview value={f.realValue} />
                              </span>
                            ) : (
                              <span className="font-sans text-slate-400 dark:text-slate-500 ml-0.5">{f.label}</span>
                            )}
                          </button>

                          {/* Expand / collapse toggle for arrays and objects */}
                          {(isArr || isObj) && (
                            <button
                              type="button"
                              onClick={() => setExpanded((prev) => ({ ...prev, [expandKey]: !isOpen }))}
                              className="inline-flex items-center gap-0.5 text-[9px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 px-1 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-slate-700/60 transition-colors font-medium"
                              title={isOpen ? 'Collapse' : 'Expand to insert individual values'}
                            >
                              {isOpen
                                ? <ChevronUp   className="w-2.5 h-2.5" />
                                : <ChevronDown className="w-2.5 h-2.5" />
                              }
                              {isOpen ? 'collapse' : 'expand'}
                            </button>
                          )}
                        </div>

                        {/* ── Expanded: array ── */}
                        {isOpen && isArr && (
                          <div className="ml-2 pl-2 border-l-2 border-violet-300 dark:border-violet-700/50 space-y-0.5">
                            {/* GSheets special view: column header → cell value */}
                            {isGSheetsAppEvent && f.key === 'items' && firstIsObj ? (
                              <>
                                <p className="text-[9px] text-violet-700 dark:text-violet-400 font-semibold uppercase tracking-wider pt-0.5 pb-1">
                                  Row columns — click to insert
                                </p>
                                {Object.entries(firstItem as Record<string, unknown>).map(([col, val]) => (
                                  <button
                                    key={col}
                                    type="button"
                                    onClick={() => onInsert(`{{nodes.${n.id}.items[0].${col}}}`)}
                                    title={`Insert: {{nodes.${n.id}.items[0].${col}}}`}
                                    className="flex w-full items-center gap-1.5 text-[10px] bg-violet-50 dark:bg-violet-900/25 hover:bg-blue-600 dark:hover:bg-blue-700 border border-violet-200 dark:border-violet-700/40 hover:border-blue-600 text-violet-800 dark:text-violet-200 hover:text-white rounded px-1.5 py-1 transition-colors"
                                  >
                                    <span className="font-semibold shrink-0 min-w-0 truncate">{col}</span>
                                    <span className="text-slate-500 dark:text-slate-400 font-sans ml-auto shrink-0 pl-2">
                                      = <ValuePreview value={val} />
                                    </span>
                                  </button>
                                ))}
                              </>
                            ) : (
                              <>
                                {/* Generic array: first-item button */}
                                <button
                                  type="button"
                                  onClick={() => onInsert(`{{nodes.${n.id}.${f.key}[0]}}`)}
                                  title={`Insert: {{nodes.${n.id}.${f.key}[0]}}`}
                                  className={chipCls}
                                >
                                  .{f.key}[0]
                                  {firstItem !== null && (
                                    <span className={chipValCls}>
                                      = <ValuePreview value={firstItem} />
                                    </span>
                                  )}
                                </button>

                                {/* If first item is an object, expose each sub-key individually */}
                                {firstIsObj && (
                                  <div className="space-y-0.5 pt-0.5">
                                    {Object.entries(firstItem as Record<string, unknown>).map(([subKey, subVal]) => {
                                      const isSubArr = Array.isArray(subVal);
                                      const subExpandKey = `${expandKey}::${subKey}`;
                                      const isSubOpen = expanded[subExpandKey] ?? false;

                                      return (
                                        <div key={subKey} className="space-y-0.5">
                                          <div className="flex flex-wrap items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => onInsert(`{{nodes.${n.id}.${f.key}[0].${subKey}}}`)}
                                              title={`Insert: {{nodes.${n.id}.${f.key}[0].${subKey}}}`}
                                              className={chipCls}
                                            >
                                              .{f.key}[0].{subKey}
                                              {!isSubArr && (
                                                <span className={chipValCls}>
                                                  = <ValuePreview value={subVal} />
                                                </span>
                                              )}
                                            </button>

                                            {/* Expand sub-arrays (e.g. threads[0].messages) */}
                                            {isSubArr && (
                                              <button
                                                type="button"
                                                onClick={() => setExpanded((prev) => ({ ...prev, [subExpandKey]: !isSubOpen }))}
                                                className="inline-flex items-center gap-0.5 text-[9px] text-pink-600 dark:text-pink-400 hover:text-pink-800 dark:hover:text-pink-200 px-1 py-0.5 rounded hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors font-medium"
                                                title={isSubOpen ? 'Collapse messages' : 'Expand to see individual message fields'}
                                              >
                                                {isSubOpen
                                                  ? <ChevronUp   className="w-2.5 h-2.5" />
                                                  : <ChevronDown className="w-2.5 h-2.5" />
                                                }
                                                {isSubOpen ? 'collapse' : `expand ${(subVal as unknown[]).length} item${(subVal as unknown[]).length !== 1 ? 's' : ''}`}
                                              </button>
                                            )}
                                          </div>

                                          {/* Sub-array expansion — one section per item with correct index */}
                                          {isSubOpen && isSubArr && (
                                            <div className="ml-2 pl-2 border-l-2 border-pink-300 dark:border-pink-700/50 space-y-2">
                                              {(subVal as unknown[]).map((item, idx) => {
                                                const isItemObj = item !== null && typeof item === 'object' && !Array.isArray(item);
                                                return (
                                                  <div key={idx} className="space-y-0.5">
                                                    {/* Whole item chip */}
                                                    <button
                                                      type="button"
                                                      onClick={() => onInsert(`{{nodes.${n.id}.${f.key}[0].${subKey}[${idx}]}}`)}
                                                      title={`Insert: {{nodes.${n.id}.${f.key}[0].${subKey}[${idx}]}}`}
                                                      className={chipCls}
                                                    >
                                                      .{f.key}[0].{subKey}[{idx}]
                                                      <span className={chipValCls}>
                                                        = <ValuePreview value={item} />
                                                      </span>
                                                    </button>

                                                    {/* Individual field chips for this item */}
                                                    {isItemObj && (
                                                      <div className="flex flex-wrap gap-1 pl-2">
                                                        {Object.entries(item as Record<string, unknown>).map(([deepKey, deepVal]) => (
                                                          <button
                                                            key={deepKey}
                                                            type="button"
                                                            onClick={() => onInsert(`{{nodes.${n.id}.${f.key}[0].${subKey}[${idx}].${deepKey}}}`)}
                                                            title={`Insert: {{nodes.${n.id}.${f.key}[0].${subKey}[${idx}].${deepKey}}}`}
                                                            className={chipCls}
                                                          >
                                                            .{f.key}[0].{subKey}[{idx}].{deepKey}
                                                            <span className={chipValCls}>
                                                              = <ValuePreview value={deepVal} />
                                                            </span>
                                                          </button>
                                                        ))}
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* ── Expanded: object sub-keys ── */}
                        {isOpen && isObj && (
                          <div className="ml-2 pl-2 border-l-2 border-cyan-300 dark:border-cyan-700/40 flex flex-wrap gap-1">
                            {Object.entries(f.realValue as Record<string, unknown>).map(([subKey, subVal]) => (
                              <button
                                key={subKey}
                                type="button"
                                onClick={() => onInsert(`{{nodes.${n.id}.${f.key}.${subKey}}}`)}
                                title={`Insert: {{nodes.${n.id}.${f.key}.${subKey}}}`}
                                className={chipCls}
                              >
                                .{f.key}.{subKey}
                                <span className={chipValCls}>
                                  = <ValuePreview value={subVal} />
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helper: insert text at cursor ─────────────────────────────────────────────

function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement,
  text: string,
  currentValue: string,
  onChange: (v: string) => void
) {
  const start = el.selectionStart ?? currentValue.length;
  const end = el.selectionEnd ?? currentValue.length;
  const next = currentValue.slice(0, start) + text + currentValue.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    el.selectionStart = start + text.length;
    el.selectionEnd = start + text.length;
    el.focus();
  });
}

// ── ExpressionTextArea ────────────────────────────────────────────────────────

function ExpressionTextArea({
  label,
  value,
  rows = 3,
  placeholder,
  onChange,
  nodes,
  testResults,
  resizable = false,
}: {
  label: string;
  value: string;
  rows?: number;
  placeholder?: string;
  onChange: (v: string) => void;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  resizable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const showDisplay = !focused && !open && EXPR_RE.test(value);

  function handleInsert(expr: string) {
    setFocused(true);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        insertAtCursor(ref.current, expr, value, onChange);
      } else {
        onChange(value + expr);
      }
    });
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
        {nodes.length > 0 && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((p) => !p)}
            title="Insert a variable from another node"
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
              open ? 'bg-blue-600 text-white' : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Braces className="w-2.5 h-2.5" />
            Insert variable
          </button>
        )}
      </div>

      {/* Display mode: readable tokens when blurred */}
      {showDisplay && (
        <div
          onClick={() => { setFocused(true); requestAnimationFrame(() => ref.current?.focus()); }}
          className="w-full flex flex-wrap items-start gap-y-1 content-start bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700/60 hover:border-blue-400 dark:hover:border-blue-600 rounded-md px-2.5 py-1.5 cursor-text shadow-sm"
          style={{ minHeight: `${rows * 20 + 12}px` }}
          title="Click to edit"
        >
          <DisplayValue value={value} nodes={nodes} placeholder={placeholder} />
        </div>
      )}

      {/* Raw textarea — always mounted but visually hidden in display mode */}
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${resizable ? 'resize-y' : 'resize-none'} ${showDisplay ? 'sr-only' : ''}`}
        style={resizable ? { minHeight: `${rows * 20 + 12}px` } : undefined}
      />
      {open && (
        <VariablePickerPanel nodes={nodes} testResults={testResults} onInsert={handleInsert} />
      )}
    </div>
  );
}

// ── ExpressionInput ───────────────────────────────────────────────────────────

function ExpressionInput({
  label,
  value,
  placeholder,
  onChange,
  nodes,
  testResults,
  hint,
  autoSeparator,
}: {
  label?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  hint?: string;
  /** When set, automatically inserts this separator before a new variable token
   *  if there is already content before the cursor and it doesn't already end
   *  with a separator character. Use e.g. ", " for comma-separated list fields. */
  autoSeparator?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const showDisplay = !focused && !open && EXPR_RE.test(value);

  function handleInsert(expr: string) {
    setFocused(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        let toInsert = expr;
        if (autoSeparator) {
          const before = value.slice(0, el.selectionStart ?? value.length).trimEnd();
          if (before.length > 0 && !/[,;]$/.test(before)) {
            toInsert = autoSeparator + expr;
          }
        }
        insertAtCursor(el, toInsert, value, onChange);
      } else {
        const before = value.trimEnd();
        const toInsert = (autoSeparator && before.length > 0 && !/[,;]$/.test(before))
          ? autoSeparator + expr
          : expr;
        onChange(value + toInsert);
      }
    });
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      {(label || nodes.length > 0) && (
        <div className="flex items-center justify-between gap-1">
          {label && <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>}
          {nodes.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen((p) => !p)}
              title="Insert a variable from another node"
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                open ? 'bg-blue-600 text-white' : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Braces className="w-2.5 h-2.5" />
              Insert variable
            </button>
          )}
        </div>
      )}

      {/* Display mode: readable tokens when blurred */}
      {showDisplay && (
        <div
          onClick={() => { setFocused(true); requestAnimationFrame(() => ref.current?.focus()); }}
          className="w-full min-h-[30px] flex flex-wrap items-center gap-y-0.5 bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700/60 hover:border-blue-400 dark:hover:border-blue-600 rounded-md px-2.5 py-1.5 cursor-text shadow-sm"
          title="Click to edit"
        >
          <DisplayValue value={value} nodes={nodes} placeholder={placeholder} />
        </div>
      )}

      {/* Raw input — always mounted but visually hidden in display mode */}
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${showDisplay ? 'sr-only' : ''}`}
      />
      {hint && <p className="text-slate-400 dark:text-slate-500 text-[10px]">{hint}</p>}
      {open && (
        <VariablePickerPanel nodes={nodes} testResults={testResults} onInsert={handleInsert} />
      )}
    </div>
  );
}

// ── Node test result display ──────────────────────────────────────────────────

/** One-click copy button with a brief "✓ Copied" confirmation */
function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy to clipboard"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-400 dark:text-slate-500 hover:text-gray-800 dark:hover:text-slate-200 ${className}`}
    >
      {copied
        ? <Check  className="w-3 h-3 text-emerald-400" />
        : <Copy   className="w-3 h-3" />}
    </button>
  );
}

/** Shared header strip shown on every test result card */
function ResultHeader({ result }: { result: NodeTestResult }) {
  const ranAt = result.ranAt ? new Date(result.ranAt).toLocaleTimeString() : null;
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${
      result.status === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-red-50 dark:bg-red-900/30'
    }`}>
      <div className="flex items-center gap-1.5">
        {result.status === 'success'
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          : <AlertCircle  className="w-3.5 h-3.5 text-red-400" />}
        <span className={`text-[11px] font-semibold ${
          result.status === 'success' ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {result.status === 'success' ? 'Test passed' : 'Test failed'}
        </span>
      </div>
      <div className="flex items-center gap-2.5 text-[10px] text-slate-400 dark:text-slate-500">
        {ranAt && <span>{ranAt}</span>}
        <div className="flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          <span>{result.durationMs} ms</span>
        </div>
      </div>
    </div>
  );
}

// ── HTTP result ───────────────────────────────────────────────────────────────

function HttpResultDisplay({ result }: { result: NodeTestResult }) {
  const [headersOpen, setHeadersOpen] = useState(false);
  const out = (result.output ?? {}) as { status?: number; body?: unknown; headers?: Record<string, string> };
  const httpOk = out.status != null && out.status >= 200 && out.status < 300;
  const bodyStr = out.body != null ? JSON.stringify(out.body, null, 2) : null;

  return (
    <div className="p-3 space-y-3">
      {/* Status code */}
      {out.status != null && (
        <div className="flex items-center gap-3">
          <span className={`text-3xl font-bold tabular-nums leading-none ${
            httpOk ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {out.status}
          </span>
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {httpOk ? 'Request succeeded' : 'Request failed'}
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">HTTP status code</p>
          </div>
        </div>
      )}

      {/* Response body */}
      {bodyStr && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Response data
            </span>
            <CopyButton text={bodyStr} />
          </div>
          <pre className="bg-slate-100 dark:bg-slate-800 rounded-md p-2.5 text-[10px] text-slate-800 dark:text-slate-100 font-mono overflow-auto leading-relaxed whitespace-pre-wrap break-all">
            {bodyStr}
          </pre>
        </div>
      )}

      {/* Headers — collapsible */}
      {out.headers && Object.keys(out.headers).length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setHeadersOpen((p) => !p)}
            className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            {headersOpen
              ? <ChevronUp   className="w-3 h-3" />
              : <ChevronDown className="w-3 h-3" />}
            Response headers ({Object.keys(out.headers).length})
          </button>
          {headersOpen && (
            <div className="mt-1 space-y-0.5 bg-slate-100 dark:bg-slate-800 rounded p-2">
              {Object.entries(out.headers).map(([k, v]) => (
                <div key={k} className="flex gap-1 text-[10px]">
                  <span className="text-slate-400 dark:text-slate-500 shrink-0 min-w-0">{k}:</span>
                  <span className="text-slate-500 dark:text-slate-400 break-all">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── LLM result ────────────────────────────────────────────────────────────────

function LLMResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as {
    content?: string;
    model?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  };

  return (
    <div className="p-3 space-y-3">
      {/* AI reply — the most important thing */}
      {out.content && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              AI Response
            </span>
            <CopyButton text={out.content} />
          </div>
          <div className="bg-slate-100 dark:bg-slate-800 rounded-md p-2.5 border-l-2 border-blue-500">
            <p className="text-xs text-gray-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
              {out.content}
            </p>
          </div>
        </div>
      )}

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/50 rounded px-2.5 py-2">
        {out.model && (
          <span>
            <span className="text-slate-500 dark:text-slate-400 font-medium">Model </span>
            {out.model}
          </span>
        )}
        {out.usage?.totalTokens != null && (
          <span>
            <span className="text-slate-500 dark:text-slate-400 font-medium">Tokens </span>
            {out.usage.totalTokens}
            {out.usage.promptTokens != null && (
              <span className="text-slate-600 ml-1">
                ({out.usage.promptTokens} prompt + {out.usage.completionTokens} reply)
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Condition result ──────────────────────────────────────────────────────────

function ConditionResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as { result?: boolean; nextNodeId?: string };
  const passed = out.result === true;

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className={`text-2xl font-bold ${passed ? 'text-emerald-400' : 'text-amber-400'}`}>
          {passed ? 'TRUE' : 'FALSE'}
        </span>
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
          {passed
            ? 'Condition was met — takes the true branch'
            : 'Condition was not met — takes the false branch'}
        </p>
      </div>
      {out.nextNodeId && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          <ArrowRight className="w-3 h-3 shrink-0" />
          Routes to node{' '}
          <span className="font-mono text-slate-500 dark:text-slate-400">{out.nextNodeId}</span>
        </div>
      )}
    </div>
  );
}

// ── Switch result ─────────────────────────────────────────────────────────────

function SwitchResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as { matchedCase?: string; nextNodeId?: string };
  const isDefault = !out.matchedCase || out.matchedCase === 'default';

  return (
    <div className="p-3 space-y-2">
      <div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
          Matched case
        </p>
        <span className={`inline-block px-2.5 py-1 rounded text-xs font-semibold ${
          isDefault
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700/40'
        }`}>
          {out.matchedCase ?? 'default'}
        </span>
      </div>
      {out.nextNodeId && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          <ArrowRight className="w-3 h-3 shrink-0" />
          Routes to{' '}
          <span className="font-mono text-slate-500 dark:text-slate-400">{out.nextNodeId}</span>
        </div>
      )}
    </div>
  );
}

// ── Shared result display utilities ──────────────────────────────────────────

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtBytes(bytes: number | string | undefined | null): string {
  if (bytes == null) return '—';
  const n = Number(bytes);
  if (isNaN(n)) return String(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
      {children}
    </p>
  );
}

function SuccessBanner({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg px-3 py-2.5">
      <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{text}</p>
        {sub && <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">{sub}</p>}
      </div>
    </div>
  );
}

function InfoRow({
  label, value, mono = false, url = false,
}: {
  label: string; value?: string | number | null; mono?: boolean; url?: boolean;
}) {
  if (value == null || value === '') return null;
  const str = String(value);
  return (
    <div className="flex gap-2 text-[11px] py-0.5">
      <span className="text-slate-600 dark:text-slate-300 font-medium shrink-0 w-20">{label}</span>
      {url ? (
        <a href={str} target="_blank" rel="noreferrer"
          className="text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300">
          Open ↗
        </a>
      ) : (
        <span className={`text-slate-800 dark:text-slate-100 break-all leading-snug ${mono ? 'font-mono text-[10px]' : ''}`}>
          {str}
        </span>
      )}
    </div>
  );
}

/** Recursively renders any value without raw JSON.stringify */
function SmartValue({ v, depth = 0 }: { v: unknown; depth?: number }) {
  if (v === null || v === undefined) {
    return <span className="text-slate-400 dark:text-slate-500 italic">—</span>;
  }
  if (typeof v === 'boolean') {
    return (
      <span className={`font-semibold ${v ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
        {v ? 'Yes' : 'No'}
      </span>
    );
  }
  if (typeof v === 'number') {
    return <span className="tabular-nums text-slate-800 dark:text-slate-100">{v.toLocaleString()}</span>;
  }
  if (typeof v === 'string') {
    if (v.startsWith('http://') || v.startsWith('https://')) {
      return (
        <a href={v} target="_blank" rel="noreferrer"
          className="text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300 break-all">
          {v}
        </a>
      );
    }
    return <span className="text-slate-800 dark:text-slate-100 break-all">{v}</span>;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-slate-500 dark:text-slate-400 italic">empty list</span>;
    if (depth > 0) return <span className="text-slate-600 dark:text-slate-300">[{v.length} item{v.length !== 1 ? 's' : ''}]</span>;
    return (
      <div className="space-y-1 mt-0.5">
        {v.slice(0, 3).map((item, i) => (
          <div key={i} className="bg-slate-200 dark:bg-slate-700 rounded px-2 py-1 text-[10px]">
            <SmartValue v={item} depth={depth + 1} />
          </div>
        ))}
        {v.length > 3 && <span className="text-[10px] text-slate-500 dark:text-slate-400">+{v.length - 3} more items</span>}
      </div>
    );
  }
  if (typeof v === 'object') {
    if (depth >= 2) {
      return <span className="text-slate-600 dark:text-slate-300 font-mono text-[10px]">{JSON.stringify(v)}</span>;
    }
    return (
      <div className="space-y-0.5 mt-0.5 pl-2 border-l-2 border-slate-300 dark:border-slate-500">
        {Object.entries(v as Record<string, unknown>).map(([k, val]) => (
          <div key={k} className="flex gap-2 text-[10px]">
            <span className="text-slate-600 dark:text-slate-300 font-medium shrink-0 min-w-[70px]">{k}</span>
            <SmartValue v={val} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-slate-800 dark:text-slate-100">{String(v)}</span>;
}

/** Shows first N items with a "Show all / Show less" toggle */
function ExpandableList<T>({
  items,
  renderItem,
  initialShow = 5,
  emptyText = 'No items found',
  countLabel,
}: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  initialShow?: number;
  emptyText?: string;
  countLabel: (n: number) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, initialShow);

  if (items.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-400 italic py-2">{emptyText}</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <SectionLabel>{countLabel(items.length)}</SectionLabel>
        {items.length > initialShow && (
          <button
            type="button"
            onClick={() => setShowAll((p) => !p)}
            className="text-[10px] text-blue-500 dark:text-blue-400 hover:underline"
          >
            {showAll ? 'Show less' : `Show all ${items.length}`}
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {visible.map((item, i) => <div key={i}>{renderItem(item, i)}</div>)}
      </div>
    </div>
  );
}

// ── Gmail helpers ─────────────────────────────────────────────────────────────

type GmailEmailItem = {
  id?: string; threadId?: string; subject?: string;
  from?: string; to?: string; date?: string; snippet?: string; body?: string;
};

/** Extracts a readable display name from "Full Name <email@domain>" or a plain address */
function senderName(from: string | undefined): string {
  if (!from) return '—';
  const m = from.match(/^([^<]+)<[^>]+>/);
  return m ? m[1].trim() : from.split('@')[0];
}

/** Single email card — used in flat list and inside thread expansion */
function GmailEmailCard({ email, indent = false }: { email: GmailEmailItem; indent?: boolean }) {
  const [showBody, setShowBody] = useState(false);
  const hasBody = Boolean(email.body?.trim());

  return (
    <div className={`space-y-1.5 ${indent ? 'px-4 py-3 bg-white dark:bg-slate-900/50' : 'bg-slate-100 dark:bg-slate-800 rounded-md px-3 py-2.5'}`}>
      {!indent && (
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-snug break-words">
          {email.subject || '(no subject)'}
        </p>
      )}
      <div className="flex items-start gap-2 text-[10px] flex-wrap">
        <span className="font-semibold text-slate-700 dark:text-slate-200 break-all">{email.from || '—'}</span>
        {email.date && (
          <span className="shrink-0 text-slate-500 dark:text-slate-400">{fmtDate(email.date)}</span>
        )}
      </div>

      {/* Snippet always shown as a quick preview */}
      {email.snippet && (
        <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed break-words italic">
          {email.snippet}
        </p>
      )}

      {/* Full body — collapsed by default, toggled per-card */}
      {hasBody && (
        <div>
          <button
            type="button"
            onClick={() => setShowBody((p) => !p)}
            className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showBody ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showBody ? 'Hide body' : 'Show full body'}
          </button>
          {showBody && (
            <pre className="mt-1.5 text-[10px] text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words bg-white dark:bg-slate-900/60 rounded p-2 border border-slate-200 dark:border-slate-700 overflow-auto">
              {email.body}
            </pre>
          )}
        </div>
      )}

      {email.id && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">ID: {email.id}</p>
      )}
    </div>
  );
}

/** Collapsible thread row — shown when ≥2 emails share the same threadId */
function GmailThreadAccordion({ messages }: { messages: GmailEmailItem[] }) {
  const [open, setOpen] = useState(false);
  const first        = messages[0];
  const last         = messages[messages.length - 1];
  const participants = [...new Set(messages.map((m) => senderName(m.from)).filter(Boolean))];

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-700/60 overflow-hidden">
      {/* Thread summary row — click to expand */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-start gap-3 px-3 py-2.5 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100/80 dark:hover:bg-blue-900/40 transition-colors text-left"
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 break-words leading-snug">
              {first.subject || '(no subject)'}
            </p>
            <span className="inline-flex items-center shrink-0 gap-1 bg-blue-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full leading-none">
              {messages.length} messages
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-300 flex-wrap">
            <span className="break-all">
              {participants.slice(0, 3).join(', ')}
              {participants.length > 3 && <span className="text-slate-500 dark:text-slate-400"> +{participants.length - 3} more</span>}
            </span>
            {last.date && (
              <span className="shrink-0 text-slate-500 dark:text-slate-400">Last: {fmtDate(last.date)}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 mt-0.5 text-blue-500 dark:text-blue-400">
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {/* Expanded: individual messages in chronological order */}
      {open && (
        <div className="divide-y divide-slate-200 dark:divide-slate-700/50">
          {messages.map((msg, i) => (
            <div key={i} className="relative pl-8">
              {/* Thread line */}
              {i < messages.length - 1 && (
                <div className="absolute left-4 top-0 bottom-0 w-px bg-blue-200 dark:bg-blue-800/60" />
              )}
              <div className="absolute left-3 top-3 w-2 h-2 rounded-full bg-blue-300 dark:bg-blue-600 border-2 border-white dark:border-slate-900" />
              <GmailEmailCard email={msg} indent />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Gmail result ──────────────────────────────────────────────────────────────

type GmailThreadItem = { threadId: string; messages: GmailEmailItem[] };

function GmailResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as Record<string, unknown>;

  // ── List action (new structure): output has a `threads` array ─────────────
  if (Array.isArray(out.threads)) {
    const threads        = out.threads as GmailThreadItem[];
    const totalMessages  = typeof out.totalMessages  === 'number' ? out.totalMessages  : threads.reduce((s, t) => s + t.messages.length, 0);
    const matchedMessages = typeof out.matchedMessages === 'number' ? out.matchedMessages : null;
    const threadedGroups = threads.filter((t) => t.messages.length > 1);
    const hasThreads     = threadedGroups.length > 0;

    return (
      <div className="p-3 space-y-2">
        {/* Summary */}
        <div className="flex items-center gap-2 flex-wrap">
          <SectionLabel>
            {threads.length} thread{threads.length !== 1 ? 's' : ''}
            {' · '}
            {totalMessages} message{totalMessages !== 1 ? 's' : ''}
            {matchedMessages !== null && matchedMessages !== totalMessages && (
              <span className="text-slate-500 dark:text-slate-400 font-normal">
                {' '}({matchedMessages} matched filter, {totalMessages - matchedMessages} pulled from threads)
              </span>
            )}
          </SectionLabel>
          {hasThreads && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
              {threadedGroups.length} thread{threadedGroups.length !== 1 ? 's have' : ' has'} multiple messages — click to expand
            </span>
          )}
        </div>

        {/* Threads / single emails */}
        <div className="space-y-2">
          {threads.map((thread, i) =>
            thread.messages.length === 1
              ? <GmailEmailCard key={i} email={thread.messages[0]} />
              : <GmailThreadAccordion key={i} messages={thread.messages} />
          )}
        </div>
      </div>
    );
  }

  // ── List action (legacy structure): output has a flat `messages` array ────
  if (Array.isArray(out.messages)) {
    const emails = out.messages as GmailEmailItem[];

    // Group by threadId; emails without threadId get their own pseudo-thread key
    const threadMap  = new Map<string, GmailEmailItem[]>();
    const threadOrder: string[] = [];
    emails.forEach((email) => {
      const tid = email.threadId ?? `__${email.id}`;
      if (!threadMap.has(tid)) { threadMap.set(tid, []); threadOrder.push(tid); }
      threadMap.get(tid)!.push(email);
    });

    const groups         = threadOrder.map((tid) => threadMap.get(tid)!);
    const threadedGroups = groups.filter((t) => t.length > 1);
    const hasThreads     = threadedGroups.length > 0;

    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SectionLabel>
            {emails.length} email{emails.length !== 1 ? 's' : ''}
            {hasThreads ? ` in ${groups.length} thread${groups.length !== 1 ? 's' : ''}` : ' found'}
          </SectionLabel>
          {hasThreads && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
              {threadedGroups.length} thread{threadedGroups.length !== 1 ? 's have' : ' has'} multiple messages — click to expand
            </span>
          )}
        </div>
        <div className="space-y-2">
          {groups.map((group, i) =>
            group.length === 1
              ? <GmailEmailCard key={i} email={group[0]} />
              : <GmailThreadAccordion key={i} messages={group} />
          )}
        </div>
      </div>
    );
  }

  // ── Get a Message / Read action ──────────────────────────────────────────
  if (out.body !== undefined && out.subject !== undefined) {
    const email = out as GmailEmailItem;
    return (
      <div className="p-3 space-y-2.5">
        <div className="bg-slate-100 dark:bg-slate-800 rounded-md p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
            {email.subject || '(no subject)'}
          </p>
          <div className="space-y-0.5 pb-2 border-b border-slate-200 dark:border-slate-700">
            <InfoRow label="From" value={email.from} />
            <InfoRow label="To"   value={email.to} />
            <InfoRow label="Date" value={fmtDate(email.date)} />
          </div>
          {email.body ? (
            <div>
              <SectionLabel>Message body</SectionLabel>
              <p className="mt-1 text-[11px] text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">{email.body}</p>
            </div>
          ) : email.snippet ? (
            <p className="text-[11px] text-slate-600 dark:text-slate-300 italic">{email.snippet}</p>
          ) : null}
        </div>
        {email.id && <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Message ID: {email.id}</p>}
      </div>
    );
  }

  // ── Mark as Read / Unread ────────────────────────────────────────────────
  if (out.markedAs !== undefined) {
    const markedAs    = String(out.markedAs);
    const isThread    = out.target === 'thread';
    const messageCount = typeof out.messageCount === 'number' ? out.messageCount : 0;

    const bannerText = isThread
      ? `Conversation marked as ${markedAs}${messageCount ? ` (${messageCount} ${messageCount === 1 ? 'message' : 'messages'})` : ''}`
      : `Message marked as ${markedAs}`;
    const bannerSub = isThread
      ? (out.threadId  ? `Thread ID: ${String(out.threadId)}`   : undefined)
      : (out.messageId ? `Message ID: ${String(out.messageId)}` : undefined);

    // For single-message mode, labelIds is a flat string array.
    // For thread mode, labelIds is an array of arrays (one per message) — flatten and dedupe.
    const flatLabels = Array.isArray(out.labelIds)
      ? Array.from(new Set(
          (out.labelIds as unknown[]).flatMap((l) => Array.isArray(l) ? l : [l]).filter((l) => typeof l === 'string') as string[]
        ))
      : [];

    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text={bannerText} sub={bannerSub} />
        {flatLabels.length > 0 && (
          <div className="space-y-0.5">
            <SectionLabel>Current labels{isThread ? ' (across thread)' : ''}</SectionLabel>
            <div className="flex flex-wrap gap-1 mt-1">
              {flatLabels.map((l) => (
                <span key={l} className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded px-1.5 py-0.5 font-mono">{l}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Add / Remove Label ───────────────────────────────────────────────────
  if (out.addedLabels !== undefined || out.removedLabels !== undefined) {
    const isAdd    = out.addedLabels !== undefined;
    const changed  = (isAdd ? out.addedLabels : out.removedLabels) as string[];
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text={isAdd ? 'Label(s) added' : 'Label(s) removed'} sub={out.messageId ? `Message ID: ${String(out.messageId)}` : undefined} />
        <div>
          <SectionLabel>{isAdd ? 'Added labels' : 'Removed labels'}</SectionLabel>
          <div className="flex flex-wrap gap-1 mt-1">
            {changed.map((l) => (
              <span key={l} className={`text-[10px] rounded px-1.5 py-0.5 font-mono ${isAdd ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300'}`}>{l}</span>
            ))}
          </div>
        </div>
        {Array.isArray(out.labelIds) && (
          <div>
            <SectionLabel>Current labels on message</SectionLabel>
            <div className="flex flex-wrap gap-1 mt-1">
              {(out.labelIds as string[]).map((l) => (
                <span key={l} className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded px-1.5 py-0.5 font-mono">{l}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Delete Conversation ──────────────────────────────────────────────────
  if (out.deleted === true && out.threadId !== undefined && out.draftId === undefined) {
    const perm  = Boolean(out.permanent);
    const count = out.messageCount != null ? Number(out.messageCount) : null;
    return (
      <div className="p-3 space-y-1.5">
        <SuccessBanner
          text={perm ? 'Conversation permanently deleted' : 'Conversation moved to Trash'}
          sub={out.threadId ? `Thread ID: ${String(out.threadId)}` : undefined}
        />
        {count !== null && (
          <InfoRow label="Messages removed" value={String(count)} />
        )}
        {perm && (
          <p className="text-[10px] text-red-500 dark:text-red-400">This action cannot be undone.</p>
        )}
      </div>
    );
  }

  // ── Delete Message ───────────────────────────────────────────────────────
  if (out.deleted === true && out.draftId === undefined) {
    const perm = Boolean(out.permanent);
    return (
      <div className="p-3 space-y-1.5">
        <SuccessBanner
          text={perm ? 'Message permanently deleted' : 'Message moved to Trash'}
          sub={out.messageId ? `Message ID: ${String(out.messageId)}` : undefined}
        />
        {perm && (
          <p className="text-[10px] text-red-500 dark:text-red-400">This action cannot be undone.</p>
        )}
      </div>
    );
  }

  // ── Reply action ─────────────────────────────────────────────────────────
  if (out.repliedTo !== undefined) {
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text="Reply sent successfully" sub={out.messageId ? `Message ID: ${String(out.messageId)}` : undefined} />
        <div className="space-y-0.5">
          <InfoRow label="Thread ID"    value={out.threadId  ? String(out.threadId)  : undefined} mono />
          <InfoRow label="Replied to"   value={out.repliedTo ? String(out.repliedTo) : undefined} mono />
        </div>
      </div>
    );
  }

  // ── Send & Wait ──────────────────────────────────────────────────────────
  if (out.replied !== undefined) {
    const replied = Boolean(out.replied);
    return (
      <div className="p-3 space-y-2">
        {replied ? (
          <>
            <SuccessBanner text="Reply received!" sub={out.replyMessageId ? `Reply ID: ${String(out.replyMessageId)}` : undefined} />
            <div className="bg-slate-100 dark:bg-slate-800 rounded-md p-3 space-y-1.5">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{out.replySubject ? String(out.replySubject) : '(no subject)'}</p>
              <InfoRow label="From"    value={out.replyFrom ? String(out.replyFrom) : undefined} />
              <InfoRow label="Date"    value={out.replyDate ? fmtDate(String(out.replyDate)) : undefined} />
              {!!out.replySnippet && <p className="text-[10px] text-slate-600 dark:text-slate-300 italic pt-1">{String(out.replySnippet)}</p>}
            </div>
          </>
        ) : (
          <div className="flex gap-2 rounded-md border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
            <Info className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">No reply received — timed out</p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400">The email was sent but no reply arrived within the wait window.</p>
              {!!out.sentMessageId && <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Sent ID: {String(out.sentMessageId)}</p>}
              {!!out.threadId      && <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Thread: {String(out.threadId)}</p>}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Create Draft ─────────────────────────────────────────────────────────
  if (out.draftId !== undefined && out.messageId !== undefined && out.subject === undefined) {
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text="Draft created" />
        <div className="space-y-0.5">
          <InfoRow label="Draft ID"   value={String(out.draftId)}   mono />
          <InfoRow label="Message ID" value={String(out.messageId)} mono />
        </div>
      </div>
    );
  }

  // ── Get a Draft ──────────────────────────────────────────────────────────
  if (out.draftId !== undefined && out.subject !== undefined) {
    return (
      <div className="p-3 space-y-2.5">
        <div className="bg-slate-100 dark:bg-slate-800 rounded-md p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{out.subject ? String(out.subject) : '(no subject)'}</p>
          <div className="space-y-0.5 pb-2 border-b border-slate-200 dark:border-slate-700">
            <InfoRow label="To"   value={out.to   ? String(out.to)   : undefined} />
            <InfoRow label="From" value={out.from ? String(out.from) : undefined} />
            <InfoRow label="Date" value={out.date ? fmtDate(String(out.date)) : undefined} />
          </div>
          {out.body ? (
            <div>
              <SectionLabel>Body</SectionLabel>
              <p className="mt-1 text-[11px] text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">{String(out.body)}</p>
            </div>
          ) : !!out.snippet && (
            <p className="text-[11px] text-slate-600 dark:text-slate-300 italic">{String(out.snippet)}</p>
          )}
        </div>
        <InfoRow label="Draft ID" value={out.draftId ? String(out.draftId) : undefined} mono />
      </div>
    );
  }

  // ── Get Many Drafts ──────────────────────────────────────────────────────
  if (Array.isArray(out.drafts)) {
    type DraftItem = { draftId?: string; messageId?: string; subject?: string; to?: string; from?: string; date?: string; snippet?: string };
    const drafts = out.drafts as DraftItem[];
    return (
      <div className="p-3 space-y-2">
        <SectionLabel>{drafts.length} draft{drafts.length !== 1 ? 's' : ''} found</SectionLabel>
        <div className="space-y-2">
          {drafts.map((d, i) => (
            <div key={i} className="bg-slate-100 dark:bg-slate-800 rounded-md px-3 py-2.5 space-y-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{d.subject || '(no subject)'}</p>
              <div className="flex items-start gap-2 text-[10px] flex-wrap">
                {d.to   && <span className="text-slate-700 dark:text-slate-200 break-all">To: {d.to}</span>}
                {d.date && <span className="shrink-0 text-slate-500 dark:text-slate-400">{fmtDate(d.date)}</span>}
              </div>
              {d.snippet && <p className="text-[10px] text-slate-600 dark:text-slate-300 italic break-words">{d.snippet}</p>}
              {d.draftId && <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Draft ID: {d.draftId}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Delete Draft ─────────────────────────────────────────────────────────
  if (out.deleted === true && out.draftId !== undefined) {
    return (
      <div className="p-3">
        <SuccessBanner text="Draft deleted" sub={`Draft ID: ${String(out.draftId)}`} />
      </div>
    );
  }

  // ── Send / fallback ──────────────────────────────────────────────────────
  const sent = out as { messageId?: string };
  return (
    <div className="p-3">
      <SuccessBanner text="Email sent successfully" sub={sent.messageId ? `Message ID: ${sent.messageId}` : undefined} />
    </div>
  );
}

// ── Google Drive result ───────────────────────────────────────────────────────

function GDriveResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as Record<string, unknown>;

  // List action
  if (Array.isArray(out.files)) {
    type DriveFile = {
      id?: string; name?: string; mimeType?: string;
      size?: string | number; modifiedTime?: string; webViewLink?: string;
    };
    const files = out.files as DriveFile[];
    const isFolder = (f: DriveFile) => f.mimeType === 'application/vnd.google-apps.folder';
    return (
      <div className="p-3 space-y-2">
        <ExpandableList
          items={files}
          countLabel={(n) => `${n} item${n !== 1 ? 's' : ''} found`}
          initialShow={6}
          emptyText="No files or folders matched the query"
          renderItem={(file) => (
            <div className="bg-slate-100 dark:bg-slate-800 rounded-md px-3 py-2 flex items-center gap-3">
              <span className="text-base flex-shrink-0">{isFolder(file) ? '📁' : '📄'}</span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 break-words">
                  {file.name || 'Untitled'}
                </p>
                <div className="flex gap-3 text-[10px] text-slate-600 dark:text-slate-300">
                  {file.size != null && <span>{fmtBytes(file.size)}</span>}
                  {file.modifiedTime && <span>Modified {fmtDate(file.modifiedTime)}</span>}
                </div>
              </div>
              {file.webViewLink && (
                <a href={file.webViewLink} target="_blank" rel="noreferrer"
                  className="text-[10px] text-blue-500 hover:underline shrink-0">Open ↗</a>
              )}
            </div>
          )}
        />
      </div>
    );
  }

  // Download action
  if (out.content !== undefined) {
    const dl = out as { name?: string; mimeType?: string; content?: string };
    return (
      <div className="p-3 space-y-2.5">
        <SuccessBanner text={`Downloaded: ${dl.name || 'file'}`} sub={dl.mimeType} />
        {dl.content && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <SectionLabel>Content preview</SectionLabel>
              <CopyButton text={dl.content} />
            </div>
            <pre className="bg-slate-100 dark:bg-slate-800 rounded p-2.5 text-[10px] text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
              {dl.content}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Delete actions
  if (out.deleted) {
    const del = out as { name?: string; fileId?: string; folderId?: string; permanent?: boolean; movedToTrash?: boolean };
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner
          text={del.permanent ? 'Permanently deleted' : 'Moved to Trash'}
          sub={del.name}
        />
        {(del.fileId || del.folderId) && (
          <InfoRow label="ID" value={(del.fileId ?? del.folderId) as string} mono />
        )}
      </div>
    );
  }

  // Share — grant access
  if (out.shared) {
    const sh = out as { targetId?: string; role?: string; type?: string; email?: string; permissionId?: string };
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text="Shared successfully" />
        <InfoRow label="Target ID"     value={sh.targetId}     mono />
        <InfoRow label="Role"          value={sh.role} />
        <InfoRow label="Type"          value={sh.type} />
        {sh.email && <InfoRow label="Email" value={sh.email} />}
        <InfoRow label="Permission ID" value={sh.permissionId} mono />
      </div>
    );
  }

  // Share — restrict access
  if (out.restricted) {
    const rs = out as {
      targetId?: string;
      removedEmail?: string;
      removedType?: string;
      removedCount?: number;
      permissionId?: string;
      note?: string;
    };
    const summary = rs.removedEmail
      ? `Access removed for ${rs.removedEmail}`
      : rs.removedType === 'anyone'
        ? 'Public link access removed'
        : typeof rs.removedCount === 'number'
          ? `Made private — ${rs.removedCount} permission${rs.removedCount !== 1 ? 's' : ''} removed`
          : 'Access restricted';
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text={summary} />
        <InfoRow label="Target ID" value={rs.targetId} mono />
        {rs.removedEmail   && <InfoRow label="Removed user"    value={rs.removedEmail} />}
        {rs.removedType    && <InfoRow label="Removed type"    value={rs.removedType} />}
        {typeof rs.removedCount === 'number' && <InfoRow label="Permissions removed" value={String(rs.removedCount)} />}
        {rs.permissionId   && <InfoRow label="Permission ID"   value={rs.permissionId} mono />}
        {rs.note           && <InfoRow label="Note"            value={rs.note} />}
      </div>
    );
  }

  // Move action
  if (out.movedTo) {
    const mv = out as { fileId?: string; name?: string; movedTo?: string };
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text={`Moved: ${mv.name || 'file'}`} />
        <InfoRow label="File ID"    value={mv.fileId}  mono />
        <InfoRow label="Moved into" value={mv.movedTo} mono />
      </div>
    );
  }

  // Rename action
  if (out.newName) {
    const rn = out as { fileId?: string; newName?: string; webViewLink?: string };
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text={`Renamed to: ${rn.newName}`} />
        <InfoRow label="File ID" value={rn.fileId} mono />
        {rn.webViewLink && <InfoRow label="Link" value={rn.webViewLink} url />}
      </div>
    );
  }

  // Create folder action
  if (out.folderId) {
    const cf = out as { folderId?: string; name?: string; webViewLink?: string };
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text={`Folder created: ${cf.name}`} />
        <InfoRow label="Folder ID" value={cf.folderId} mono />
        {cf.webViewLink && <InfoRow label="Link" value={cf.webViewLink} url />}
      </div>
    );
  }

  // Upload / create_file / copy_file (generic file result with id + name)
  const up = out as { name?: string; id?: string; webViewLink?: string };
  return (
    <div className="p-3 space-y-2">
      <SuccessBanner text={up.name ? `Done: ${up.name}` : 'Operation successful'} />
      {up.id && <InfoRow label="File ID" value={up.id} mono />}
      {up.webViewLink && <InfoRow label="Link" value={up.webViewLink} url />}
    </div>
  );
}

// ── Google Docs result ────────────────────────────────────────────────────────

function GDocsResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as Record<string, unknown>;
  const doc = out as {
    documentId?: string; title?: string; text?: string;
    url?: string; appended?: string; endIndex?: number;
  };

  // Append action
  if (doc.appended !== undefined) {
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text="Text appended to document" sub={doc.documentId} />
        <div className="space-y-1">
          <SectionLabel>Appended text</SectionLabel>
          <p className="text-[11px] text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded p-2.5 whitespace-pre-wrap leading-relaxed mt-0.5">
            {doc.appended}
          </p>
        </div>
      </div>
    );
  }

  // Read action
  if (doc.text !== undefined) {
    return (
      <div className="p-3 space-y-2.5">
        <div className="space-y-0.5">
          <InfoRow label="Title"  value={doc.title} />
          <InfoRow label="Doc ID" value={doc.documentId} mono />
        </div>
        {doc.text ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <SectionLabel>Document content</SectionLabel>
              <CopyButton text={doc.text} />
            </div>
            <pre className="bg-slate-100 dark:bg-slate-800 rounded p-2.5 text-[11px] text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
              {doc.text}
            </pre>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">Document is empty</p>
        )}
      </div>
    );
  }

  // Create action
  return (
    <div className="p-3 space-y-2">
      <SuccessBanner text={`Document created: ${doc.title || 'Untitled'}`} />
      <InfoRow label="Doc ID" value={doc.documentId} mono />
      {doc.url && <InfoRow label="Edit link" value={doc.url} url />}
    </div>
  );
}

// ── Google Sheets result ──────────────────────────────────────────────────────

function GSheetsResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as Record<string, unknown>;
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 8;

  // Read action — has `headers`
  if (out.headers !== undefined) {
    const headers   = (out.headers as string[]) ?? [];
    const data      = (out.data as Record<string, unknown>[]) ?? [];
    const rawRows   = (out.rows as unknown[][]) ?? [];
    const bodyRows  = data.length > 0 ? data : rawRows.slice(1);
    const displayed = showAll ? bodyRows : bodyRows.slice(0, LIMIT);

    return (
      <div className="p-3 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
            {bodyRows.length} row{bodyRows.length !== 1 ? 's' : ''}
          </span>
          <span className="text-slate-400 dark:text-slate-500">·</span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {headers.length} column{headers.length !== 1 ? 's' : ''}
          </span>
          {!!out.range && (
            <>
              <span className="text-slate-400 dark:text-slate-500">·</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{String(out.range)}</span>
            </>
          )}
        </div>

        {headers.length > 0 && (
          <div className="overflow-auto rounded border border-slate-200 dark:border-slate-700">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-slate-200 dark:bg-slate-700">
                  {headers.map((h, i) => (
                    <th key={i} className="text-left px-2.5 py-1.5 text-slate-700 dark:text-slate-200 font-semibold whitespace-nowrap border-r border-slate-300 dark:border-slate-600 last:border-r-0">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((row, ri) => {
                  const cells: unknown[] = data.length > 0
                    ? headers.map((h) => (row as Record<string, unknown>)[h])
                    : (row as unknown[]);
                  return (
                    <tr key={ri} className="border-t border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      {cells.map((cell, ci) => (
                        <td key={ci} className="px-2.5 py-1.5 text-slate-800 dark:text-slate-100 border-r border-slate-200 dark:border-slate-700 last:border-r-0 whitespace-nowrap">
                          {cell == null
                            ? <span className="text-slate-400 dark:text-slate-500">—</span>
                            : String(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {bodyRows.length > LIMIT && (
              <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowAll((p) => !p)}
                  className="text-[10px] text-blue-500 dark:text-blue-400 hover:underline"
                >
                  {showAll ? 'Show fewer rows' : `Show all ${bodyRows.length} rows`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Write / append action
  const w = out as {
    updatedRows?: number; updatedColumns?: number; updatedCells?: number;
    updatedRange?: string; tableRange?: string;
  };
  const stats = [
    { label: 'Rows',    value: w.updatedRows },
    { label: 'Columns', value: w.updatedColumns },
    { label: 'Cells',   value: w.updatedCells },
  ].filter((s) => s.value != null);

  return (
    <div className="p-3 space-y-2">
      <SuccessBanner text="Spreadsheet updated" />
      {stats.length > 0 && (
        <div className={`grid gap-2 text-center`} style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
          {stats.map(({ label, value }) => (
            <div key={label} className="bg-slate-100 dark:bg-slate-800 rounded p-2">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">{value}</p>
              <p className="text-[10px] text-slate-600 dark:text-slate-300">{label} updated</p>
            </div>
          ))}
        </div>
      )}
      {(w.updatedRange ?? w.tableRange) && (
        <InfoRow label="Range" value={w.updatedRange ?? w.tableRange} mono />
      )}
    </div>
  );
}

// ── Slack thread accordion ────────────────────────────────────────────────────

type SlackMsgItem = {
  ts?: string; formattedDate?: string; text?: string;
  senderName?: string; hasFiles?: boolean; isParent?: boolean;
  files?: Array<{ id?: unknown; name?: unknown; mimeType?: unknown; url?: unknown; isImage?: boolean }>;
};

function SlackThreadAccordion({ parent, replies }: { parent: SlackMsgItem; replies: SlackMsgItem[] }) {
  const [open, setOpen] = useState(false);

  const renderMsgBody = (m: SlackMsgItem, highlight = false) => (
    <div className={`space-y-1 ${highlight ? 'bg-violet-50 dark:bg-violet-950/20' : 'bg-white dark:bg-slate-900/50'} px-3 py-2.5`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">
          {m.senderName ? `@${m.senderName}` : '(unknown sender)'}
        </span>
        {m.formattedDate && (
          <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono whitespace-nowrap">{m.formattedDate}</span>
        )}
      </div>
      <p className="text-xs text-slate-800 dark:text-slate-100 leading-snug break-words">
        {m.text || <span className="italic text-slate-400">(no text)</span>}
      </p>
      {m.hasFiles && (
        <span className="text-[9px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">📎 Attachment</span>
      )}
    </div>
  );

  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-800/50 overflow-hidden">
      {renderMsgBody(parent, true)}

      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-violet-100/60 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors text-left border-t border-violet-200 dark:border-violet-800/40"
      >
        {open
          ? <ChevronUp   className="w-3 h-3 text-violet-500 dark:text-violet-400" />
          : <ChevronDown className="w-3 h-3 text-violet-500 dark:text-violet-400" />}
        <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'} in thread
        </span>
      </button>

      {open && (
        <div className="divide-y divide-slate-200 dark:divide-slate-700/50">
          {replies.map((r, i) => (
            <div key={i} className="relative pl-8">
              {i < replies.length - 1 && (
                <div className="absolute left-4 top-0 bottom-0 w-px bg-violet-200 dark:bg-violet-800/40" />
              )}
              <div className="absolute left-3 top-3 w-2 h-2 rounded-full bg-violet-300 dark:bg-violet-600 border-2 border-white dark:border-slate-900" />
              {renderMsgBody(r)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Slack result ──────────────────────────────────────────────────────────────

function SlackResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as Record<string, unknown>;

  // ── Read Thread ────────────────────────────────────────────────────────────
  // Detected by the presence of threadTs alongside a messages array
  if (Array.isArray(out.messages) && out.threadTs !== undefined) {
    const msgs    = out.messages as SlackMsgItem[];
    const parent  = msgs.find((m) => m.isParent) ?? msgs[0];
    const replies = msgs.filter((m) => !m.isParent);

    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Thread</span>
          <span className="text-[9px] bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded-full font-semibold">
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </span>
        </div>
        {parent && <SlackThreadAccordion parent={parent} replies={replies} />}
      </div>
    );
  }

  // ── Read Messages ──────────────────────────────────────────────────────────
  if (Array.isArray(out.messages)) {
    type SlackFile = { id?: unknown; name?: unknown; mimeType?: unknown; url?: unknown; isImage?: boolean };
    type SlackMsg  = {
      ts?: string; formattedDate?: string; text?: string;
      senderName?: string; userId?: string;
      replyCount?: number; threadTs?: string;
      hasFiles?: boolean; files?: SlackFile[];
    };
    const msgs      = out.messages as SlackMsg[];
    const hasThread = msgs.some((m) => (m.replyCount ?? 0) > 0);

    return (
      <div className="p-3 space-y-2">
        {hasThread && (
          <div className="flex items-center gap-2 rounded-md bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 px-3 py-2">
            <Info className="w-3 h-3 text-indigo-500 dark:text-indigo-400 shrink-0" />
            <p className="text-[10px] text-indigo-700 dark:text-indigo-300 font-medium">
              Some messages have thread replies. Use the <strong>Read Thread</strong> action with the message&apos;s <code className="font-mono bg-indigo-100 dark:bg-indigo-800/50 px-0.5 rounded">ts</code> to view replies.
            </p>
          </div>
        )}
        <ExpandableList
          items={msgs}
          countLabel={(n) => `${n} message${n !== 1 ? 's' : ''} · oldest → newest`}
          initialShow={10}
          emptyText="No messages found"
          renderItem={(m) => (
            <div className="bg-slate-100 dark:bg-slate-800 rounded-md px-3 py-2.5 space-y-1">
              {/* Header row: sender + timestamp */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">
                  {m.senderName ? `@${m.senderName}` : '(unknown sender)'}
                </span>
                {m.formattedDate && (
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono whitespace-nowrap">
                    {m.formattedDate}
                  </span>
                )}
              </div>
              {/* Message body */}
              <p className="text-xs text-slate-800 dark:text-slate-100 leading-snug break-words">
                {m.text || <span className="italic text-slate-400">(no text)</span>}
              </p>
              {/* File / attachment indicator */}
              {m.hasFiles && (
                <div className="space-y-1 pt-0.5">
                  {(m.files ?? []).length > 0 ? (
                    (m.files!).map((f, fi) => (
                      <div key={fi} className="flex items-center gap-1.5">
                        {f.isImage ? (
                          <span className="text-[9px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-semibold">🖼 Image</span>
                        ) : (
                          <span className="text-[9px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded font-semibold">📎 File</span>
                        )}
                        {!!f.name && <span className="text-[9px] text-slate-500 dark:text-slate-400 truncate">{String(f.name)}</span>}
                        {!!f.url && (
                          <a href={String(f.url)} target="_blank" rel="noopener noreferrer"
                            className="text-[9px] text-blue-500 hover:underline truncate ml-auto">
                            View
                          </a>
                        )}
                      </div>
                    ))
                  ) : (
                    <span className="text-[9px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">📎 Attachment</span>
                  )}
                </div>
              )}
              {/* Thread badge */}
              {(m.replyCount ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[9px] font-bold px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-700/50">
                    🧵 {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">— use Read Thread to view</span>
                </div>
              )}
            </div>
          )}
        />
      </div>
    );
  }

  // ── List Users ─────────────────────────────────────────────────────────────
  if (Array.isArray(out.users)) {
    type SlackUser = { id: string; displayName?: string; realName?: string; name?: string; email?: string; isBot?: boolean };
    const users = out.users as SlackUser[];
    return (
      <div className="p-3 space-y-2">
        <ExpandableList
          items={users}
          countLabel={(n) => `${n} user${n !== 1 ? 's' : ''}`}
          initialShow={10}
          emptyText="No users found"
          renderItem={(u) => (
            <div className="bg-slate-100 dark:bg-slate-800 rounded-md px-2.5 py-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {u.displayName || u.realName || u.name}
                  {u.isBot && <span className="ml-1 text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1 rounded">bot</span>}
                </p>
                {u.email && <p className="text-[9px] text-slate-400 dark:text-slate-500 truncate">{u.email}</p>}
              </div>
              <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 shrink-0">{u.id}</span>
            </div>
          )}
        />
      </div>
    );
  }

  // ── List Channels ──────────────────────────────────────────────────────────
  if (Array.isArray(out.channels)) {
    type SlackChannel = { id: string; name: string; isPrivate?: boolean; isMember?: boolean; memberCount?: number };
    const channels = out.channels as SlackChannel[];
    return (
      <div className="p-3 space-y-2">
        <ExpandableList
          items={channels}
          countLabel={(n) => `${n} channel${n !== 1 ? 's' : ''}`}
          initialShow={10}
          emptyText="No channels found"
          renderItem={(c) => (
            <div className="bg-slate-100 dark:bg-slate-800 rounded-md px-2.5 py-1.5 flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{c.isPrivate ? '🔒' : '#'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{c.name}</p>
                <p className="text-[9px] text-slate-400 dark:text-slate-500">{c.id}{c.memberCount != null ? ` · ${c.memberCount} members` : ''}</p>
              </div>
              {c.isMember && (
                <span className="text-[9px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded shrink-0">joined</span>
              )}
            </div>
          )}
        />
      </div>
    );
  }

  // ── File Upload ────────────────────────────────────────────────────────────
  if (out.fileId !== undefined) {
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text={`File uploaded: ${out.filename ?? 'file'}`} />
        <InfoRow label="File ID"  value={String(out.fileId  ?? '')} mono />
        {!!out.mimeType && <InfoRow label="MIME type" value={String(out.mimeType)} />}
      </div>
    );
  }

  // ── Send Message / DM (single) ─────────────────────────────────────────────
  if (out.results !== undefined) {
    // Multi-recipient result
    type MultiResult = { ok?: boolean; channel?: string; ts?: string; userId?: string };
    const results = out.results as MultiResult[];
    return (
      <div className="p-3 space-y-2">
        <SuccessBanner text={`Sent to ${results.length} recipient${results.length !== 1 ? 's' : ''}`} />
        {results.map((r, i) => (
          <div key={i} className="bg-slate-100 dark:bg-slate-800 rounded-md px-2.5 py-1.5 space-y-0.5 text-[10px]">
            {r.channel && <InfoRow label="Channel" value={String(r.channel)} />}
            {r.userId  && <InfoRow label="User"    value={String(r.userId)}  />}
            {r.ts      && <InfoRow label="ts"      value={String(r.ts)} mono />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <SuccessBanner text="Message sent to Slack" />
      <div className="space-y-0.5">
        {!!out.channel && <InfoRow label="Channel"   value={String(out.channel)} />}
        {!!out.ts      && <InfoRow label="Timestamp" value={String(out.ts)} mono />}
      </div>
    </div>
  );
}

// ── Teams helpers ─────────────────────────────────────────────────────────────

type TeamsMsgItem = { id?: string; text?: string; from?: string; createdAt?: string; replyToId?: string };

/** A single Teams message card */
function TeamsMessageCard({ msg, indent = false }: { msg: TeamsMsgItem; indent?: boolean }) {
  return (
    <div className={`space-y-0.5 ${indent ? 'px-4 py-2.5 bg-white dark:bg-slate-900/50' : 'bg-slate-100 dark:bg-slate-800 rounded-md px-3 py-2.5'}`}>
      {msg.from && (
        <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{msg.from}</p>
      )}
      <p className="text-xs text-slate-800 dark:text-slate-100 leading-snug break-words">{msg.text || '(no text)'}</p>
      {msg.createdAt && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">{fmtDate(msg.createdAt)}</p>
      )}
    </div>
  );
}

/** Collapsible thread for a Teams parent message + its replies */
function TeamsThreadAccordion({ message, replies }: { message: TeamsMsgItem; replies: TeamsMsgItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-800/50 overflow-hidden">
      {/* Parent message row */}
      <div className="bg-violet-50 dark:bg-violet-950/20 px-3 py-2.5 space-y-0.5">
        {message.from && (
          <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">{message.from}</p>
        )}
        <p className="text-xs text-slate-800 dark:text-slate-100 leading-snug break-words">
          {message.text || '(no text)'}
        </p>
        {message.createdAt && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400">{fmtDate(message.createdAt)}</p>
        )}
      </div>

      {/* Reply toggle */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-violet-100/60 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors text-left border-t border-violet-200 dark:border-violet-800/40"
      >
        {open ? <ChevronUp className="w-3 h-3 text-violet-500 dark:text-violet-400" /> : <ChevronDown className="w-3 h-3 text-violet-500 dark:text-violet-400" />}
        <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'} in thread
        </span>
      </button>

      {/* Replies */}
      {open && (
        <div className="divide-y divide-slate-200 dark:divide-slate-700/50">
          {replies.map((r, i) => (
            <div key={i} className="relative pl-8">
              {i < replies.length - 1 && (
                <div className="absolute left-4 top-0 bottom-0 w-px bg-violet-200 dark:bg-violet-800/40" />
              )}
              <div className="absolute left-3 top-3 w-2 h-2 rounded-full bg-violet-300 dark:bg-violet-600 border-2 border-white dark:border-slate-900" />
              <TeamsMessageCard msg={r} indent />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Teams result ──────────────────────────────────────────────────────────────

function TeamsResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as Record<string, unknown>;

  // ── Read Thread action ─────────────────────────────────────────────────────
  if (out.parent !== undefined && !Array.isArray(out.messages)) {
    const parent  = out.parent  as TeamsMsgItem;
    const replies = (out.replies as TeamsMsgItem[]) ?? [];
    return (
      <div className="p-3 space-y-2">
        <SectionLabel>
          Thread · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </SectionLabel>
        <TeamsThreadAccordion message={parent} replies={replies} />
      </div>
    );
  }

  // ── Read messages action ───────────────────────────────────────────────────
  if (Array.isArray(out.messages)) {
    const msgs     = out.messages as TeamsMsgItem[];
    const topLevel = msgs.filter((m) => !m.replyToId);
    const replies  = msgs.filter((m) => !!m.replyToId);

    // Build a map from parent ID → replies
    const replyMap = new Map<string, TeamsMsgItem[]>();
    replies.forEach((r) => {
      const pid = r.replyToId!;
      if (!replyMap.has(pid)) replyMap.set(pid, []);
      replyMap.get(pid)!.push(r);
    });

    const hasThreads = replies.length > 0;

    return (
      <div className="p-3 space-y-2">
        <SectionLabel>
          {msgs.length} message{msgs.length !== 1 ? 's' : ''}
          {hasThreads && ` (${replies.length} ${replies.length === 1 ? 'reply' : 'replies'} in threads)`}
        </SectionLabel>

        <div className="space-y-2">
          {topLevel.map((msg, i) => {
            const msgReplies = replyMap.get(String(msg.id)) ?? [];
            return msgReplies.length > 0
              ? <TeamsThreadAccordion key={i} message={msg} replies={msgReplies} />
              : <TeamsMessageCard     key={i} msg={msg} />;
          })}

          {/* Orphaned replies — parent not in this result set */}
          {replies
            .filter((r) => !topLevel.find((t) => String(t.id) === r.replyToId))
            .map((r, i) => (
              <div key={`orphan-${i}`} className="relative pl-7">
                <div className="absolute left-3 top-3 w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 border-2 border-white dark:border-slate-900" />
                <div className="absolute left-4 top-0 h-full w-px bg-slate-200 dark:bg-slate-700" />
                <TeamsMessageCard msg={r} />
              </div>
            ))}
        </div>
      </div>
    );
  }

  // Send message / DM
  const msg = out as { id?: string; teamId?: string; channelId?: string; chatId?: string; createdAt?: string };
  return (
    <div className="p-3 space-y-2">
      <SuccessBanner
        text="Message sent to Teams"
        sub={msg.createdAt ? `Sent at ${fmtDate(msg.createdAt)}` : undefined}
      />
      <div className="space-y-0.5">
        {msg.teamId    && <InfoRow label="Team ID"    value={msg.teamId} mono />}
        {msg.channelId && <InfoRow label="Channel ID" value={msg.channelId} mono />}
        {msg.chatId    && <InfoRow label="Chat ID"    value={msg.chatId} mono />}
        {msg.id        && <InfoRow label="Message ID" value={msg.id} mono />}
      </div>
    </div>
  );
}

// ── Basecamp result ───────────────────────────────────────────────────────────

function BasecampResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as Record<string, unknown>;

  // List organizations action
  if (Array.isArray(out.organizations)) {
    type Org = { id?: unknown; name?: string };
    const orgs = out.organizations as Org[];
    return (
      <div className="p-3 space-y-2">
        <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          {orgs.length} organization{orgs.length !== 1 ? 's' : ''}
        </div>
        <ExpandableList
          items={orgs}
          countLabel={() => ''}
          initialShow={10}
          emptyText="No organizations found"
          renderItem={(org) => (
            <div className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-800 rounded-md px-3 py-2">
              <span className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-[10px] font-bold text-green-700 dark:text-green-300 shrink-0">
                {(org.name ?? '?').charAt(0).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-800 dark:text-slate-100 leading-snug">{org.name ?? '(unnamed)'}</p>
                {org.id != null && <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">ID {String(org.id)}</p>}
              </div>
            </div>
          )}
        />
      </div>
    );
  }

  // List todos action
  if (Array.isArray(out.todos)) {
    type Todo = { id?: unknown; title?: string; completed?: boolean; dueOn?: string; _groupName?: string };
    const todos = out.todos as Todo[];
    const done  = todos.filter((t) => t.completed).length;
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{todos.length} to-do{todos.length !== 1 ? 's' : ''}</span>
          {done > 0 && (
            <>
              <span className="text-slate-400 dark:text-slate-500">·</span>
              <span className="text-emerald-600 dark:text-emerald-400">{done} completed</span>
            </>
          )}
        </div>
        <ExpandableList
          items={todos}
          countLabel={() => ''}
          initialShow={8}
          emptyText="No to-dos found"
          renderItem={(todo) => (
            <div className="flex items-start gap-2.5 bg-slate-100 dark:bg-slate-800 rounded-md px-3 py-2">
              <span className={`mt-0.5 shrink-0 w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                todo.completed
                  ? 'bg-emerald-400 border-emerald-400'
                  : 'border-slate-400 dark:border-slate-500'
              }`} />
              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-snug ${
                  todo.completed
                    ? 'line-through text-slate-400 dark:text-slate-500'
                    : 'text-slate-800 dark:text-slate-100'
                }`}>
                  {todo.title || '(untitled)'}
                </p>
                <div className="flex gap-2 mt-0.5 text-[10px] text-slate-600 dark:text-slate-300">
                  {todo._groupName && <span>{todo._groupName}</span>}
                  {todo.dueOn      && <span>Due {todo.dueOn}</span>}
                </div>
              </div>
            </div>
          )}
        />
      </div>
    );
  }

  // Single-action results (create, complete, post message, comment, campfire)
  const single = out as {
    id?: unknown; title?: string; subject?: string;
    status?: string; completed?: boolean; todoId?: string;
  };

  const statusLabels: Record<string, string> = {
    created:   'To-do created',
    posted:    'Message posted to Basecamp',
    commented: 'Comment added',
    sent:      'Campfire message sent',
    invited:   'Invitation sent',
  };

  const bannerText = single.status
    ? (statusLabels[single.status] ?? `Done — ${single.status}`)
    : single.completed === true
      ? 'To-do marked as complete ✓'
      : single.completed === false
        ? 'To-do marked as incomplete'
        : 'Action completed';

  const richSingle = out as {
    id?: unknown; title?: string; subject?: string;
    description?: string; appUrl?: string; url?: string;
    dueOn?: string; assignees?: Array<{ id: unknown; name: string; email?: string }>;
    createdAt?: string; projectId?: string; todolistId?: string;
    status?: string; completed?: boolean; todoId?: string;
    // invite_users
    name?: string; email?: string; company?: string;
  };

  return (
    <div className="p-3 space-y-2">
      <SuccessBanner text={bannerText} />
      <div className="space-y-0.5">
        {richSingle.title       && <InfoRow label="Title"       value={richSingle.title} />}
        {richSingle.description && <InfoRow label="Description" value={richSingle.description} />}
        {richSingle.id != null  && <InfoRow label="ID"          value={String(richSingle.id)} mono />}
        {richSingle.appUrl      && (
          <div className="flex items-start gap-2 py-0.5">
            <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 w-24">Link</span>
            <a href={richSingle.appUrl} target="_blank" rel="noopener noreferrer"
               className="text-[11px] text-blue-500 dark:text-blue-400 hover:underline break-all leading-snug">
              Open in Basecamp ↗
            </a>
          </div>
        )}
        {richSingle.dueOn       && <InfoRow label="Due on"      value={richSingle.dueOn} />}
        {richSingle.createdAt   && <InfoRow label="Created at"  value={richSingle.createdAt} />}
        {richSingle.subject     && <InfoRow label="Subject"     value={richSingle.subject} />}
        {richSingle.todoId      && <InfoRow label="To-do ID"    value={richSingle.todoId} mono />}
        {richSingle.projectId   && <InfoRow label="Project ID"  value={richSingle.projectId} mono />}
        {richSingle.todolistId  && <InfoRow label="List ID"     value={richSingle.todolistId} mono />}
        {richSingle.name        && <InfoRow label="Name"        value={richSingle.name} />}
        {richSingle.email       && <InfoRow label="Email"       value={richSingle.email} mono />}
        {richSingle.company     && <InfoRow label="Company"     value={richSingle.company} />}
      </div>
      {Array.isArray(richSingle.assignees) && richSingle.assignees.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Assignees</p>
          <div className="space-y-1">
            {richSingle.assignees.map((a) => (
              <div key={String(a.id)} className="flex items-center gap-2 text-[11px]">
                <span className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-[10px] font-bold text-green-700 dark:text-green-300 shrink-0">
                  {a.name.charAt(0).toUpperCase()}
                </span>
                <span className="text-slate-700 dark:text-slate-200">{a.name}</span>
                {a.email && <span className="text-slate-400 dark:text-slate-500">{a.email}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Transform result ──────────────────────────────────────────────────────────

function TransformResultDisplay({ result }: { result: NodeTestResult }) {
  const out = result.output;
  if (typeof out !== 'object' || out === null || Array.isArray(out)) {
    return <GenericResultDisplay result={result} />;
  }
  const entries = Object.entries(out as Record<string, unknown>);
  return (
    <div className="p-3 space-y-2">
      <SectionLabel>{entries.length} field{entries.length !== 1 ? 's' : ''} mapped</SectionLabel>
      <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
        {entries.map(([k, v], i) => (
          <div key={k} className={`flex items-start gap-3 px-3 py-2 text-[11px] border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 ${
            i % 2 === 0 ? 'bg-white dark:bg-slate-900/40' : 'bg-slate-50 dark:bg-slate-800/40'
          }`}>
            <span className="font-semibold text-blue-500 dark:text-blue-400 shrink-0 min-w-[80px] pt-0.5">{k}</span>
            <span className="text-slate-400 dark:text-slate-500 shrink-0 pt-0.5">→</span>
            <SmartValue v={v} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ExtractResultDisplay({ result }: { result: NodeTestResult }) {
  const out = result.output;
  if (typeof out !== 'object' || out === null || Array.isArray(out)) {
    return <GenericResultDisplay result={result} />;
  }

  // List-mode result: { items: [...], count: N }. Render each item as its own
  // mini block so the user can verify the extraction worked across the list.
  const items = (out as Record<string, unknown>).items;
  if (Array.isArray(items)) {
    const total = items.length;
    return (
      <div className="p-3 space-y-2">
        <SectionLabel>
          Extracted {total} item{total !== 1 ? 's' : ''}
        </SectionLabel>
        {total === 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
            Source resolved to an empty list — no items to extract from.
          </p>
        )}
        <div className="space-y-2">
          {items.map((item, idx) => {
            const itemRecord = (item ?? {}) as Record<string, unknown>;
            const entries = Object.entries(itemRecord);
            const found   = entries.filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)).length;
            return (
              <div key={idx} className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Item {idx + 1}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    {found} / {entries.length} field{entries.length !== 1 ? 's' : ''} found
                  </span>
                </div>
                {entries.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 italic bg-white dark:bg-slate-900/40">
                    (no fields)
                  </div>
                ) : entries.map(([k, v], i) => {
                  const isMissing = v == null || v === '' || (Array.isArray(v) && v.length === 0);
                  return (
                    <div key={k} className={`flex items-start gap-3 px-3 py-2 text-[11px] border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 ${
                      i % 2 === 0 ? 'bg-white dark:bg-slate-900/40' : 'bg-slate-50 dark:bg-slate-800/40'
                    }`}>
                      <span className="font-semibold text-blue-500 dark:text-blue-400 shrink-0 min-w-[110px] pt-0.5 font-mono">{k}</span>
                      <span className="text-slate-400 dark:text-slate-500 shrink-0 pt-0.5">→</span>
                      {isMissing ? <NoDataBadge /> : <SmartValue v={v} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Single-shot result — original flat layout.
  const entries = Object.entries(out as Record<string, unknown>);
  const found   = entries.filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)).length;
  return (
    <div className="p-3 space-y-2">
      <SectionLabel>
        {found} / {entries.length} field{entries.length !== 1 ? 's' : ''} extracted
      </SectionLabel>
      <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
        {entries.map(([k, v], i) => {
          const isMissing = v == null || v === '' || (Array.isArray(v) && v.length === 0);
          return (
            <div key={k} className={`flex items-start gap-3 px-3 py-2 text-[11px] border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 ${
              i % 2 === 0 ? 'bg-white dark:bg-slate-900/40' : 'bg-slate-50 dark:bg-slate-800/40'
            }`}>
              <span className="font-semibold text-blue-500 dark:text-blue-400 shrink-0 min-w-[110px] pt-0.5 font-mono">{k}</span>
              <span className="text-slate-400 dark:text-slate-500 shrink-0 pt-0.5">→</span>
              {isMissing ? <NoDataBadge /> : <SmartValue v={v} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Trigger result ────────────────────────────────────────────────────────────

function TriggerResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as Record<string, unknown>;
  const { triggerType, triggeredAt, ...rest } = out;

  const triggerLabels: Record<string, string> = {
    manual:    'Triggered manually',
    webhook:   'Webhook received',
    cron:      'Scheduled run (cron)',
    app_event: 'App event detected',
    email:     'Email trigger fired',
  };

  return (
    <div className="p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[11px] font-semibold">
          {triggerLabels[String(triggerType ?? '')] ?? String(triggerType ?? 'Unknown trigger')}
        </span>
        {!!triggeredAt && (
          <span className="text-[10px] text-slate-600 dark:text-slate-300">
            {fmtDate(String(triggeredAt))}
          </span>
        )}
      </div>

      {Object.keys(rest).length > 0 && (
        <div className="space-y-1">
          <SectionLabel>Trigger payload</SectionLabel>
          <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
            {Object.entries(rest).map(([k, v], i) => (
              <div key={k} className={`flex items-start gap-2 px-3 py-1.5 text-[11px] border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 ${
                i % 2 === 0 ? 'bg-white dark:bg-slate-900/40' : 'bg-slate-50 dark:bg-slate-800/40'
              }`}>
                <span className="text-slate-600 dark:text-slate-300 font-medium shrink-0 min-w-[80px] pt-0.5">{k}</span>
                <SmartValue v={v} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Generic result (output / fallback) ───────────────────────────────────────

function GenericResultDisplay({ result }: { result: NodeTestResult }) {
  const out = result.output;
  const outStr = JSON.stringify(out, null, 2);

  if (out == null) {
    return (
      <div className="p-3">
        <p className="text-xs text-slate-500 dark:text-slate-400 italic">No output returned</p>
      </div>
    );
  }

  if (typeof out === 'string') {
    return (
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between">
          <SectionLabel>Output</SectionLabel>
          <CopyButton text={out} />
        </div>
        <div className="bg-slate-100 dark:bg-slate-800 rounded-md p-2.5">
          <p className="text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">{out}</p>
        </div>
      </div>
    );
  }

  if (Array.isArray(out)) {
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>{out.length} item{out.length !== 1 ? 's' : ''}</SectionLabel>
          <CopyButton text={outStr} />
        </div>
        <div className="space-y-1.5">
          {out.slice(0, 10).map((item, i) => (
            <div key={i} className="bg-slate-100 dark:bg-slate-800 rounded px-2.5 py-1.5 text-[11px]">
              <SmartValue v={item} />
            </div>
          ))}
          {out.length > 10 && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">+{out.length - 10} more items</p>
          )}
        </div>
      </div>
    );
  }

  if (typeof out === 'object') {
    const entries = Object.entries(out as Record<string, unknown>);
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>{entries.length} field{entries.length !== 1 ? 's' : ''}</SectionLabel>
          <CopyButton text={outStr} />
        </div>
        <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
          {entries.map(([k, v], i) => (
            <div key={k} className={`flex items-start gap-2 px-3 py-1.5 text-[11px] border-b border-slate-100 dark:border-slate-700/50 last:border-b-0 ${
              i % 2 === 0 ? 'bg-white dark:bg-slate-900/40' : 'bg-slate-50 dark:bg-slate-800/40'
            }`}>
              <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold shrink-0 min-w-[70px] pt-0.5">{k}</span>
              <SmartValue v={v} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Primitive
  return (
    <div className="p-3">
      <SmartValue v={out} />
    </div>
  );
}

// ── Main result wrapper — routes to the right display per node type ────────────

const TYPED_NODES = new Set(['http','llm','condition','switch','gmail','gdrive','gdocs','gsheets','slack','teams','basecamp','transform','extract','trigger']);

function TestResultDisplay({ result, nodeType }: { result: NodeTestResult; nodeType: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const rawJson = JSON.stringify(result.output ?? result.error ?? null, null, 2);

  return (
    <div className={`rounded-md border overflow-hidden ${
      result.status === 'success' ? 'border-emerald-800/50' : 'border-red-800/50'
    }`}>
      <ResultHeader result={result} />

      {/* View toggle tabs — only when there is output or error detail */}
      {(result.output != null || result.error) && (
        <div className="flex items-center gap-0 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setShowRaw(false)}
            className={`px-3 py-1.5 text-[10px] font-semibold transition-colors border-b-2 ${
              !showRaw
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900/60'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Formatted
          </button>
          <button
            type="button"
            onClick={() => setShowRaw(true)}
            className={`px-3 py-1.5 text-[10px] font-semibold transition-colors border-b-2 flex items-center gap-1 ${
              showRaw
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900/60'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Braces className="w-2.5 h-2.5" />
            Raw JSON
          </button>
        </div>
      )}

      {/* Raw JSON view */}
      {showRaw && (
        <div className="bg-slate-50 dark:bg-slate-900/80 p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
              Raw JSON output
            </span>
            <CopyButton text={rawJson} />
          </div>
          <pre className="text-[10px] font-mono text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded-md p-3 overflow-auto leading-relaxed whitespace-pre-wrap break-all">
            {rawJson}
          </pre>
        </div>
      )}

      {/* Formatted views — hidden when raw JSON is active */}
      {!showRaw && (
        <>
          {/* Error detail */}
          {result.status === 'failure' && result.error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 space-y-1">
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                What went wrong
              </p>
              <p className="text-xs text-red-600 dark:text-red-300 break-words leading-relaxed">{result.error}</p>
            </div>
          )}

          {/* Success output — node-type-aware */}
          {result.status === 'success' && result.output != null && (
            <div className="bg-slate-50 dark:bg-slate-900/80">
              {nodeType === 'http'      && <HttpResultDisplay      result={result} />}
              {nodeType === 'llm'       && <LLMResultDisplay       result={result} />}
              {nodeType === 'condition' && <ConditionResultDisplay result={result} />}
              {nodeType === 'switch'    && <SwitchResultDisplay    result={result} />}
              {nodeType === 'gmail'     && <GmailResultDisplay     result={result} />}
              {nodeType === 'gdrive'    && <GDriveResultDisplay    result={result} />}
              {nodeType === 'gdocs'     && <GDocsResultDisplay     result={result} />}
              {nodeType === 'gsheets'   && <GSheetsResultDisplay   result={result} />}
              {nodeType === 'slack'     && <SlackResultDisplay     result={result} />}
              {nodeType === 'teams'     && <TeamsResultDisplay     result={result} />}
              {nodeType === 'basecamp'  && <BasecampResultDisplay  result={result} />}
              {nodeType === 'transform' && <TransformResultDisplay result={result} />}
              {nodeType === 'extract'   && <ExtractResultDisplay   result={result} />}
              {nodeType === 'trigger'   && <TriggerResultDisplay   result={result} />}
              {!TYPED_NODES.has(nodeType) && <GenericResultDisplay result={result} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Node test panel ───────────────────────────────────────────────────────────

function NodeTestPanel({
  nodeId,
  workflowId,
  nodeType,
  savedResult,
  onBeforeRun,
}: {
  nodeId: string;
  workflowId: string;
  nodeType: string;
  savedResult: NodeTestResult | null;
  /** Commits the panel draft to the workflow store and saves before running the test. */
  onBeforeRun: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [localResult, setLocalResult] = useState<NodeTestResult | null>(null);
  const testNode = useTestNode();

  const displayResult = localResult ?? savedResult;

  async function handleRun() {
    // Commit the panel's draft config (including staged file IDs, etc.) to the
    // workflow store and persist to the backend BEFORE running the test, so the
    // backend always sees the latest values from the config panel.
    await onBeforeRun();
    const result = await testNode.mutateAsync({ workflowId, nodeId });
    setLocalResult(result);
  }

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-750 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Play className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            Test this node
          </span>
          {displayResult && (
            <span className={`w-1.5 h-1.5 rounded-full ${
              displayResult.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'
            }`} />
          )}
        </div>
        {open ? <ChevronUp className="w-3 h-3 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-400 dark:text-slate-500" />}
      </button>

      {open && (
        <div className="p-2.5 space-y-2.5 bg-slate-50 dark:bg-slate-900/60">
          {/* Run button */}
          <button
            type="button"
            onClick={handleRun}
            disabled={testNode.isPending}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white rounded text-xs font-medium transition-colors"
          >
            {testNode.isPending
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</>
              : <><Play className="w-3 h-3" /> Run node</>
            }
          </button>

          {/* Last result */}
          {displayResult && <TestResultDisplay result={displayResult} nodeType={nodeType} />}

          {!displayResult && !testNode.isPending && (
            <p className="text-[10px] text-slate-600 text-center italic">
              No test run yet — click Run node to see output.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dependency scanner ────────────────────────────────────────────────────────

/** Recursively search any config value for {{nodes.<targetId>. expressions. */
function configReferencesNode(obj: unknown, targetId: string): boolean {
  if (typeof obj === 'string') {
    return new RegExp(`\\{\\{\\s*nodes\\.${targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`).test(obj);
  }
  if (Array.isArray(obj)) return obj.some(v => configReferencesNode(v, targetId));
  if (obj !== null && typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).some(v => configReferencesNode(v, targetId));
  }
  return false;
}

/** Returns all nodes (excluding the target itself) whose config references the target node's output. */
function findDependentsOf(targetId: string, allNodes: CanvasNode[]): CanvasNode[] {
  return allNodes.filter(n => n.id !== targetId && configReferencesNode(n.data.config, targetId));
}

// ── Disable confirmation modal ────────────────────────────────────────────────

function DisableNodeWarningModal({
  open,
  nodeName,
  dependents,
  isLoading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  nodeName: string;
  dependents: CanvasNode[];
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
        <button
          onClick={onCancel}
          className="absolute top-3 right-3 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-3 pr-5">
          <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Node output is in use</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              <span className="font-medium text-gray-800 dark:text-slate-200">"{nodeName}"</span> is referenced by{' '}
              <span className="font-medium text-amber-600 dark:text-amber-300">{dependents.length} node{dependents.length !== 1 ? 's' : ''}</span>.
              Disabling it will cause those nodes to fail with an error when the workflow runs.
            </p>
          </div>
        </div>

        {/* Dependent node list */}
        <div className="mt-3.5 space-y-1.5 max-h-44 overflow-y-auto">
          {dependents.map(dep => (
            <div
              key={dep.id}
              className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900/70 rounded-md border border-slate-200 dark:border-slate-700/50"
            >
              <span className="shrink-0 opacity-70">
                <NodeIcon type={dep.data.nodeType} size={12} />
              </span>
              <span className="text-xs font-medium text-gray-800 dark:text-slate-200 truncate flex-1">{dep.data.label}</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 uppercase tracking-wide">{dep.data.nodeType}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-50"
          >
            {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            Disable anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface NodeDraft {
  label: string;
  config: Record<string, unknown>;
  retries: number | undefined;
  retryDelayMs: number | undefined;
  timeoutMs: number | undefined;
}

export function NodeConfigPanel() {
  const { nodes, edges, selectedNodeId, setNodes, setEdges, setSelectedNodeId, activeWorkflow, setActiveWorkflow } =
    useWorkflowStore();

  const { save: saveWorkflow, isSaving: isSavingDisabled } = useSaveWorkflow();

  // ── Local draft — buffers config changes until the user explicitly saves ─────
  const [draft, setDraft] = useState<NodeDraft | null>(null);
  // Always-current ref so async callbacks (commitDraftToStore, commitAndSave)
  // never read a stale closed-over draft value.
  const draftRef = useRef<NodeDraft | null>(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  // originalSnapshot is a STATE (not a ref) so updating it after save
  // triggers a re-render and isDirtyLocal correctly recomputes to false.
  const [originalSnapshot, setOriginalSnapshot] = useState<NodeDraft | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSavingNode, setIsSavingNode] = useState(false);
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; message: string }>({
    open: false, title: '', message: '',
  });

  // Reset draft whenever a different node is selected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) { setDraft(null); setOriginalSnapshot(null); return; }
    const snapshot: NodeDraft = {
      label: node.data.label,
      config: { ...(node.data.config as Record<string, unknown>) },
      retries: node.data.retries,
      retryDelayMs: node.data.retryDelayMs,
      timeoutMs: node.data.timeoutMs,
    };
    setOriginalSnapshot({ ...snapshot, config: { ...snapshot.config } });
    setDraft({ ...snapshot, config: { ...snapshot.config } });
    setSaveSuccess(false);
    setIsSavingNode(false);
  }, [selectedNodeId]); // intentionally omits `nodes` — only reset on selection change

  // State for the disable-confirmation modal (must be before any early return)
  const [disableModal, setDisableModal] = useState<{ open: boolean; dependents: CanvasNode[] }>({
    open: false,
    dependents: [],
  });

  const isUnsaved = !activeWorkflow?.id || activeWorkflow.id.startsWith('__new__');
  const workflowIdForQueries = isUnsaved ? null : activeWorkflow?.id;
  const { data: rawTestResults = {} }    = useNodeTestResults(workflowIdForQueries);
  const { data: lastRunResults  = {} }   = useLastRunResults(workflowIdForQueries);

  // Merge: last-run results are the base; manual test results override them.
  // This way the variable picker shows real output from either source, with
  // the most-intentional (manual test) taking precedence when both exist.
  const testResults: Record<string, NodeTestResult> = { ...lastRunResults, ...rawTestResults };

  // ── isDirtyLocal must be declared BEFORE the early return so hook order is stable ──
  // Depends on both `draft` AND `originalSnapshot` so it recomputes when either changes.
  const isDirtyLocal = useMemo(() => {
    if (!draft || !originalSnapshot) return false;
    return (
      draft.label !== originalSnapshot.label ||
      JSON.stringify(draft.config) !== JSON.stringify(originalSnapshot.config) ||
      draft.retries !== originalSnapshot.retries ||
      draft.retryDelayMs !== originalSnapshot.retryDelayMs ||
      draft.timeoutMs !== originalSnapshot.timeoutMs
    );
  }, [draft, originalSnapshot]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-600 gap-2 px-4 text-center">
        <Settings2 className="w-8 h-8" />
        <p className="text-xs">Hover a node and click the <span className="font-medium text-slate-500 dark:text-slate-400">config icon</span> to edit it</p>
      </div>
    );
  }

  const { data } = selectedNode;
  const nodeType = data.nodeType as string;

  function updateConfig(patch: Record<string, unknown>) {
    setDraft((prev) => prev ? { ...prev, config: { ...prev.config, ...patch } } : prev);
    // For switch nodes, immediately mirror the cases array into the canvas store
    // so output handle labels appear/update in real-time (before the user clicks Save).
    if (nodeType === 'switch' && 'cases' in patch) {
      const newCases = (patch.cases as Array<unknown>) ?? [];
      const latestNodes = useWorkflowStore.getState().nodes;
      const currentNode = latestNodes.find(n => n.id === selectedNodeId);
      const currentCases = (currentNode?.data?.config?.cases as Array<unknown>) ?? [];
      setNodes(latestNodes.map(n =>
        n.id === selectedNodeId
          ? { ...n, data: { ...n.data, config: { ...n.data.config, cases: newCases } } }
          : n
      ));
      // Only prune edges when cases are added or removed (not on label/condition edits).
      if (newCases.length !== currentCases.length) {
        const validHandles = new Set([
          ...newCases.map((_, idx) => String(idx)),
          'default',
        ]);
        setEdges(edges.filter(e =>
          e.source !== selectedNodeId || validHandles.has(e.sourceHandle ?? '')
        ));
      }
    }
  }

  function updateData(patch: Partial<typeof data>) {
    const updated = nodes.map((n) =>
      n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n
    );
    setNodes(updated);
  }

  async function doDisable() {
    updateData({ disabled: true });
    if (!isUnsaved) {
      try { await saveWorkflow(); } catch { /* silent */ }
    }
  }

  async function toggleDisabled() {
    if (data.disabled) {
      // Re-enabling: no confirmation needed
      updateData({ disabled: false });
      if (!isUnsaved) {
        try { await saveWorkflow(); } catch { /* silent */ }
      }
      return;
    }

    // Disabling: check whether any other node's config references this node's output
    const dependents = findDependentsOf(selectedNodeId!, nodes);
    if (dependents.length === 0) {
      // No downstream references — disable immediately
      await doDisable();
    } else {
      // Prompt the user with the list of affected nodes
      setDisableModal({ open: true, dependents });
    }
  }

  async function confirmDisable() {
    setDisableModal(prev => ({ ...prev, open: false }));
    await doDisable();
  }

  function toggleEntry() {
    const willBeEntry = !data.isEntry;
    // First pass: flip isEntry for the selected node
    const afterToggle = nodes.map((n) =>
      n.id === selectedNodeId ? { ...n, data: { ...n.data, isEntry: willBeEntry } } : n
    );
    // Second pass: recompute isParallelEntry for all nodes
    const entryCount = afterToggle.filter(n => n.data.isEntry).length;
    const updated = afterToggle.map((n) => ({
      ...n,
      data: { ...n.data, isParallelEntry: n.data.isEntry && entryCount > 1 },
    }));
    setNodes(updated);

    // Keep activeWorkflow.entryNodeId pointing to at least one entry node
    if (activeWorkflow) {
      const newEntryIds = updated.filter(n => n.data.isEntry).map(n => n.id);
      const primary = newEntryIds[0] ?? activeWorkflow.entryNodeId;
      setActiveWorkflow({ ...activeWorkflow, entryNodeId: primary });
    }
  }

  /** Commit current draft values into the workflow store (no save dialog / success state).
   *  Reads from draftRef (always up-to-date) and directly from the Zustand store for
   *  nodes, so this function is safe to call from async contexts that might close over
   *  a stale React render. */
  function commitDraftToStore() {
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    // Read the latest nodes directly from the store to avoid stale React hook closure
    const latestNodes = useWorkflowStore.getState().nodes;
    setNodes(latestNodes.map((n) =>
      n.id === selectedNodeId
        ? {
            ...n,
            data: {
              ...n.data,
              label:        currentDraft.label,
              config:       currentDraft.config,
              retries:      currentDraft.retries ?? 0,
              retryDelayMs: currentDraft.retryDelayMs ?? 0,
              timeoutMs:    currentDraft.timeoutMs,
            },
          }
        : n
    ));
  }

  /** Commit draft to store, then persist to the backend. Used by the test panel. */
  async function commitAndSave() {
    commitDraftToStore();
    await saveWorkflow();
  }

  async function handleNodeSave() {
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    setIsSavingNode(true);
    commitDraftToStore();
    try {
      await saveWorkflow();
      setOriginalSnapshot({ ...currentDraft, config: { ...currentDraft.config } });
      setSaveSuccess(true);
      setIsSavingNode(false);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      setIsSavingNode(false);
      setAlertModal({ open: true, title: 'Save failed', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function handleNodeCancel() {
    // Reset draft to last-saved snapshot, then deselect / close the config panel
    if (originalSnapshot) {
      setDraft({ ...originalSnapshot, config: { ...originalSnapshot.config } });
      // For switch nodes: revert the canvas cases that were live-synced during editing,
      // and remove any edges that were drawn to handles that no longer exist.
      if (nodeType === 'switch') {
        const latestNodes = useWorkflowStore.getState().nodes;
        setNodes(latestNodes.map(n =>
          n.id === selectedNodeId
            ? { ...n, data: { ...n.data, config: originalSnapshot.config } }
            : n
        ));
        const originalCases = (originalSnapshot.config.cases as Array<unknown>) ?? [];
        const validHandles = new Set([
          ...originalCases.map((_, idx) => String(idx)),
          'default',
        ]);
        setEdges(edges.filter(e =>
          e.source !== selectedNodeId || validHandles.has(e.sourceHandle ?? '')
        ));
      }
    }
    setSelectedNodeId(null);
  }

  const entryCount = nodes.filter(n => n.data.isEntry).length;
  // Use draft config for the form; fall back to store until draft is initialised
  const cfg = (draft?.config ?? data.config) as Record<string, unknown>;
  const otherNodes = nodes.filter((n) => n.id !== selectedNodeId);
  const savedTestResult = selectedNodeId ? (testResults[selectedNodeId] ?? null) : null;

  return (
    <>
    <ConfirmModal
      alertOnly
      open={alertModal.open}
      title={alertModal.title}
      message={alertModal.message}
      onConfirm={() => setAlertModal(a => ({ ...a, open: false }))}
      onCancel={() => setAlertModal(a => ({ ...a, open: false }))}
    />
    <div className="flex flex-col min-h-full">
    {/* Scrollable config body */}
    <div className="p-4 space-y-4 flex-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1 mr-2">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            {nodeType}
            {isDirtyLocal && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-500/30">
                ● unsaved
              </span>
            )}
          </p>
          <p className={`text-sm font-semibold truncate ${data.disabled ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-gray-900 dark:text-white'}`}>
            {draft?.label ?? data.label}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Disable / Enable toggle — auto-saves on click */}
          <button
            onClick={toggleDisabled}
            disabled={isSavingDisabled}
            title={
              isSavingDisabled ? 'Saving…' :
              data.disabled ? 'Node is disabled — click to enable' :
              'Disable this node (it will be skipped during execution)'
            }
            className={`transition-colors disabled:opacity-50 disabled:cursor-wait ${
              data.disabled ? 'text-red-400 hover:text-red-300' : 'text-slate-400 dark:text-slate-500 hover:text-red-400'
            }`}
          >
            {isSavingDisabled
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Power className="w-4 h-4" />
            }
          </button>
          {/* Star / entry toggle */}
          <button
            onClick={toggleEntry}
            title={data.isEntry ? 'Remove as start node' : 'Mark as start node (⭐ = runs on trigger)'}
            className={`transition-colors ${data.isEntry ? 'text-amber-400' : 'text-slate-400 dark:text-slate-500 hover:text-amber-400'}`}
          >
            <Star className={`w-4 h-4 ${data.isEntry ? 'fill-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Disabled banner */}
      {data.disabled && (
        <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-200 dark:bg-slate-700/40 border border-dashed border-slate-500/50 rounded-md">
          <Power className="w-3 h-3 text-slate-500 dark:text-slate-400 shrink-0" />
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            This node is <span className="font-semibold text-slate-700 dark:text-slate-300">disabled</span> — it will be skipped when the workflow runs. Any downstream node that uses its output will fail.
          </p>
        </div>
      )}

      {/* Multi-entry hint */}
      {entryCount > 1 && data.isEntry && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-md">
          <Star className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400 shrink-0" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300">
            {entryCount} start nodes — they will run simultaneously when triggered.
          </p>
        </div>
      )}

      {/* Node name */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Node name</label>
        <input
          type="text"
          value={draft?.label ?? data.label}
          onChange={(e) => setDraft((prev) => prev ? { ...prev, label: e.target.value } : prev)}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Test panel */}
      {isUnsaved ? (
        <div className="flex items-center gap-1.5 px-2.5 py-2 bg-slate-100 dark:bg-slate-800/50 rounded-md border border-slate-200 dark:border-slate-700">
          <AlertCircle className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
          <p className="text-[10px] text-slate-400 dark:text-slate-500">Save the workflow first to enable node testing.</p>
        </div>
      ) : (
        <NodeTestPanel
          key={selectedNodeId}
          nodeId={selectedNodeId!}
          workflowId={activeWorkflow!.id}
          nodeType={nodeType}
          savedResult={savedTestResult}
          onBeforeRun={commitAndSave}
        />
      )}

      <div className="border-t border-slate-200 dark:border-slate-700" />

      {/* Type-specific config */}
      {nodeType === 'http' && (
        <HttpConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'llm' && (
        <LLMConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'condition' && (
        <ConditionConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'switch' && (
        <SwitchConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'transform' && (
        <TransformConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'extract' && (
        <ExtractConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'output' && (
        <OutputConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'formatter' && (
        <MessageFormatterConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'gmail' && (
        <GmailConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'gdrive' && (
        <GDriveConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'gdocs' && (
        <GDocsConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'gsheets' && (
        <GSheetsConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'slack' && (
        <SlackConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'teams' && (
        <TeamsConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'basecamp' && (
        <BasecampConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'trigger' && (
        <TriggerConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} workflowId={activeWorkflow?.id ?? ''} nodeId={selectedNode.id} />
      )}

      {/* Retry & Timeout */}
      <div className="border-t border-slate-200 dark:border-slate-700" />
      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Retry & Timeout</p>
      {[
        { label: 'Retries (0–5)', key: 'retries' as const, min: 0, max: 5, val: draft?.retries ?? 0 },
        { label: 'Retry delay (ms)', key: 'retryDelayMs' as const, min: 0, val: draft?.retryDelayMs ?? 0 },
        { label: 'Timeout (ms, 0 = none)', key: 'timeoutMs' as const, min: 0, val: draft?.timeoutMs ?? 0 },
      ].map(({ label, key, min, max, val }) => (
        <div key={key} className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
          <input
            type="number"
            min={min}
            max={max}
            value={String(val)}
            onChange={(e) =>
              setDraft((prev) => prev ? {
                ...prev,
                [key]: key === 'timeoutMs'
                  ? (Number(e.target.value) || undefined)
                  : Number(e.target.value),
              } : prev)
            }
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      ))}

      {/* Disable-confirmation modal — rendered inside the panel so it inherits
          the correct stacking context but portals to the viewport via fixed positioning */}
      <DisableNodeWarningModal
        open={disableModal.open}
        nodeName={data.label}
        dependents={disableModal.dependents}
        isLoading={isSavingDisabled}
        onConfirm={confirmDisable}
        onCancel={() => setDisableModal({ open: false, dependents: [] })}
      />
    </div>

    {/* ── Sticky Save / Cancel footer ─────────────────────────────────────── */}
    <div className="sticky bottom-0 z-10 bg-slate-50 dark:bg-slate-900/95 backdrop-blur-sm border-t border-slate-200 dark:border-slate-700/70 px-4 py-3 flex items-center gap-2 shrink-0">
      <button
        onClick={handleNodeSave}
        disabled={!isDirtyLocal || isSavingNode}
        title={isDirtyLocal ? 'Save changes to this node' : 'No changes to save'}
        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-150 ${
          saveSuccess
            ? 'bg-green-600/80 text-gray-900 dark:text-white cursor-default'
            : isDirtyLocal && !isSavingNode
            ? 'bg-blue-600 hover:bg-blue-500 text-gray-900 dark:text-white shadow-sm shadow-blue-900/50'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
        }`}
      >
        {isSavingNode ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
        ) : saveSuccess ? (
          <><CheckCircle2 className="w-3 h-3" /> Saved</>
        ) : (
          <><Save className="w-3 h-3" /> Save</>
        )}
      </button>

      <button
        onClick={handleNodeCancel}
        title={isDirtyLocal ? 'Discard changes and close' : 'Close config panel'}
        className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-gray-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 transition-colors"
      >
        <X className="w-3 h-3" />
        {isDirtyLocal ? 'Discard' : 'Close'}
      </button>
    </div>
    </div>
    </>
  );
}

// ── Per-type config forms ─────────────────────────────────────────────────────

type ConfigProps = {
  cfg: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
};

function HttpConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const headers = (cfg.headers as Record<string, string>) ?? {};
  const headerEntries = Object.entries(headers);

  // Body type: 'none' | 'raw' | 'form-data' | 'urlencoded'
  // Backward-compat: nodes without bodyType that have body → treat as 'raw'
  const bodyType: string = (cfg.bodyType as string) ?? (cfg.body != null ? 'raw' : 'none');

  // rawContentType maps 1:1 to BodyLanguage in HttpBodyEditor
  const rawContentType: BodyLanguage = ((cfg.rawContentType as string) ?? 'json') as BodyLanguage;

  const formData = (cfg.formData as Record<string, string>) ?? {};
  const formDataEntries = Object.entries(formData);

  // Auth
  const authType: string = (cfg.authType as string) ?? 'none';
  const auth = (cfg.auth as Record<string, string>) ?? {};

  // Body is always stored as a raw string; objects from older saves are normalised
  const bodyRaw: string =
    cfg.body == null
      ? ''
      : typeof cfg.body === 'string'
        ? cfg.body
        : JSON.stringify(cfg.body, null, 2);

  // JSON validation status for the editor badge
  const jsonStatus: 'valid' | 'invalid' | 'empty' = useMemo(() => {
    if (!bodyRaw.trim()) return 'empty';
    try { JSON.parse(bodyRaw); return 'valid'; }
    catch { return 'invalid'; }
  }, [bodyRaw]);

  function updateHeader(oldKey: string, newKey: string, value: string) {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      updated[k === oldKey ? newKey : k] = k === oldKey ? value : v;
    }
    onChange({ headers: updated });
  }

  function addHeader() {
    onChange({ headers: { ...headers, '': '' } });
  }

  function removeHeader(key: string) {
    const updated = { ...headers };
    delete updated[key];
    onChange({ headers: Object.keys(updated).length ? updated : undefined });
  }

  function updateFormData(oldKey: string, newKey: string, value: string) {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(formData)) {
      updated[k === oldKey ? newKey : k] = k === oldKey ? value : v;
    }
    onChange({ formData: updated });
  }

  function addFormDataRow() {
    onChange({ formData: { ...formData, '': '' } });
  }

  function removeFormDataRow(key: string) {
    const updated = { ...formData };
    delete updated[key];
    onChange({ formData: Object.keys(updated).length ? updated : undefined });
  }

  function setBodyType(type: string) {
    const extra: Record<string, unknown> = { bodyType: type };
    if (type === 'none') {
      extra.body = undefined;
      extra.formData = undefined;
    }
    onChange(extra);
  }

  function updateAuth(key: string, value: string) {
    onChange({ auth: { ...auth, [key]: value } });
  }

  function setAuthType(type: string) {
    onChange({ authType: type, auth: {} });
  }

  function handleBodyChange(v: string) {
    // Always store body as raw string — backend handles parsing
    onChange({ body: v.trim() ? v : undefined });
  }

  function handlePrettify() {
    if (!bodyRaw.trim()) return;
    try {
      const pretty = JSON.stringify(JSON.parse(bodyRaw), null, 2);
      onChange({ body: pretty });
    } catch {
      // not valid JSON — do nothing
    }
  }

  const BODY_TABS = [
    { id: 'none', label: 'none' },
    { id: 'raw', label: 'raw' },
    { id: 'form-data', label: 'form-data' },
    { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  ] as const;

  return (
    <>
      <Select
        label="Method"
        value={String(cfg.method ?? 'GET')}
        onChange={(e) => onChange({ method: e.target.value })}
        options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))}
      />
      <ExpressionInput
        label="URL"
        value={String(cfg.url ?? '')}
        onChange={(v) => onChange({ url: v })}
        placeholder="https://api.example.com/data"
        nodes={otherNodes}
        testResults={testResults}
      />

      {/* Authorization */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">Authorization</label>
          <select
            value={authType}
            onChange={(e) => setAuthType(e.target.value)}
            className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="none">No Auth</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
            <option value="apikey-header">API Key (Header)</option>
            <option value="apikey-query">API Key (Query Param)</option>
          </select>
        </div>
        {authType === 'bearer' && (
          <ExpressionInput
            label="Token"
            value={auth.token ?? ''}
            onChange={(v) => updateAuth('token', v)}
            placeholder="Enter bearer token"
            nodes={otherNodes}
            testResults={testResults}
          />
        )}
        {authType === 'basic' && (
          <>
            <ExpressionInput
              label="Username"
              value={auth.username ?? ''}
              onChange={(v) => updateAuth('username', v)}
              placeholder="Username"
              nodes={otherNodes}
              testResults={testResults}
            />
            <ExpressionInput
              label="Password"
              value={auth.password ?? ''}
              onChange={(v) => updateAuth('password', v)}
              placeholder="Password"
              nodes={otherNodes}
              testResults={testResults}
            />
          </>
        )}
        {(authType === 'apikey-header' || authType === 'apikey-query') && (
          <>
            <ExpressionInput
              label="Key"
              value={auth.key ?? ''}
              onChange={(v) => updateAuth('key', v)}
              placeholder={authType === 'apikey-header' ? 'X-API-Key' : 'api_key'}
              nodes={otherNodes}
              testResults={testResults}
            />
            <ExpressionInput
              label="Value"
              value={auth.value ?? ''}
              onChange={(v) => updateAuth('value', v)}
              placeholder="Enter API key value"
              nodes={otherNodes}
              testResults={testResults}
            />
          </>
        )}
      </div>

      {/* Headers */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Headers</label>
          <button
            type="button"
            onClick={addHeader}
            className="text-[10px] text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 px-1.5 py-0.5 rounded transition-colors"
          >
            + Add header
          </button>
        </div>
        {headerEntries.length === 0 && (
          <p className="text-[10px] text-slate-600 dark:text-slate-400 italic">
            No custom headers — Content-Type and Authorization are managed above.
          </p>
        )}
        {headerEntries.map(([key, value], i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={key}
              onChange={(e) => updateHeader(key, e.target.value, value)}
              placeholder="Header name"
            />
            <span className="text-slate-600 text-xs shrink-0">:</span>
            <input
              className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={value}
              onChange={(e) => updateHeader(key, key, e.target.value)}
              placeholder="Value"
            />
            <button
              type="button"
              onClick={() => removeHeader(key)}
              className="text-slate-400 dark:text-slate-500 hover:text-red-400 px-1 shrink-0 text-sm"
            >
              ×
            </button>
          </div>
        ))}
        {headerEntries.length > 0 && (
          <p className="text-[10px] text-slate-600 dark:text-slate-400">
            Custom headers override auto-generated Content-Type and Authorization values.
          </p>
        )}
      </div>

      {/* Body */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Body</label>

        {/* Body type tabs */}
        <div className="flex items-center border-b border-slate-200 dark:border-slate-700">
          {BODY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBodyType(tab.id)}
              className={`px-2.5 py-1 text-[10px] font-medium border-b-2 transition-colors -mb-px ${
                bodyType === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {bodyType === 'none' && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">This request has no body.</p>
        )}

        {bodyType === 'raw' && (
          <HttpBodyEditor
            value={bodyRaw}
            onChange={handleBodyChange}
            language={rawContentType}
            onLanguageChange={(lang) => onChange({ rawContentType: lang })}
            onPrettify={handlePrettify}
            jsonStatus={jsonStatus}
            nodes={otherNodes}
            testResults={testResults}
          />
        )}

        {(bodyType === 'form-data' || bodyType === 'urlencoded') && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                {bodyType === 'form-data' ? 'multipart/form-data' : 'application/x-www-form-urlencoded'}
              </span>
              <button
                type="button"
                onClick={addFormDataRow}
                className="text-[10px] text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 px-1.5 py-0.5 rounded transition-colors"
              >
                + Add row
              </button>
            </div>
            {formDataEntries.length === 0 && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">No fields yet — click "+ Add row" to start.</p>
            )}
            {formDataEntries.map(([key, value], i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={key}
                  onChange={(e) => updateFormData(key, e.target.value, value)}
                  placeholder="Key"
                />
                <span className="text-slate-600 dark:text-slate-400 text-xs shrink-0">:</span>
                <input
                  className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={value}
                  onChange={(e) => updateFormData(key, key, e.target.value)}
                  placeholder="Value"
                />
                <button
                  type="button"
                  onClick={() => removeFormDataRow(key)}
                  className="text-slate-400 dark:text-slate-500 hover:text-red-400 px-1 shrink-0 text-sm"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface LLMModelEntry { value: string; label: string; description: string; preview?: boolean }
interface LLMProviderEntry { label: string; description: string }

const LLM_PROVIDERS: Record<string, LLMProviderEntry> = {
  openai: {
    label: 'OpenAI',
    description: "OpenAI's GPT-5.4 family leads on complex reasoning, coding, and agentic tasks. Models support a 1M token context window, built-in computer use, and native tool calling.",
  },
  anthropic: {
    label: 'Anthropic',
    description: "Anthropic's Claude models are known for safety, nuanced long-context understanding, and reliable instruction-following — ideal for analysis, writing, and multi-step workflows.",
  },
  gemini: {
    label: 'Google Gemini',
    description: "Google's Gemini models are natively multimodal, handling text, images, audio, video, and code. They offer a 1M+ token context window and competitive frontier-class intelligence.",
  },
  meta: {
    label: 'Meta (Llama)',
    description: "Meta's Llama models are not available yet — we are currently on the waitlist for access to the Llama API. Once approved, the Llama 4 family (Maverick, Scout) and Llama 3.3 will be available here.",
  },
};

const LLM_MODELS: Record<string, LLMModelEntry[]> = {
  openai: [
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      description: "OpenAI's current flagship. Best for complex reasoning, coding, and agentic tasks. 1M token context with built-in computer use and native compaction support.",
    },
    {
      value: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      description: 'A faster, more affordable GPT-5.4 variant. Strong reasoning at lower latency — ideal for high-volume agentic subflows and coding tasks.',
    },
    {
      value: 'gpt-5.4-nano',
      label: 'GPT-5.4 Nano',
      description: 'The most cost-efficient GPT-5.4-class model. Best for simple, high-throughput tasks where speed and low cost are the top priority.',
    },
  ],
  anthropic: [
    {
      value: 'claude-opus-4-6',
      label: 'Claude Opus 4.6',
      description: "Anthropic's most intelligent model. Excels at complex analysis, deep reasoning, long-context tasks, and nuanced writing.",
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6',
      description: 'Balanced performance and cost for production workloads. A reliable default for most workflows requiring strong instruction-following and reasoning.',
    },
    {
      value: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4.5',
      description: 'The fastest Claude model. Optimized for high-volume, latency-sensitive tasks such as classification, data extraction, and routing.',
    },
  ],
  gemini: [
    {
      value: 'gemini-3.1-pro-preview',
      label: 'Gemini 3.1 Pro (Preview)',
      description: "Google's most advanced reasoning model. Handles complex problem-solving across text, images, audio, video, and code with a 1M token context.",
      preview: true,
    },
    {
      value: 'gemini-3-flash-preview',
      label: 'Gemini 3 Flash (Preview)',
      description: 'Frontier-class multimodal performance at a fraction of larger model costs. Strong agentic and vision capabilities with fast response times.',
      preview: true,
    },
    {
      value: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      description: "Google's best stable (GA) price-performance model. Low-latency and high-volume ready with solid reasoning — no preview caveats.",
    },
  ],
  meta: [
    {
      value: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
      label: 'Llama 4 Maverick',
      description: "Meta's most capable Llama 4 model. 400B total parameters (17B active) across 128 experts, with a 1M token context and native multimodal input. Best for complex reasoning and agentic tasks.",
    },
    {
      value: 'Llama-4-Scout-17B-16E-Instruct',
      label: 'Llama 4 Scout',
      description: 'Efficient Llama 4 model with a massive 10M token context window and native multimodal support. Runs on a single GPU — great balance of power and cost.',
    },
    {
      value: 'Llama-3.3-70B-Instruct',
      label: 'Llama 3.3 70B',
      description: 'High-quality text-only model approaching Llama 3.1 405B performance. A solid and cost-effective choice for text generation, summarization, and instruction-following.',
    },
  ],
};

function LLMConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const provider = String(cfg.provider ?? 'openai');
  const models = LLM_MODELS[provider] ?? LLM_MODELS.openai;
  const currentModel = String(cfg.model ?? models[0].value);
  const modelValue = models.some(m => m.value === currentModel) ? currentModel : models[0].value;
  const providerInfo = LLM_PROVIDERS[provider];
  const modelInfo = models.find(m => m.value === modelValue);

  function handleProviderChange(newProvider: string) {
    const firstModel = (LLM_MODELS[newProvider] ?? LLM_MODELS.openai)[0].value;
    onChange({ provider: newProvider, model: firstModel });
  }

  return (
    <>
      <Select
        label="Provider"
        value={provider}
        onChange={(e) => handleProviderChange(e.target.value)}
        options={Object.entries(LLM_PROVIDERS).map(([value, info]) => ({ value, label: info.label }))}
      />
      {providerInfo && (
        <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 rounded-md px-2.5 py-2 leading-relaxed -mt-1">
          {providerInfo.description}
        </p>
      )}
      <Select
        label="Model"
        value={modelValue}
        onChange={(e) => onChange({ model: e.target.value })}
        options={models}
      />
      {modelInfo && (
        <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 rounded-md px-2.5 py-2 leading-relaxed -mt-1">
          {modelInfo.description}
        </p>
      )}
      {modelInfo?.preview && (
        <div className="flex gap-2 items-start bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-md px-2.5 py-2 -mt-1">
          <span className="text-amber-500 dark:text-amber-400 mt-px shrink-0">⚠</span>
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
            <strong>Preview model</strong> — not yet generally available (GA). Google may change behavior, pricing, or availability without notice. Not recommended for critical production workflows.
          </p>
        </div>
      )}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Temperature (0–2)</label>
        <input type="number" min={0} max={2} step={0.1} value={String(cfg.temperature ?? 0.7)}
          onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
        <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed pt-0.5">
          Controls how creative or predictable the response is. <strong className="text-slate-500 dark:text-slate-400">Lower values</strong> (e.g. 0.2) give focused, consistent answers. <strong className="text-slate-500 dark:text-slate-400">Higher values</strong> (e.g. 1.5) produce more varied and creative output.
        </p>
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Max tokens</label>
        <input type="number" min={1} value={String(cfg.maxTokens ?? 2048)}
          onChange={(e) => onChange({ maxTokens: Number(e.target.value) })}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
        <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed pt-0.5">
          The maximum length of the AI's response. A token is roughly ¾ of a word — so 500 tokens ≈ 375 words. Increase this if responses feel cut off; lower it to keep replies short and concise.
        </p>
      </div>
      <ExpressionTextArea
        label="System prompt"
        rows={4}
        resizable
        value={String(cfg.systemPrompt ?? '')}
        onChange={(v) => onChange({ systemPrompt: v })}
        placeholder="You are a helpful assistant..."
        nodes={otherNodes}
        testResults={testResults}
      />
      <ExpressionTextArea
        label="User prompt"
        rows={6}
        resizable
        value={String(cfg.userPrompt ?? '')}
        onChange={(v) => onChange({ userPrompt: v })}
        placeholder="Summarize the following content…"
        nodes={otherNodes}
        testResults={testResults}
      />
    </>
  );
}

const NO_VALUE_OPERATORS = new Set(['isNull', 'isNotNull']);

function ConditionConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const condition = (cfg.condition as Record<string, unknown>) ?? {};
  const operator = String(condition.operator ?? 'eq');
  const needsValue = !NO_VALUE_OPERATORS.has(operator);

  function updateCond(patch: Record<string, unknown>) {
    onChange({ condition: { ...condition, ...patch } });
  }

  function handleOperatorChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const op = e.target.value;
    // Clear the right-side value when switching to a no-value operator
    updateCond({ operator: op, ...(NO_VALUE_OPERATORS.has(op) ? { right: '' } : {}) });
  }

  return (
    <>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Condition</p>
      <ExpressionInput
        label="Left side (what to check)"
        value={String(condition.left ?? '')}
        onChange={(v) => updateCond({ left: v })}
        placeholder="Pick a variable → e.g. HTTP status code"
        nodes={otherNodes}
        testResults={testResults}
      />
      <Select
        label="Operator"
        value={operator}
        onChange={handleOperatorChange}
        options={[
          { value: 'eq', label: 'equals (=)' },
          { value: 'neq', label: 'not equals (≠)' },
          { value: 'gt', label: 'greater than (>)' },
          { value: 'gte', label: 'greater or equal (≥)' },
          { value: 'lt', label: 'less than (<)' },
          { value: 'lte', label: 'less or equal (≤)' },
          { value: 'contains', label: 'contains' },
          { value: 'startsWith', label: 'starts with' },
          { value: 'endsWith', label: 'ends with' },
          { value: 'isNull', label: 'is empty / null' },
          { value: 'isNotNull', label: 'is not empty / null' },
        ]}
      />
      {needsValue ? (
        <ExpressionInput
          label="Right side (value to compare)"
          value={String(condition.right ?? '')}
          onChange={(v) => updateCond({ right: v })}
          placeholder="200"
          nodes={otherNodes}
          testResults={testResults}
        />
      ) : (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/40 rounded text-[11px] text-slate-400 dark:text-slate-500 italic">
          No comparison value needed for this operator.
        </div>
      )}
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
        Connect the <strong className="text-amber-400">true</strong> and{' '}
        <strong className="text-amber-400">false</strong> handles on the canvas to set routing.
      </p>
    </>
  );
}

function SwitchConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const cases = (cfg.cases as Array<Record<string, unknown>>) ?? [];

  function updateCase(i: number, patch: Record<string, unknown>) {
    onChange({ cases: cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  }
  function addCase() {
    onChange({
      cases: [...cases, { label: `Case ${cases.length + 1}`, condition: { type: 'leaf', left: '', operator: 'eq', right: '' }, next: '' }],
    });
  }
  function removeCase(i: number) {
    onChange({ cases: cases.filter((_, idx) => idx !== i) });
  }

  return (
    <>
      {cases.map((c, i) => {
        const cond = (c.condition as Record<string, unknown>) ?? {};
        return (
          <div key={i} className="bg-slate-100 dark:bg-slate-800 rounded-md p-2 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <input
                className="flex-1 min-w-0 bg-slate-200 dark:bg-slate-700 border border-slate-600 text-gray-800 dark:text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={String(c.label ?? `Case ${i + 1}`)}
                onChange={(e) => updateCase(i, { label: e.target.value })}
                placeholder="Case label"
              />
              <button onClick={() => removeCase(i)} className="text-slate-400 dark:text-slate-500 hover:text-red-400 ml-1 shrink-0 text-sm">×</button>
            </div>
            <ExpressionInput
              label="Check this value"
              value={String(cond.left ?? '')}
              onChange={(v) => updateCase(i, { condition: { ...cond, left: v } })}
              placeholder="Pick a variable to check"
              nodes={otherNodes}
              testResults={testResults}
            />
            <Select
              label="Operator"
              value={String(cond.operator ?? 'eq')}
              onChange={(e) => {
                const op = e.target.value;
                updateCase(i, {
                  condition: { ...cond, operator: op, ...(NO_VALUE_OPERATORS.has(op) ? { right: '' } : {}) },
                });
              }}
              options={[
                { value: 'eq', label: 'equals (=)' },
                { value: 'neq', label: 'not equals (≠)' },
                { value: 'gt', label: 'greater than (>)' },
                { value: 'lt', label: 'less than (<)' },
                { value: 'contains', label: 'contains' },
                { value: 'isNull', label: 'is empty / null' },
                { value: 'isNotNull', label: 'is not empty / null' },
              ]}
            />
            {!NO_VALUE_OPERATORS.has(String(cond.operator ?? 'eq')) ? (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Compare to</label>
                <input
                  className="w-full bg-slate-200 dark:bg-slate-700 border border-slate-600 text-gray-800 dark:text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={String(cond.right ?? '')}
                  onChange={(e) => updateCase(i, { condition: { ...cond, right: e.target.value } })}
                  placeholder="e.g. 200"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/40 rounded text-[11px] text-slate-400 dark:text-slate-500 italic">
                No comparison value needed.
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={addCase}
        className="w-full text-xs text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white border border-dashed border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-400 rounded-md py-1.5 transition-colors"
      >
        + Add case
      </button>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        Connect each case handle on the canvas to route to the target node.
      </p>
    </>
  );
}

function TransformConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const mappings = (cfg.mappings as Record<string, string>) ?? {};
  const entries = Object.entries(mappings);

  function updateKey(oldKey: string, newKey: string) {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(mappings)) updated[k === oldKey ? newKey : k] = v;
    onChange({ mappings: updated });
  }
  function addMapping() {
    onChange({ mappings: { ...mappings, [`field${entries.length + 1}`]: '' } });
  }
  function removeMapping(key: string) {
    const updated = { ...mappings };
    delete updated[key];
    onChange({ mappings: updated });
  }

  return (
    <>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Mappings</p>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        Left = output key name. Right = where the value comes from (use{' '}
        <span className="text-blue-400">Insert variable</span> to pick from another node).
      </p>
      {entries.map(([k, v]) => (
        <TransformMappingRow
          key={k}
          outputKey={k}
          valueExpr={v}
          nodes={otherNodes}
          testResults={testResults}
          onKeyChange={(newKey) => updateKey(k, newKey)}
          onValueChange={(newVal) => onChange({ mappings: { ...mappings, [k]: newVal } })}
          onRemove={() => removeMapping(k)}
        />
      ))}
      <button
        onClick={addMapping}
        className="w-full text-xs text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white border border-dashed border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-400 rounded-md py-1.5 transition-colors"
      >
        + Add mapping
      </button>
    </>
  );
}

function TransformMappingRow({
  outputKey, valueExpr, nodes, testResults, onKeyChange, onValueChange, onRemove,
}: {
  outputKey: string;
  valueExpr: string;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  onKeyChange: (k: string) => void;
  onValueChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const valueRef = useRef<HTMLInputElement>(null);

  function handleInsert(expr: string) {
    if (valueRef.current) insertAtCursor(valueRef.current, expr, valueExpr, onValueChange);
    else onValueChange(valueExpr + expr);
    setPickerOpen(false);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <input
          className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={outputKey}
          onChange={(e) => onKeyChange(e.target.value)}
          placeholder="outputKey"
        />
        <span className="text-slate-600 text-xs shrink-0">←</span>
        <input
          ref={valueRef}
          className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={valueExpr}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="variable or static value"
        />
        {nodes.length > 0 && (
          <button
            type="button"
            onClick={() => setPickerOpen((p) => !p)}
            title="Insert variable"
            className={`shrink-0 p-1 rounded transition-colors ${
              pickerOpen ? 'bg-blue-600 text-white' : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Braces className="w-3 h-3" />
          </button>
        )}
        <button onClick={onRemove} className="text-slate-400 dark:text-slate-500 hover:text-red-400 px-1 shrink-0 text-sm">×</button>
      </div>
      {pickerOpen && (
        <VariablePickerPanel nodes={nodes} testResults={testResults} onInsert={handleInsert} />
      )}
    </div>
  );
}

function OutputConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  return (
    <ExpressionInput
      label="Output value"
      value={String(cfg.value ?? '')}
      onChange={(v) => onChange({ value: v })}
      placeholder="Pick a variable or type a static value"
      nodes={otherNodes}
      testResults={testResults}
      hint="This value becomes the final result of the workflow execution."
    />
  );
}

// ── Extract ────────────────────────────────────────────────────────────────────
//
// Pull named fields out of unstructured text (e.g. email bodies). Each field
// becomes a key on the node's output, addressable downstream via
// `{{nodes.<extractId>.<fieldName>}}`.

type ExtractStrategyKind = 'regex' | 'between' | 'labeled' | 'jsonpath' | 'ai';

interface ExtractStrategyShape {
  kind: ExtractStrategyKind;
  pattern?: string;
  flags?: string;
  group?: number;
  before?: string;
  after?: string;
  label?: string;
  stopAt?: string;
  path?: string;
  description?: string;
  type?: 'string' | 'number' | 'boolean' | 'string[]';
}

interface ExtractFieldShape {
  name: string;
  source?: string;
  strategy: ExtractStrategyShape;
  multiple?: boolean;
  required?: boolean;
  default?: string;
  transform?: 'trim' | 'lower' | 'upper' | 'normalize-email';
}

const EXTRACT_PREPROCESS_OPTIONS = [
  { value: 'none',               label: 'None (raw text)' },
  { value: 'plain-text',         label: 'Strip HTML to plain text' },
  { value: 'strip-quoted-reply', label: 'Strip HTML + quoted reply chain' },
  { value: 'strip-signature',    label: 'Strip HTML + signature block' },
];

const EXTRACT_PREPROCESS_DESCRIPTIONS: Record<string, string> = {
  'none':
    'Use the source text exactly as it arrives. Pick this only when the input is already clean plain text (e.g. a previous AI step produced it).',
  'plain-text':
    'Removes HTML tags, scripts, and styles, and collapses extra whitespace. Best when the source is an HTML email — letters, not markup, are what your rules will see.',
  'strip-quoted-reply':
    'Plain-text cleaning, plus drops the quoted reply chain ("On Tue, X wrote:", "> ...", "From: ..."). Stops you from accidentally extracting from older emails further down the thread.',
  'strip-signature':
    'Plain-text cleaning, plus drops the signature block (after a "-- " or "---" line). Stops you from picking up the sender\'s own contact info instead of the request\'s.',
};

const EXTRACT_STRATEGY_OPTIONS = [
  { value: 'between',  label: 'Between anchors' },
  { value: 'labeled',  label: 'After a label' },
  { value: 'regex',    label: 'Regular expression' },
  { value: 'jsonpath', label: 'JSONPath (structured input)' },
  { value: 'ai',       label: 'AI (natural language)' },
];

const EXTRACT_STRATEGY_DESCRIPTIONS: Record<string, string> = {
  between:
    'Find the text that sits between two short markers — anything before it, the value, anything after it. Easiest when the value has clear text on either side, e.g. "Email: …<newline>".',
  labeled:
    'Find the value that comes right after a label like "Manager:" or "Team -". Reads up to the end of the line by default.',
  regex:
    'Use a regular expression. Best for advanced or repeated patterns. Wrap the part you want in parentheses; that "capture group" is what gets returned.',
  jsonpath:
    'Pull a value out of already-structured data (a JSON object or array). Use this when your source is a node\'s output object, not free-form text.',
  ai:
    'Describe what you want in plain English; the AI reads the source and returns the value. Most robust against messy or unpredictable formats — costs an LLM call.',
};

const EXTRACT_TRANSFORM_OPTIONS = [
  { value: '',                 label: 'No post-processing' },
  { value: 'trim',             label: 'Trim whitespace' },
  { value: 'lower',            label: 'Lowercase' },
  { value: 'upper',            label: 'UPPERCASE' },
  { value: 'normalize-email',  label: 'Normalize email (Name <addr> → addr, lowercase)' },
];

/** Slugify a free-text label into a JS identifier for the field "name". */
function slugifyFieldName(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
    .slice(0, 32) || 'field';
}

/**
 * Given a sample text and a [start, end] selection range, return reasonable
 * default `before` / `after` anchors so a "between" rule can find the same
 * value on future inputs.
 *
 *   before = the closest preceding 1–2 words and any "label: " marker on the
 *            same line, capped at ~30 chars (so we don't anchor on the entire
 *            previous paragraph).
 *   after  = up to the next newline, or up to ~30 chars of trailing context if
 *            there is no newline. May be the empty string when the value sits
 *            at the very end of a line.
 */
function deriveAnchors(text: string, start: number, end: number): { before: string; after: string } {
  if (start >= end || start < 0 || end > text.length) return { before: '', after: '' };

  // Look back at most 60 chars but stop at newline or start of string
  const lookBack = text.slice(Math.max(0, start - 60), start);
  const lastNl = lookBack.lastIndexOf('\n');
  let before = lastNl >= 0 ? lookBack.slice(lastNl + 1) : lookBack;
  if (before.length > 30) before = before.slice(before.length - 30);

  // Look forward to the next newline (or 30 chars). Empty `after` is fine —
  // the runtime treats it as "end of line".
  const lookFwd = text.slice(end, Math.min(text.length, end + 60));
  const nlIdx = lookFwd.indexOf('\n');
  let after = nlIdx >= 0 ? lookFwd.slice(0, nlIdx) : lookFwd;
  if (after.length > 30) after = after.slice(0, 30);
  // If the after slice would gobble up most of the value, prefer empty
  // (i.e. "until end of line") so the rule is more permissive.
  if (after.trim().length === 0) after = '';

  return { before, after };
}

// ── Pure client-side extraction simulator (mirrors src/nodes/ExtractNode.ts) ───
//
// Used purely for the live preview. We re-implement the non-AI strategies in
// the browser so the user gets instant feedback as they type rules, without a
// network round-trip. AI fields just show "(runs at execution time)".

function previewExtract(
  field: ExtractFieldShape,
  source: string,
): { value: unknown; error?: string } {
  if (!field.name) return { value: null };
  const s = field.strategy;
  try {
    switch (s.kind) {
      case 'regex': {
        if (!s.pattern) return { value: null };
        const flags = (s.flags ?? '') + (field.multiple && !(s.flags ?? '').includes('g') ? 'g' : '');
        const re = new RegExp(s.pattern, flags);
        const g = s.group ?? 1;
        if (!field.multiple) {
          const m = source.match(re);
          if (!m) return { value: null };
          return { value: m[g] ?? m[0] };
        }
        const all: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(source)) !== null) {
          all.push(m[g] ?? m[0]);
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        return { value: all };
      }
      case 'between': {
        if (!s.before && !s.after) return { value: null };
        const beforeRe = s.before ? escapeReg(s.before) : '';
        const afterRe  = s.after  ? escapeReg(s.after)  : '$';
        const flags    = field.multiple ? 'g' : undefined;
        return previewExtract(
          { ...field, strategy: { kind: 'regex', pattern: `${beforeRe}([\\s\\S]*?)(?=${afterRe})`, flags, group: 1 } },
          source,
        );
      }
      case 'labeled': {
        if (!s.label) return { value: null };
        const labelRe = escapeReg(s.label.replace(/:\s*$/, ''));
        const stopRe  = s.stopAt ? escapeReg(s.stopAt) : '\\n|$';
        const pattern = `${labelRe}\\s*[:\\-]?\\s*([^\\n]*?)(?=${stopRe})`;
        return previewExtract(
          { ...field, strategy: { kind: 'regex', pattern, flags: field.multiple ? 'gi' : 'i', group: 1 } },
          source,
        );
      }
      case 'jsonpath':
        return { value: null, error: 'JSONPath preview is shown only at execution time.' };
      case 'ai':
        return { value: null, error: '(AI runs at execution time)' };
      default:
        return { value: null };
    }
  } catch (err) {
    return { value: null, error: (err as Error).message };
  }
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Frontend mirror of the backend's `toExtractText`. Takes one iteration item
 * (which may be a string, primitive, or object) and returns the text the
 * extraction rules should run against. When `textPath` is set we walk it;
 * otherwise we probe a few common email-shaped keys before falling back to
 * a JSON dump (so the user sees the structure when nothing matched).
 */
function pickItemText(item: unknown, textPath: string | undefined): string {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (typeof item !== 'object') return String(item);

  if (textPath && textPath.trim()) {
    const picked = walkResolvedPath(item, textPath.trim());
    if (typeof picked === 'string')      return picked;
    if (picked != null) {
      try { return JSON.stringify(picked, null, 2); }
      catch { return String(picked); }
    }
  }

  for (const key of ['body', 'text', 'content', 'message', 'snippet', 'value']) {
    const v = (item as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  try { return JSON.stringify(item, null, 2); }
  catch { return String(item); }
}

/** Probe the first item for the most likely "text" key. Returns '' if none. */
function autoDetectTextPath(item: unknown): string {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) return '';
  for (const key of ['body', 'text', 'content', 'message', 'snippet']) {
    const v = (item as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) return key;
  }
  return '';
}

const EXTRACT_MODE_OPTIONS = [
  { value: 'auto',         label: 'Auto (detect from source)' },
  { value: 'single',       label: 'Single — treat source as one block' },
  { value: 'each-item',    label: 'Each item — return one row per item' },
  { value: 'first-match',  label: 'First-match — search across items, return one merged result' },
];

const EXTRACT_MODE_DESCRIPTIONS: Record<string, string> = {
  auto:
    'If the source is a list, run extraction once per item and return `items: [...]`. Otherwise run once and return a flat object. Recommended for most cases.',
  single:
    'Always run extraction once. If the source is a list, the whole list is JSON-dumped before extraction — useful for AI fields that should reason across all items at once.',
  'each-item':
    'Always iterate. Fails the node if the source isn\'t a list. Returns `items: [...]`. Use when each item is its own independent record.',
  'first-match':
    'Walk through every item; for each field, take the first item where the rule matches. Returns one flat object — same shape as Single mode. Best when the values you need are scattered across multiple items (e.g. one email has the name, another has the address).',
};

function ExtractConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const source     = String(cfg.source ?? '');
  const preprocess = String(cfg.preprocess ?? 'plain-text');
  const fields     = (Array.isArray(cfg.fields) ? cfg.fields : []) as ExtractFieldShape[];
  const mode       = String(cfg.mode ?? 'auto') as 'auto' | 'single' | 'each-item' | 'first-match';
  const textPath   = String(cfg.textPath ?? '');
  const aiProvider    = String(cfg.aiProvider    ?? 'openai');
  const aiModel       = String(cfg.aiModel       ?? 'gpt-4o-mini');
  const aiTemperature = Number(cfg.aiTemperature ?? 0);

  const hasAiField = fields.some((f) => f.strategy?.kind === 'ai');

  // Sample text — auto-fills from the resolved source (when upstream nodes
  // have test results) but stays user-editable so they can paste anything.
  const [sampleText, setSampleText] = useState<string>('');
  const [sampleAuto, setSampleAuto] = useState(true);
  const [sampleStatus, setSampleStatus] = useState<'idle' | 'loaded' | 'unresolved'>('idle');
  // List-mode state — when the resolved source is an array we keep the items
  // here so the user can flip between them with a pager. `null` means we're
  // in single-shot mode (or nothing has resolved yet).
  const [listItems, setListItems] = useState<unknown[] | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  const sampleRef = useRef<HTMLTextAreaElement>(null);

  // Derived flags for rendering iteration UI.
  //   - `iterating` means "the panel is in list-aware mode" (textPath, pager,
  //     coverage badges all relevant). It's true for each-item, first-match,
  //     and for auto when the source is a list.
  //   - `outputIsList` means "the runtime produces items: [...]". Only true
  //     for each-item (and auto-with-array). First-match still iterates over
  //     items but the output is flat.
  const isAutoArray = mode === 'auto' && Array.isArray(listItems);
  const iterating   = mode === 'each-item' || mode === 'first-match' || isAutoArray;
  const outputIsList = mode === 'each-item' || isAutoArray;
  const itemCount = listItems?.length ?? 0;
  const safeIndex = itemCount > 0 ? Math.min(itemIndex, itemCount - 1) : 0;

  useEffect(() => {
    if (!sampleAuto) return;
    const resolved = resolveValueRaw(source, testResults);
    if (resolved == null) {
      setSampleStatus('unresolved');
      setListItems(null);
      return;
    }

    // Array source → seed list state and show item N's text.
    if (Array.isArray(resolved) && mode !== 'single') {
      setListItems(resolved);
      const idx = Math.min(itemIndex, Math.max(0, resolved.length - 1));
      const itemText = resolved.length > 0 ? pickItemText(resolved[idx], textPath) : '';
      setSampleText(clientPreprocess(itemText, preprocess));
      setSampleStatus('loaded');
      return;
    }

    // Non-array (or mode = 'single') → flat preview.
    setListItems(null);
    const asString =
      typeof resolved === 'string'  ? resolved :
      typeof resolved === 'number'  ? String(resolved) :
      typeof resolved === 'boolean' ? String(resolved) :
      (() => { try { return JSON.stringify(resolved, null, 2); } catch { return String(resolved); } })();
    setSampleText(clientPreprocess(asString, preprocess));
    setSampleStatus('loaded');
    // We deliberately don't depend on `itemIndex` here — the pager click
    // handler refreshes sampleText itself to avoid a feedback loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, preprocess, mode, textPath, testResults, sampleAuto]);

  /**
   * Refresh just the sample text from `listItems[itemIndex]`. Called by the
   * pager so flipping items doesn't need to re-resolve the upstream output.
   */
  function showItemAt(idx: number) {
    if (!listItems || listItems.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, listItems.length - 1));
    setItemIndex(clamped);
    setSampleText(clientPreprocess(pickItemText(listItems[clamped], textPath), preprocess));
    setSampleAuto(true);
    setSampleStatus('loaded');
  }

  /** Pull whatever the source resolves to RIGHT NOW into the sample pane. */
  function reloadSampleFromSource() {
    const resolved = resolveValueRaw(source, testResults);
    if (resolved == null) {
      setSampleStatus('unresolved');
      return;
    }
    setSampleAuto(true);
    if (Array.isArray(resolved) && mode !== 'single') {
      setListItems(resolved);
      setItemIndex(0);
      const itemText = resolved.length > 0 ? pickItemText(resolved[0], textPath) : '';
      setSampleText(clientPreprocess(itemText, preprocess));
    } else {
      setListItems(null);
      const asString =
        typeof resolved === 'string'  ? resolved :
        typeof resolved === 'number'  ? String(resolved) :
        typeof resolved === 'boolean' ? String(resolved) :
        (() => { try { return JSON.stringify(resolved, null, 2); } catch { return String(resolved); } })();
      setSampleText(clientPreprocess(asString, preprocess));
    }
    setSampleStatus('loaded');
  }

  /** Probe the first item and set `textPath` to the most likely text key. */
  function detectTextPath() {
    if (!listItems || listItems.length === 0) return;
    const guess = autoDetectTextPath(listItems[0]);
    if (guess) onChange({ textPath: guess });
  }

  // Pre-compute the cleaned text of every item in the list. Used to give each
  // field a "matches in X / Y items" coverage badge so the user can verify
  // their rules across all items at once instead of paging through them
  // manually. Only computed in iteration mode.
  const itemTexts = useMemo<string[]>(() => {
    if (!iterating || !listItems) return [];
    return listItems.map((it) => clientPreprocess(pickItemText(it, textPath), preprocess));
  }, [iterating, listItems, textPath, preprocess]);

  /**
   * Count how many items in the list this field's rule matches against.
   * Returns `null` for AI / JSONPath strategies (those don't run client-side)
   * or when not in iteration mode.
   */
  function coverageFor(f: ExtractFieldShape): { matched: number; total: number } | null {
    if (!iterating || itemTexts.length === 0) return null;
    const kind = f.strategy?.kind;
    if (kind === 'ai' || kind === 'jsonpath') return null;
    let matched = 0;
    for (const text of itemTexts) {
      const r = previewExtract(f, text);
      const v = r.value;
      const isMatch = v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
      if (isMatch) matched++;
    }
    return { matched, total: itemTexts.length };
  }

  function setFields(next: ExtractFieldShape[]) { onChange({ fields: next }); }

  function addManualField() {
    const idx = fields.length + 1;
    setFields([
      ...fields,
      { name: `field${idx}`, strategy: { kind: 'between', before: '', after: '' } },
    ]);
  }

  function addAiField() {
    const idx = fields.length + 1;
    setFields([
      ...fields,
      { name: `field${idx}`, strategy: { kind: 'ai', description: '', type: 'string' } },
    ]);
  }

  function addFieldFromHighlight() {
    const ta = sampleRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end   = ta.selectionEnd   ?? 0;
    if (start === end) {
      // Nothing selected — fall through to a manual blank field
      addManualField();
      return;
    }
    const selected = sampleText.slice(start, end);
    const { before, after } = deriveAnchors(sampleText, start, end);
    const guessed = slugifyFieldName(selected) || `field${fields.length + 1}`;

    setFields([
      ...fields,
      {
        name: guessed,
        strategy: { kind: 'between', before, after },
      },
    ]);
  }

  function updateField(i: number, patch: Partial<ExtractFieldShape>) {
    const next = fields.slice();
    next[i] = { ...next[i], ...patch };
    setFields(next);
  }

  function updateStrategy(i: number, patch: Partial<ExtractStrategyShape>) {
    const next = fields.slice();
    next[i] = { ...next[i], strategy: { ...next[i].strategy, ...patch } };
    setFields(next);
  }

  function changeStrategyKind(i: number, kind: ExtractStrategyKind) {
    const defaults: Record<ExtractStrategyKind, ExtractStrategyShape> = {
      regex:    { kind: 'regex',    pattern: '' },
      between:  { kind: 'between',  before: '', after: '' },
      labeled:  { kind: 'labeled',  label: '' },
      jsonpath: { kind: 'jsonpath', path: '$.' },
      ai:       { kind: 'ai',       description: '', type: 'string' },
    };
    const next = fields.slice();
    next[i] = { ...next[i], strategy: defaults[kind] };
    setFields(next);
  }

  function removeField(i: number) {
    setFields(fields.filter((_, j) => j !== i));
  }

  function moveField(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = fields.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  }

  return (
    <>
      <ExpressionInput
        label="Source"
        value={source}
        onChange={(v) => onChange({ source: v })}
        placeholder="{{nodes.gmail-list.threads[0].messages[0].body}}"
        nodes={otherNodes}
        testResults={testResults}
        hint="The text to extract fields from. Usually a previous Gmail / HTTP / LLM node's output."
      />

      <Select
        label="Source mode"
        value={mode}
        onChange={(e) => onChange({ mode: e.target.value })}
        options={EXTRACT_MODE_OPTIONS}
      />
      {EXTRACT_MODE_DESCRIPTIONS[mode] && (
        <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 rounded-md px-2.5 py-2 leading-relaxed -mt-1">
          {EXTRACT_MODE_DESCRIPTIONS[mode]}
        </p>
      )}

      {/* List-mode banner — appears whenever the panel is in list-aware mode.
          Copy depends on whether the runtime output will be `items: [...]` or
          a single merged flat object (first-match). */}
      {iterating && itemCount > 0 && (
        <div className="rounded-md border border-blue-300 dark:border-blue-700/60 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-2 space-y-1.5">
          {mode === 'first-match' ? (
            <p className="text-[11px] text-blue-800 dark:text-blue-200 leading-snug">
              <strong>Source is a list of {itemCount} item{itemCount !== 1 ? 's' : ''}.</strong>{' '}
              For each field below, Extract walks every item in order and takes the first match it finds. The output is one merged object — read fields downstream as{' '}
              <span className="font-mono">{`{{nodes.<this>.<fieldName>}}`}</span>.
            </p>
          ) : (
            <p className="text-[11px] text-blue-800 dark:text-blue-200 leading-snug">
              <strong>Source is a list of {itemCount} item{itemCount !== 1 ? 's' : ''}.</strong>{' '}
              Extract will run once per item and return{' '}
              <span className="font-mono">items: [...]</span> plus{' '}
              <span className="font-mono">count</span>. Each item's fields are accessible downstream as{' '}
              <span className="font-mono">{`{{nodes.<this>.items[0].<fieldName>}}`}</span>.
            </p>
          )}
        </div>
      )}
      {mode === 'each-item' && itemCount === 0 && sampleStatus === 'loaded' && (
        <div className="rounded-md border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/30 px-2.5 py-2">
          <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
            <strong>Source isn't a list.</strong> "Each item" mode requires an array source — the node will fail at runtime. Switch to "Auto" or fix the Source expression.
          </p>
        </div>
      )}

      {/* Per-item text path — only meaningful when iterating over objects. */}
      {iterating && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Text path within each item
          </label>
          <div className="flex gap-1">
            <input
              type="text"
              value={textPath}
              onChange={(e) => onChange({ textPath: e.target.value })}
              placeholder="body"
              className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs font-mono placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              type="button"
              onClick={detectTextPath}
              disabled={!listItems || listItems.length === 0}
              className="text-[11px] text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Look at the first item and pick a likely text key (body, text, content, …)."
            >
              Detect
            </button>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
            When each item is an object (e.g. an email), this is the path to the actual text inside it. Examples:{' '}
            <span className="font-mono">body</span>,{' '}
            <span className="font-mono">payload.body.text</span>,{' '}
            <span className="font-mono">messages[0].body</span>. Leave blank to auto-detect common keys.
          </p>
        </div>
      )}

      <Select
        label="Preprocess"
        value={preprocess}
        onChange={(e) => onChange({ preprocess: e.target.value })}
        options={EXTRACT_PREPROCESS_OPTIONS}
      />
      {EXTRACT_PREPROCESS_DESCRIPTIONS[preprocess] && (
        <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 rounded-md px-2.5 py-2 leading-relaxed -mt-1">
          {EXTRACT_PREPROCESS_DESCRIPTIONS[preprocess]}
        </p>
      )}

      {/* Sample text + highlight-to-define */}
      <div className="border-t border-slate-200 dark:border-slate-700" />
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
            {iterating && itemCount > 0
              ? <>Sample text — item <span className="font-mono">{safeIndex + 1}</span> of <span className="font-mono">{itemCount}</span></>
              : 'Sample text'}
          </p>
          <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={sampleAuto}
              onChange={(e) => setSampleAuto(e.target.checked)}
              className="w-2.5 h-2.5"
            />
            Auto-fill from source
          </label>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-0.5">
          {iterating
            ? 'Each item runs through the rules below. Use the pager to spot-check a different item.'
            : 'A real example of what the source will look like at runtime. We use it to preview your rules below.'}
        </p>
        <textarea
          ref={sampleRef}
          rows={6}
          value={sampleText}
          onChange={(e) => { setSampleAuto(false); setSampleText(e.target.value); }}
          placeholder="Paste a sample email body here, or click 'Reload from source' to pull a real upstream output."
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono whitespace-pre-wrap resize-y"
        />

        {/* Item pager — only meaningful in iteration mode with at least 2 items */}
        {iterating && itemCount > 1 && (
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => showItemAt(safeIndex - 1)}
              disabled={safeIndex <= 0}
              className="text-[11px] text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-0.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Previous item"
            >
              ← Prev
            </button>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
              {safeIndex + 1} / {itemCount}
            </span>
            <button
              type="button"
              onClick={() => showItemAt(safeIndex + 1)}
              disabled={safeIndex >= itemCount - 1}
              className="text-[11px] text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-0.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Next item"
            >
              Next →
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={reloadSampleFromSource}
            disabled={!source.trim()}
            className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-300 dark:border-emerald-700/50 rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Resolve the Source expression against the latest test results from upstream nodes and load the result here."
          >
            ⟳ Reload from source
          </button>
          {sampleStatus === 'loaded' && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
              {iterating && itemCount > 0
                ? `Loaded list of ${itemCount} item${itemCount !== 1 ? 's' : ''} from upstream.`
                : 'Loaded from upstream test result.'}
            </span>
          )}
          {sampleStatus === 'unresolved' && source.trim() && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              Source can't be resolved yet — run the upstream node's test first.
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1.5">
          <button
            type="button"
            onClick={addFieldFromHighlight}
            className="text-[11px] text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-md px-2.5 py-1 font-medium transition-colors"
            title="Select text in the sample first, then click to create a 'between' rule that finds it on future inputs."
          >
            + From highlighted selection
          </button>
          <button
            type="button"
            onClick={addManualField}
            className="text-[11px] text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md px-2.5 py-1 font-medium transition-colors"
          >
            + Manual rule
          </button>
          <button
            type="button"
            onClick={addAiField}
            className="text-[11px] text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 border border-purple-300 dark:border-purple-700/50 rounded-md px-2.5 py-1 font-medium transition-colors"
          >
            + AI field
          </button>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          Tip: highlight a value (an email, a name, an ID), then click <em>From highlighted selection</em>.
          We'll create a rule that locates the same value on future inputs.
        </p>
      </div>

      {/* Field list */}
      <div className="border-t border-slate-200 dark:border-slate-700" />
      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
        Fields ({fields.length})
      </p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 -mt-1 leading-relaxed">
        Each field becomes one value in this node's output. Other nodes can read it as
        {' '}<span className="font-mono text-blue-500 dark:text-blue-400">
          {outputIsList
            ? `{{nodes.<this-node>.items[0].<fieldName>}}`
            : `{{nodes.<this-node>.<fieldName>}}`}
        </span>.
      </p>
      {iterating && itemCount > 1 && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-2.5 py-2 -mt-1 space-y-1">
          {mode === 'first-match' ? (
            <>
              <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
                <strong>Each field walks every item until it finds a match.</strong> A rule that matches in any one item will populate the field for the whole result.
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                The "preview" shows the rule's result against the item currently in the sample box. The "matches X / {itemCount}" badge tells you how many items the rule matches — anything ≥ 1 is enough.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
                <strong>Every field runs against every item.</strong> A rule that only matches some items will produce <span className="font-mono">null</span> on the rest — that's normal.
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                The "preview" next to each rule shows the result for the item currently in the sample box above. The "matches X / {itemCount}" badge tells you how many items the rule matches across the entire list.
              </p>
            </>
          )}
        </div>
      )}

      {fields.length === 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
          No fields yet. Highlight text in the sample above to create one.
        </p>
      )}

      {fields.map((f, i) => (
        <ExtractFieldRow
          key={i}
          field={f}
          sampleText={sampleText}
          coverage={coverageFor(f)}
          mode={mode}
          onChange={(patch) => updateField(i, patch)}
          onChangeStrategy={(patch) => updateStrategy(i, patch)}
          onChangeStrategyKind={(kind) => changeStrategyKind(i, kind)}
          onRemove={() => removeField(i)}
          onMoveUp={i > 0 ? () => moveField(i, -1) : undefined}
          onMoveDown={i < fields.length - 1 ? () => moveField(i, 1) : undefined}
        />
      ))}

      {hasAiField && (() => {
        const providerModels = LLM_MODELS[aiProvider] ?? LLM_MODELS.openai;
        const modelValue = providerModels.some((m) => m.value === aiModel)
          ? aiModel
          : providerModels[0].value;
        const providerInfo = LLM_PROVIDERS[aiProvider];
        const modelInfo = providerModels.find((m) => m.value === modelValue);

        function handleAiProviderChange(newProvider: string) {
          const firstModel = (LLM_MODELS[newProvider] ?? LLM_MODELS.openai)[0].value;
          onChange({ aiProvider: newProvider, aiModel: firstModel });
        }

        return (
          <>
            <div className="border-t border-slate-200 dark:border-slate-700" />
            <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
              AI Settings
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-1">
              All AI fields with the same source are extracted in a single LLM call to keep cost low.
            </p>
            <Select
              label="Provider"
              value={aiProvider}
              onChange={(e) => handleAiProviderChange(e.target.value)}
              options={Object.entries(LLM_PROVIDERS).map(([value, info]) => ({ value, label: info.label }))}
            />
            {providerInfo && (
              <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 rounded-md px-2.5 py-2 leading-relaxed -mt-1">
                {providerInfo.description}
              </p>
            )}

            <Select
              label="Model"
              value={modelValue}
              onChange={(e) => onChange({ aiModel: e.target.value })}
              options={providerModels}
            />
            {modelInfo && (
              <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 rounded-md px-2.5 py-2 leading-relaxed -mt-1">
                {modelInfo.description}
              </p>
            )}
            {modelInfo?.preview && (
              <div className="flex gap-2 items-start bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-md px-2.5 py-2 -mt-1">
                <span className="text-amber-500 dark:text-amber-400 mt-px shrink-0">⚠</span>
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  <strong>Preview model</strong> — not yet generally available. Behavior, pricing, or availability may change. Not recommended for critical production workflows.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                Temperature ({aiTemperature.toFixed(1)})
              </label>
              <input
                type="range" min={0} max={1} step={0.1}
                value={aiTemperature}
                onChange={(e) => onChange({ aiTemperature: Number(e.target.value) })}
                className="w-full"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Lower (0.0) = strict, deterministic answers. Higher = more creative.
                For structured extraction, keep this near 0.
              </p>
            </div>
          </>
        );
      })()}
    </>
  );
}

function clientPreprocess(text: string, mode: string): string {
  if (!text) return '';
  let out = text;
  if (mode === 'plain-text' || mode === 'strip-quoted-reply' || mode === 'strip-signature') {
    out = out
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>(\s*)/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, ' ');
  }
  if (mode === 'strip-quoted-reply') {
    const idx = [/^On .+ wrote:\s*$/im, /^From:\s.+$/im, /^>\s/m]
      .map((re) => out.search(re)).filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), out.length);
    out = out.slice(0, idx).trimEnd();
  } else if (mode === 'strip-signature') {
    out = out.replace(/\n[-_=]{2,}\s*\n[\s\S]*$|\n--\s*\n[\s\S]*$/, '').trimEnd();
  }
  return out.replace(/\r\n/g, '\n');
}

function ExtractFieldRow({
  field, sampleText, coverage, mode, onChange, onChangeStrategy, onChangeStrategyKind, onRemove, onMoveUp, onMoveDown,
}: {
  field: ExtractFieldShape;
  sampleText: string;
  /** Across-all-items match stats. Null when not iterating or strategy can't be previewed client-side. */
  coverage: { matched: number; total: number } | null;
  /** Source mode — used to decide whether partial coverage + Required is actually a problem. */
  mode: 'auto' | 'single' | 'each-item' | 'first-match';
  onChange: (patch: Partial<ExtractFieldShape>) => void;
  onChangeStrategy: (patch: Partial<ExtractStrategyShape>) => void;
  onChangeStrategyKind: (kind: ExtractStrategyKind) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const preview = useMemo(() => previewExtract(field, sampleText), [field, sampleText]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Required-failure prediction: in each-item / auto-array modes, any item
  // missing the value fails the node. In first-match mode, only ZERO matches
  // is fatal — at least one match is enough to satisfy `required`.
  const requiredWarning =
    field.required && coverage && (
      mode === 'first-match'
        ? coverage.matched === 0
        : coverage.matched < coverage.total
    );

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-2 space-y-2">
      {/* Header: name + actions */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0 space-y-0.5">
            <label className="block text-[9px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">field name</label>
            <input
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={field.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="fieldName"
            />
          </div>
          <div className="flex items-center shrink-0 self-end pb-0.5">
            {onMoveUp && (
              <button onClick={onMoveUp} title="Move up" className="text-slate-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-white px-1 text-xs">↑</button>
            )}
            {onMoveDown && (
              <button onClick={onMoveDown} title="Move down" className="text-slate-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-white px-1 text-xs">↓</button>
            )}
            <button onClick={onRemove} title="Remove field" className="text-slate-400 dark:text-slate-500 hover:text-red-400 px-1 text-sm">×</button>
          </div>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
          The key downstream nodes use to read this value (e.g. <span className="font-mono">requesterEmail</span>). Use a short identifier — letters, numbers, no spaces.
        </p>
      </div>

      {/* Strategy picker + description */}
      <div className="space-y-0.5">
        <Select
          label="how to find it"
          value={field.strategy.kind}
          onChange={(e) => onChangeStrategyKind(e.target.value as ExtractStrategyKind)}
          options={EXTRACT_STRATEGY_OPTIONS}
        />
        {EXTRACT_STRATEGY_DESCRIPTIONS[field.strategy.kind] && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
            {EXTRACT_STRATEGY_DESCRIPTIONS[field.strategy.kind]}
          </p>
        )}
      </div>

      {/* Strategy-specific inputs */}
      {field.strategy.kind === 'between' && (
        <div className="grid grid-cols-1 gap-2">
          <LabeledMiniInput
            label="before"
            value={field.strategy.before ?? ''}
            onChange={(v) => onChangeStrategy({ before: v })}
            placeholder="Email: "
            hint="The text that appears immediately BEFORE the value you want. Match it exactly, including punctuation and spaces."
          />
          <LabeledMiniInput
            label="after"
            value={field.strategy.after ?? ''}
            onChange={(v) => onChangeStrategy({ after: v })}
            placeholder="(empty = end of line)"
            hint="The text that appears immediately AFTER the value. Leave empty to read until the end of the current line."
          />
        </div>
      )}

      {field.strategy.kind === 'labeled' && (
        <div className="grid grid-cols-1 gap-2">
          <LabeledMiniInput
            label="label"
            value={field.strategy.label ?? ''}
            onChange={(v) => onChangeStrategy({ label: v })}
            placeholder="Manager:"
            hint="The label that introduces the value (e.g. 'Manager:'). The colon is optional — we'll handle it for you."
          />
          <LabeledMiniInput
            label="stop at"
            value={field.strategy.stopAt ?? ''}
            onChange={(v) => onChangeStrategy({ stopAt: v })}
            placeholder="(empty = end of line)"
            hint="Where to stop reading. Leave empty to stop at the end of the line. Set to ',' or ' and' for inline lists."
          />
        </div>
      )}

      {field.strategy.kind === 'regex' && (
        <div className="space-y-2">
          <LabeledMiniInput
            label="pattern"
            value={field.strategy.pattern ?? ''}
            onChange={(v) => onChangeStrategy({ pattern: v })}
            placeholder="Email:\\s*(\\S+)"
            mono
            hint="A regular expression. Wrap the part you want returned in parentheses (...) — that's the capture group."
          />
          <div className="grid grid-cols-2 gap-2">
            <LabeledMiniInput
              label="flags"
              value={field.strategy.flags ?? ''}
              onChange={(v) => onChangeStrategy({ flags: v })}
              placeholder="i"
              hint="i = ignore case · s = . matches newlines · m = multi-line ^/$. Leave empty for none."
            />
            <div className="space-y-0.5">
              <label className="block text-[9px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">capture group</label>
              <input
                type="number" min={0}
                value={field.strategy.group ?? 1}
                onChange={(e) => onChangeStrategy({ group: Number(e.target.value) })}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
                Which group to return. 0 = the whole match · 1 = the first (...) group · 2 = the second, and so on.
              </p>
            </div>
          </div>
        </div>
      )}

      {field.strategy.kind === 'jsonpath' && (
        <LabeledMiniInput
          label="path"
          value={field.strategy.path ?? ''}
          onChange={(v) => onChangeStrategy({ path: v })}
          placeholder="$.user.email"
          mono
          hint="A JSONPath expression. $ means the root. Examples: $.users[0].email · $.threads[*].subject"
        />
      )}

      {field.strategy.kind === 'ai' && (
        <div className="space-y-2">
          <div className="space-y-0.5">
            <label className="block text-[9px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">describe what to extract</label>
            <textarea
              rows={2}
              value={field.strategy.description ?? ''}
              onChange={(e) => onChangeStrategy({ description: e.target.value })}
              placeholder="The requester's email address"
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
              Describe the value in plain English, like you would to a colleague. The AI reads the source and returns just this value.
            </p>
          </div>
          <div className="space-y-0.5">
            <Select
              label="output type"
              value={field.strategy.type ?? 'string'}
              onChange={(e) => onChangeStrategy({ type: e.target.value as 'string' | 'number' | 'boolean' | 'string[]' })}
              options={[
                { value: 'string',   label: 'string'    },
                { value: 'number',   label: 'number'    },
                { value: 'boolean',  label: 'boolean'   },
                { value: 'string[]', label: 'string[]'  },
              ]}
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
              How to interpret the AI's answer. Use <span className="font-mono">number</span> for amounts/counts,
              <span className="font-mono"> boolean</span> for yes/no, <span className="font-mono">string[]</span> for lists.
            </p>
          </div>
        </div>
      )}

      {/* Live preview + across-all-items coverage */}
      <div className="px-1 flex flex-wrap items-center gap-1.5">
        <PreviewBadge value={preview.value} error={preview.error} />
        {coverage && <CoverageBadge matched={coverage.matched} total={coverage.total} mode={mode} />}
      </div>

      {/* Required + bad coverage = guaranteed runtime failure. Warning copy
          depends on the mode because the meaning of "bad coverage" differs:
          per-item modes need ALL items to match; first-match needs at least
          one. */}
      {requiredWarning && coverage && (
        <div className="rounded-md border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-900/30 px-2.5 py-1.5 mx-1">
          {mode === 'first-match' ? (
            <>
              <p className="text-[11px] text-rose-800 dark:text-rose-200 leading-snug">
                <strong>This field is Required</strong> but doesn't match any of the {coverage.total} items. The node will fail at runtime.
              </p>
              <p className="text-[10px] text-rose-700 dark:text-rose-300 leading-snug mt-0.5">
                Fix: broaden the rule's anchors / label so at least one item contains the value, uncheck "Required" (the field will become <span className="font-mono">null</span>), or set a Default value.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-rose-800 dark:text-rose-200 leading-snug">
                <strong>This field is marked Required</strong> but only matches {coverage.matched} of {coverage.total} items. The node will fail at runtime on the first item that doesn't match.
              </p>
              <p className="text-[10px] text-rose-700 dark:text-rose-300 leading-snug mt-0.5">
                Fix: open <em>Advanced</em> below and uncheck "Required" (missing items become <span className="font-mono">null</span>), set a Default value, or adjust your rule so it matches every item. <em>Or</em> change Source mode to <strong>First-match</strong> at the top — the values you need would be merged across items into one result.
              </p>
            </>
          )}
        </div>
      )}

      {/* Advanced toggles */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        className="text-[10px] text-slate-500 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
      >
        {advancedOpen ? '▾' : '▸'} Advanced
      </button>
      {advancedOpen && (
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(e) => onChange({ required: e.target.checked })}
              className="w-3 h-3"
            />
            Required (fail if missing)
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!field.multiple}
              onChange={(e) => onChange({ multiple: e.target.checked })}
              className="w-3 h-3"
            />
            Match all (return array)
          </label>
          <LabeledMiniInput
            label="default"
            value={field.default ?? ''}
            onChange={(v) => onChange({ default: v })}
            placeholder="(empty)"
          />
          <Select
            label="post-process"
            value={field.transform ?? ''}
            onChange={(e) => onChange({ transform: (e.target.value || undefined) as ExtractFieldShape['transform'] })}
            options={EXTRACT_TRANSFORM_OPTIONS}
          />
        </div>
      )}
    </div>
  );
}

function LabeledMiniInput({
  label, value, onChange, placeholder, mono = false, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  /** Plain-language description shown beneath the input. */
  hint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <label className="block text-[9px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${mono ? 'font-mono' : ''}`}
      />
      {hint && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">{hint}</p>
      )}
    </div>
  );
}

function PreviewBadge({ value, error }: { value: unknown; error?: string }) {
  if (error) {
    return (
      <p className="text-[10px] text-amber-600 dark:text-amber-400 italic">
        {error}
      </p>
    );
  }
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return (
      <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
        no match
      </p>
    );
  }
  if (Array.isArray(value)) {
    return (
      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono break-all">
        [{value.length}] {value.slice(0, 3).map((v) => JSON.stringify(v)).join(', ')}{value.length > 3 ? ', …' : ''}
      </p>
    );
  }
  const str = String(value);
  return (
    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono break-all">
      → {str.length > 80 ? str.slice(0, 80) + '…' : str}
    </p>
  );
}

/**
 * Across-all-items coverage badge for fields in iteration mode. Tells the
 * user how many list items the rule matches so they can spot bad anchors
 * without manually flipping through every item with the pager.
 *
 * The "is partial coverage a problem?" question depends on the source mode:
 *   - each-item / auto-array → every item needs to match, partial = amber.
 *   - first-match            → just one match is enough, partial = green.
 */
function CoverageBadge({
  matched, total, mode,
}: {
  matched: number;
  total: number;
  mode: 'auto' | 'single' | 'each-item' | 'first-match';
}) {
  if (total === 0) return null;
  const all  = matched === total;
  const none = matched === 0;
  const partialOk = mode === 'first-match' && matched > 0; // first-match treats any hit as success

  const cls =
    none           ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700/50' :
    all || partialOk
                   ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700/50' :
                     'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700/50';
  const icon = none ? '✗' : (all || partialOk) ? '✓' : '◐';
  const tip =
    none           ? `Doesn't match any item — check your anchors / labels.` :
    all            ? `Matches in every item (${matched} / ${total}).` :
    partialOk      ? `Matches in ${matched} of ${total} items — that's enough for First-match mode.` :
                     `Matches some items only — for items where it doesn't match, the field will be null.`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title={tip}
    >
      <span>{icon}</span>
      <span>matches in {matched} / {total}</span>
    </span>
  );
}

// ── Message Formatter ──────────────────────────────────────────────────────────

const FORMATTER_MEDIUM_OPTIONS = [
  { value: 'slack',  label: 'Slack (mrkdwn)'        },
  { value: 'teams',  label: 'Microsoft Teams'        },
  { value: 'gmail',  label: 'Gmail (HTML email)'     },
  { value: 'gdocs',  label: 'Google Docs (plain text)' },
];

const FORMATTER_MEDIUM_HINTS: Record<string, string> = {
  slack: 'Output uses Slack mrkdwn: *bold*, _italic_, • bullets, >blockquote.',
  teams: 'Output is sent as HTML so Teams renders bold, italic, headings, and lists correctly.',
  gmail: 'Output is wrapped in HTML — paste directly into a Gmail send body.',
  gdocs: 'Output is clean plain text with decorative heading underlines and • bullets.',
};

const TEAMS_LAYOUT_HINTS: Record<string, string> = {
  table: 'Data from nodes is displayed in a compact key → value table.',
  text:  'Data from nodes is displayed as indented bullet points.',
};

const GMAIL_LAYOUT_HINTS: Record<string, string> = {
  table: 'Data from nodes is displayed in a compact key → value table.',
  text:  'Data from nodes is displayed as indented bullet points.',
};


const FORMATTER_SYNTAX_GUIDE = `Write your message using simple markdown:
  # Title  →  heading
  **text**  →  bold
  *text* or _text_  →  italic
  - item  →  bullet
  1. item  →  numbered
  > text  →  quote
  ---  →  divider
  {{nodes.nodeId.field}}  →  insert a value from another node`;

function MessageFormatterConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const medium      = String(cfg.medium      ?? 'slack');
  const teamsLayout = String(cfg.teamsLayout ?? 'table') as 'table' | 'text';
  const gmailLayout = String(cfg.gmailLayout ?? 'table') as 'table' | 'text';

  return (
    <>
      <Select
        label="Target Medium"
        value={medium}
        onChange={(e) => onChange({ medium: e.target.value })}
        options={FORMATTER_MEDIUM_OPTIONS}
      />
      {FORMATTER_MEDIUM_HINTS[medium] && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">{FORMATTER_MEDIUM_HINTS[medium]}</p>
      )}

      {medium === 'teams' && (
        <div className="space-y-1">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Data Layout
          </span>
          <div className="flex gap-2">
            {(['table', 'text'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onChange({ teamsLayout: opt })}
                className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  teamsLayout === opt
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                    : 'border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-400'
                }`}
              >
                {opt === 'table' ? 'Tabular' : 'Bullet Text'}
              </button>
            ))}
          </div>
          {TEAMS_LAYOUT_HINTS[teamsLayout] && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              {TEAMS_LAYOUT_HINTS[teamsLayout]}
            </p>
          )}
        </div>
      )}

      {medium === 'gmail' && (
        <div className="space-y-1">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Data Layout
          </span>
          <div className="flex gap-2">
            {(['table', 'text'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onChange({ gmailLayout: opt })}
                className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  gmailLayout === opt
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                    : 'border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-400'
                }`}
              >
                {opt === 'table' ? 'Tabular' : 'Bullet Text'}
              </button>
            ))}
          </div>
          {GMAIL_LAYOUT_HINTS[gmailLayout] && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              {GMAIL_LAYOUT_HINTS[gmailLayout]}
            </p>
          )}
        </div>
      )}


      <ExpressionTextArea
        label="Message Template"
        value={String(cfg.template ?? '')}
        onChange={(v) => onChange({ template: v })}
        placeholder={FORMATTER_SYNTAX_GUIDE}
        nodes={otherNodes}
        testResults={testResults}
        rows={8}
        resizable
      />
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        Use <span className="text-blue-400">Insert variable</span> to embed values from other nodes.
        The output key <span className="font-mono text-emerald-400">formattedText</span> contains
        the final formatted string ready to pass to the next node.
      </p>
    </>
  );
}

// ── Google Workspace shared helper ─────────────────────────────────────────────

function CredentialSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: credentials = [], isLoading } = useCredentialList();
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Google Account</label>
      {isLoading ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Loading accounts…</p>
      ) : credentials.length === 0 ? (
        <p className="text-[10px] text-amber-400">
          No Google accounts connected. Click <strong>Credentials</strong> in the toolbar to connect one.
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: '— select account —' },
            ...credentials.map((c) => ({ value: c.id, label: c.email })),
          ]}
        />
      )}
    </div>
  );
}

// ── EmailTagInput ─────────────────────────────────────────────────────────────

function EmailTagInput({
  label,
  value,
  onChange,
  placeholder,
  optional = false,
  nodes = [],
  testResults = {},
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  optional?: boolean;
  nodes?: CanvasNode[];
  testResults?: Record<string, NodeTestResult>;
}) {
  const [input, setInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(raw: string) {
    const trimmed = raw.trim().replace(/,\s*$/, '');
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      e.preventDefault();
      commit(input);
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function handleInsert(expr: string) {
    setInput((prev) => prev + expr);
    setPickerOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
          {optional && <span className="ml-1 text-slate-400 dark:text-slate-500 font-normal">(optional)</span>}
        </label>
        {nodes.length > 0 && (
          <button
            type="button"
            onClick={() => setPickerOpen((p) => !p)}
            title="Insert a variable from another node"
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
              pickerOpen ? 'bg-blue-600 text-white' : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Braces className="w-2.5 h-2.5" />
            Insert variable
          </button>
        )}
      </div>
      <div
        className="flex flex-wrap gap-1 min-h-[30px] bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1.5 focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((email, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] rounded px-1.5 py-0.5 max-w-full"
          >
            <span className="break-all">{email}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, idx) => idx !== i)); }}
              className="ml-0.5 text-blue-400 hover:text-red-500 dark:text-blue-500 dark:hover:text-red-400 leading-none flex-shrink-0"
              aria-label={`Remove ${email}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (input.trim()) commit(input); }}
          placeholder={value.length === 0 ? (placeholder ?? 'name@example.com') : ''}
          className="flex-1 min-w-[140px] bg-transparent text-xs text-gray-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 outline-none py-0.5"
        />
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">Press Enter, Tab, or comma to add each entry</p>
      {pickerOpen && (
        <VariablePickerPanel nodes={nodes} testResults={testResults} onInsert={handleInsert} />
      )}
    </div>
  );
}

// ── GmailConfig ────────────────────────────────────────────────────────────────

// ── Reusable Gmail sub-components ─────────────────────────────────────────────

// ── Attachment types / MIME guesser (mirrors backend map) ─────────────────────

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain', csv: 'text/csv', html: 'text/html',
  json: 'application/json', zip: 'application/zip', mp4: 'video/mp4',
};

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

interface AttachmentEntry {
  id: string;            // UI-only key
  source: 'upload' | 'expression';
  filename: string;
  mimeType?: string;
  data: string;          // base64 (upload) or {{expression}} (expression)
}

function newEntry(): AttachmentEntry {
  return { id: crypto.randomUUID(), source: 'upload', filename: '', mimeType: '', data: '' };
}

/** Attachment manager used inside Send Email and Reply to a Message */
function GmailAttachmentInput({ cfg, onChange, otherNodes, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const raw = (cfg.attachments as AttachmentEntry[] | undefined) ?? [];

  function save(list: AttachmentEntry[]) {
    // Strip UI-only `id` and `source` before persisting — keep data clean for backend
    onChange({
      attachments: list.map(({ filename, mimeType, data }) => ({ filename, mimeType, data })),
      // Store full entries (with id+source) only in a UI shadow field so we can edit them
      _attachmentsUI: list,
    });
  }

  // Rehydrate from shadow UI field so source+id survive config round-trips
  const entries: AttachmentEntry[] = (() => {
    const ui = cfg._attachmentsUI as AttachmentEntry[] | undefined;
    if (ui && ui.length === raw.length) return ui;
    return raw.map((a) => ({
      id: crypto.randomUUID(),
      source: (EXPR_RE.test(a.data) ? 'expression' : 'upload') as 'upload' | 'expression',
      filename: a.filename ?? '',
      mimeType: a.mimeType ?? '',
      data:     a.data ?? '',
    }));
  })();

  function update(id: string, patch: Partial<AttachmentEntry>) {
    save(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function remove(id: string) { save(entries.filter((e) => e.id !== id)); }

  function addUpload()     { save([...entries, { ...newEntry(), source: 'upload'     }]); }
  function addExpression() { save([...entries, { ...newEntry(), source: 'expression' }]); }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Handle one or many files selected via the file input.
   * The first file updates the existing placeholder entry (id); any additional
   * files are appended as brand-new entries so all files are captured at once.
   */
  async function handleFilesChange(id: string, files: FileList) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const resolved = await Promise.all(
      fileArray.map(async (file) => ({
        filename: file.name,
        mimeType: file.type || guessMime(file.name),
        data:     await readFileAsBase64(file),
      }))
    );

    // Update the placeholder entry with the first file, then append the rest
    const [first, ...rest] = resolved;
    const extra: AttachmentEntry[] = rest.map((r) => ({
      ...newEntry(),
      source:   'upload' as const,
      ...r,
    }));

    // We need the current entries snapshot here, so use functional save
    save(
      entries.map((e) => (e.id === id ? { ...e, ...first } : e)).concat(extra)
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Attachments <span className="text-slate-400 dark:text-slate-500 font-normal">(optional)</span>
        </label>
        <div className="flex gap-1.5">
          <button type="button" onClick={addUpload}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
            + Upload file
          </button>
          <button type="button" onClick={addExpression}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
            <Braces className="w-2.5 h-2.5" /> From node
          </button>
        </div>
      </div>

      {entries.length === 0 && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
          No attachments. Click "+ Upload file" for a local file, or "From node" to attach output from another node (e.g. Google Drive, Docs, Sheets).
        </p>
      )}

      {/* Per-file size indicator — matches Gmail's 25 MB inline limit */}
      {entries.some((e) => e.source === 'upload' && e.data) && (() => {
        // Gmail limit: 25 MB decoded. base64 length × 0.75 ≈ decoded bytes.
        const GMAIL_LIMIT = 25 * 1024 * 1024;
        const oversized = entries.filter(
          (e) => e.source === 'upload' && e.data &&
                 Math.ceil(e.data.length * 0.75) > GMAIL_LIMIT
        );
        const undersized = entries.filter(
          (e) => e.source === 'upload' && e.data &&
                 Math.ceil(e.data.length * 0.75) <= GMAIL_LIMIT
        );
        return (
          <div className="space-y-1.5">
            {undersized.length > 0 && (
              <div className="flex gap-2 rounded-md border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
                  {undersized.length} file{undersized.length > 1 ? 's' : ''} within Gmail's 25 MB limit — will be attached directly.
                </p>
              </div>
            )}
            {oversized.length > 0 && (
              <div className="flex gap-2 rounded-md border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
                <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-[10px] text-blue-700 dark:text-blue-300 leading-relaxed space-y-0.5">
                  <p><strong>{oversized.length} file{oversized.length > 1 ? 's' : ''} exceed{oversized.length === 1 ? 's' : ''} Gmail's 25 MB limit</strong> — just like Gmail itself, these will be automatically uploaded to Google Drive and a download link will be inserted into the email body.</p>
                  <ul className="pl-3 list-disc space-y-0.5 mt-1">
                    {oversized.map((e) => (
                      <li key={e.id}>{e.filename} ({(Math.ceil(e.data.length * 0.75) / 1024 / 1024).toFixed(1)} MB)</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="space-y-2">
        {entries.map((att) => (
          <div key={att.id}
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-2.5 space-y-2">
            {/* Header row */}
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                att.source === 'upload'
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300'
                  : 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300'
              }`}>
                {att.source === 'upload' ? 'Local file' : 'From node'}
              </span>
              <button type="button" onClick={() => remove(att.id)}
                className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors ml-auto">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {att.source === 'upload' ? (
              /* ── Local file upload ── */
              <div className="space-y-1.5">
                <label className="flex flex-col gap-1 cursor-pointer group">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">File</span>
                  <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs transition-colors ${
                    att.data
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                      : 'border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 group-hover:border-blue-400 dark:group-hover:border-blue-500'
                  }`}>
                    {att.data ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{att.filename || 'File loaded'}</span>
                      </>
                    ) : (
                      <>
                        <span>Click to choose a file…</span>
                      </>
                    )}
                  </div>
                  <input type="file" multiple className="sr-only"
                    onChange={(e) => { if (e.target.files?.length) handleFilesChange(att.id, e.target.files); }} />
                </label>
                {att.data && (
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
                    {att.filename} · {att.mimeType}
                  </p>
                )}
              </div>
            ) : (
              /* ── Expression / from node ── */
              <div className="space-y-1.5">
                <ExpressionInput
                  label="Filename"
                  value={att.filename}
                  onChange={(v) => update(att.id, {
                    filename: v,
                    mimeType: att.mimeType || (EXPR_RE.test(v) ? '' : guessMime(v)),
                  })}
                  placeholder="report.pdf or {{nodes.x.filename}}"
                  nodes={otherNodes}
                  testResults={testResults}
                />
                <ExpressionInput
                  label="File content (base64)"
                  value={att.data}
                  onChange={(v) => update(att.id, { data: v })}
                  placeholder="{{nodes.gdrive-node.fileContent}}"
                  nodes={otherNodes}
                  testResults={testResults}
                  hint="Must resolve to a base64-encoded string at runtime."
                />
                <div className="space-y-0.5">
                  <label className="text-[10px] text-slate-500 dark:text-slate-400">
                    MIME type <span className="text-slate-400 font-normal">(optional — auto-detected from filename)</span>
                  </label>
                  <input
                    type="text"
                    value={att.mimeType ?? ''}
                    onChange={(e) => update(att.id, { mimeType: e.target.value })}
                    placeholder={att.filename && !EXPR_RE.test(att.filename) ? guessMime(att.filename) : 'application/pdf'}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shared body composer (To/CC/BCC/Subject/Body/HTML) used by send, send_and_wait, create_draft */
function GmailBodyComposer({ cfg, onChange, otherNodes, testResults, autoFormatBody }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  autoFormatBody: () => void;
}) {
  function toArr(v: unknown): string[] {
    if (Array.isArray(v)) return v as string[];
    if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  }
  return (
    <>
      <EmailTagInput label="To" value={toArr(cfg.to)} onChange={(v) => onChange({ to: v })}
        placeholder="recipient@example.com" nodes={otherNodes} testResults={testResults} />
      <EmailTagInput label="CC" value={toArr(cfg.cc)} onChange={(v) => onChange({ cc: v })}
        placeholder="cc@example.com" optional nodes={otherNodes} testResults={testResults} />
      <EmailTagInput label="BCC" value={toArr(cfg.bcc)} onChange={(v) => onChange({ bcc: v })}
        placeholder="bcc@example.com" optional nodes={otherNodes} testResults={testResults} />
      <ExpressionInput label="Subject" value={String(cfg.subject ?? '')} onChange={(v) => onChange({ subject: v })}
        placeholder="Email subject" nodes={otherNodes} testResults={testResults} />
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Body</label>
          <button type="button" onClick={autoFormatBody}
            title="Auto-format: normalise spacing and wrap in a greeting / sign-off"
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-violet-500 dark:text-violet-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <Wand2 className="w-2.5 h-2.5" />Auto format
          </button>
        </div>
        <ExpressionTextArea label="" value={String(cfg.body ?? '')} onChange={(v) => onChange({ body: v })}
          placeholder="Email body…" nodes={otherNodes} testResults={testResults} rows={6} resizable />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="gmail-html" checked={Boolean(cfg.isHtml)}
          onChange={(e) => onChange({ isHtml: e.target.checked })} className="w-3.5 h-3.5 rounded" />
        <label htmlFor="gmail-html" className="text-xs text-slate-500 dark:text-slate-400">Send as HTML</label>
      </div>
      <GmailAttachmentInput cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
    </>
  );
}

/** Shared Message ID input */
function GmailMessageIdInput({ cfg, onChange, otherNodes, testResults, label = 'Message ID', placeholder = 'Paste a message ID or insert variable' }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  label?: string;
  placeholder?: string;
}) {
  return (
    <ExpressionInput label={label} value={String(cfg.messageId ?? '')}
      onChange={(v) => onChange({ messageId: v })} placeholder={placeholder}
      nodes={otherNodes} testResults={testResults} />
  );
}

/** Label IDs tag input with a hint about finding them */
function GmailLabelIdsInput({ cfg, onChange }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
}) {
  const credentialId  = String(cfg.credentialId ?? '');
  const labelIds      = (cfg.labelIds as string[] | undefined) ?? [];
  const [search, setSearch] = useState('');

  const { data: allLabels, isLoading, isError } = useGmailLabels(credentialId);

  const systemLabels = (allLabels ?? []).filter((l) => l.type === 'system');
  const userLabels   = (allLabels ?? []).filter((l) => l.type === 'user');

  function filtered(list: typeof allLabels) {
    if (!list) return [];
    const q = search.trim().toLowerCase();
    return q ? list.filter((l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q)) : list;
  }

  function toggleLabel(id: string) {
    const next = labelIds.includes(id) ? labelIds.filter((x) => x !== id) : [...labelIds, id];
    onChange({ labelIds: next });
  }

  return (
    <div className="space-y-2">
      {/* ── Picker ── */}
      {!credentialId ? (
        <div className="flex gap-2 rounded-md border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <Info className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
            Select a Gmail credential above to load available labels.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading labels…
        </div>
      ) : isError ? (
        <div className="flex gap-2 rounded-md border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-700 dark:text-red-300 leading-relaxed">
            Could not load labels. You can still type label IDs manually below.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {/* Search */}
          <div className="px-2.5 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search labels…"
              className="w-full text-xs bg-transparent outline-none placeholder-zinc-400 dark:placeholder-zinc-500 text-zinc-700 dark:text-zinc-200"
            />
          </div>

          {/* Label list */}
          <div className="max-h-48 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {systemLabels.length > 0 && filtered(systemLabels).length > 0 && (
              <div>
                <p className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/40">
                  System Labels
                </p>
                {filtered(systemLabels).map((lbl) => (
                  <label key={lbl.id}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <input
                      type="checkbox"
                      checked={labelIds.includes(lbl.id)}
                      onChange={() => toggleLabel(lbl.id)}
                      className="w-3.5 h-3.5 accent-indigo-600 flex-shrink-0"
                    />
                    <span className="text-xs text-zinc-700 dark:text-zinc-200 flex-1 min-w-0 truncate">{lbl.name}</span>
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 flex-shrink-0 font-mono">{lbl.id}</span>
                  </label>
                ))}
              </div>
            )}
            {userLabels.length > 0 && filtered(userLabels).length > 0 && (
              <div>
                <p className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/40">
                  Custom Labels
                </p>
                {filtered(userLabels).map((lbl) => (
                  <label key={lbl.id}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <input
                      type="checkbox"
                      checked={labelIds.includes(lbl.id)}
                      onChange={() => toggleLabel(lbl.id)}
                      className="w-3.5 h-3.5 accent-indigo-600 flex-shrink-0"
                    />
                    <span className="text-xs text-zinc-700 dark:text-zinc-200 flex-1 min-w-0 truncate">{lbl.name}</span>
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 flex-shrink-0 font-mono">{lbl.id}</span>
                  </label>
                ))}
              </div>
            )}
            {filtered(allLabels ?? []).length === 0 && (
              <p className="px-2.5 py-3 text-xs text-zinc-400 dark:text-zinc-500 text-center">No labels match "{search}"</p>
            )}
          </div>

          {/* Selected summary */}
          {labelIds.length > 0 && (
            <div className="px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 border-t border-zinc-200 dark:border-zinc-700 flex flex-wrap gap-1">
              {labelIds.map((id) => {
                const lbl = allLabels?.find((l) => l.id === id);
                return (
                  <span key={id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-indigo-100 dark:bg-indigo-800/50 text-indigo-700 dark:text-indigo-300 font-medium">
                    {lbl?.name ?? id}
                    <button type="button" onClick={() => toggleLabel(id)}
                      className="hover:text-red-500 transition-colors">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── GmailRemoveLabelInput ────────────────────────────────────────────────────
// When the message ID is a static value: shows only labels on that message.
// When the message ID is a variable expression: shows all account labels so
// the user can still pre-select which ones to remove at runtime.

function GmailRemoveLabelInput({ cfg, onChange, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  testResults: Record<string, NodeTestResult>;
}) {
  const credentialId  = String(cfg.credentialId ?? '');
  const messageId     = String(cfg.messageId ?? '');
  const labelIds      = (cfg.labelIds as string[] | undefined) ?? [];
  const [search, setSearch] = useState('');

  const msgIdIsExpr = isExpression(messageId);
  // Try to resolve the expression from already-run test results
  const resolvedMessageId = msgIdIsExpr ? resolveValue(messageId, testResults) : messageId;
  const isResolved        = !msgIdIsExpr || resolvedMessageId !== null;

  // Use the resolved ID when available; fall back to all-account labels only when unresolvable
  const effectiveMessageId = resolvedMessageId ?? '';

  // Fetch message-specific labels whenever we have a real (non-expression) message ID
  const { data: msgLabels,  isLoading: msgLoading,  isError: msgError,  isFetching: msgFetching }
    = useGmailMessageLabels(credentialId, effectiveMessageId);
  // Fallback: all account labels when expression can't be resolved yet
  const { data: allLabels,  isLoading: allLoading,  isError: allError }
    = useGmailLabels(credentialId);

  // Which set of labels to display
  const usingFallback = msgIdIsExpr && !isResolved;
  const labels    = usingFallback ? (allLabels ?? []) : (msgLabels ?? []);
  const isLoading = usingFallback ? allLoading : (msgLoading || msgFetching);
  const isError   = usingFallback ? allError   : msgError;

  function toggleLabel(id: string) {
    const next = labelIds.includes(id) ? labelIds.filter((x) => x !== id) : [...labelIds, id];
    onChange({ labelIds: next });
  }

  const systemLabels = labels.filter((l) => l.type === 'system');
  const userLabels   = labels.filter((l) => l.type === 'user');

  function filtered(list: typeof labels) {
    const q = search.trim().toLowerCase();
    return q ? list.filter((l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q)) : list;
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Labels to remove</label>

      {/* Expression-mode notice */}
      {!!messageId && msgIdIsExpr && (
        isResolved ? (
          <div className="flex gap-2 rounded-md border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
              Variable resolved to <code className="font-mono">{resolvedMessageId}</code> — showing labels for that message.
            </p>
          </div>
        ) : (
          <div className="flex gap-2 rounded-md border border-violet-200 dark:border-violet-800/40 bg-violet-50 dark:bg-violet-900/20 px-3 py-2">
            <Braces className="w-3.5 h-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-violet-700 dark:text-violet-300 leading-relaxed">
              Message ID is a variable. <strong>Test the upstream node first</strong> to resolve it and see that message's labels — or select from all account labels below.
            </p>
          </div>
        )
      )}

      {!credentialId ? (
        <div className="flex gap-2 rounded-md border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <Info className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
            Select a Gmail credential above to load labels.
          </p>
        </div>
      ) : !messageId ? (
        <div className="flex gap-2 rounded-md border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <Info className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
            Enter a Message ID above — the labels on that message will appear here.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {usingFallback ? 'Loading account labels…' : 'Loading message labels…'}
        </div>
      ) : isError ? (
        <div className="flex gap-2 rounded-md border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-700 dark:text-red-300 leading-relaxed">
            {usingFallback
              ? 'Could not load account labels. Please check your credential.'
              : 'Could not load labels for that message. Please check the message ID and try again.'}
          </p>
        </div>
      ) : labels.length === 0 ? (
        <div className="flex gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 px-3 py-2">
          <Info className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {usingFallback ? 'No labels found for this account.' : 'This message has no labels applied. Nothing to remove.'}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {/* Search */}
          <div className="px-2.5 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={usingFallback ? 'Search all account labels…' : 'Search labels on this message…'}
              className="w-full text-xs bg-transparent outline-none placeholder-zinc-400 dark:placeholder-zinc-500 text-zinc-700 dark:text-zinc-200"
            />
          </div>

          {/* Label list */}
          <div className="max-h-48 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {systemLabels.length > 0 && filtered(systemLabels).length > 0 && (
              <div>
                <p className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/40">
                  System Labels
                </p>
                {filtered(systemLabels).map((lbl) => (
                  <label key={lbl.id}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <input type="checkbox" checked={labelIds.includes(lbl.id)} onChange={() => toggleLabel(lbl.id)}
                      className="w-3.5 h-3.5 accent-red-500 flex-shrink-0" />
                    <span className="text-xs text-zinc-700 dark:text-zinc-200 flex-1 min-w-0 truncate">{lbl.name}</span>
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 flex-shrink-0 font-mono">{lbl.id}</span>
                  </label>
                ))}
              </div>
            )}
            {userLabels.length > 0 && filtered(userLabels).length > 0 && (
              <div>
                <p className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/40">
                  Custom Labels
                </p>
                {filtered(userLabels).map((lbl) => (
                  <label key={lbl.id}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <input type="checkbox" checked={labelIds.includes(lbl.id)} onChange={() => toggleLabel(lbl.id)}
                      className="w-3.5 h-3.5 accent-red-500 flex-shrink-0" />
                    <span className="text-xs text-zinc-700 dark:text-zinc-200 flex-1 min-w-0 truncate">{lbl.name}</span>
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 flex-shrink-0 font-mono">{lbl.id}</span>
                  </label>
                ))}
              </div>
            )}
            {filtered(labels).length === 0 && (
              <p className="px-2.5 py-3 text-xs text-zinc-400 dark:text-zinc-500 text-center">No labels match "{search}"</p>
            )}
          </div>

          {/* Selected chips */}
          {labelIds.length > 0 && (
            <div className="px-2.5 py-1.5 bg-red-50 dark:bg-red-900/20 border-t border-zinc-200 dark:border-zinc-700 flex flex-wrap gap-1">
              {labelIds.map((id) => {
                const lbl = labels.find((l) => l.id === id);
                return (
                  <span key={id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-red-100 dark:bg-red-800/50 text-red-700 dark:text-red-300 font-medium">
                    {lbl?.name ?? id}
                    <button type="button" onClick={() => toggleLabel(id)}
                      className="hover:text-red-900 dark:hover:text-red-100 transition-colors">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GmailConfig ────────────────────────────────────────────────────────────────

function GmailConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action = (cfg.action as string) ?? 'send';

  const attachmentTypes = (cfg.attachmentTypes as string[] | undefined) ?? [];
  function toggleAttachType(type: string) {
    const next = attachmentTypes.includes(type)
      ? attachmentTypes.filter((t) => t !== type)
      : [...attachmentTypes, type];
    onChange({ attachmentTypes: next });
  }

  function autoFormatBody() {
    const current = String(cfg.body ?? '').trim();
    if (!current) { onChange({ body: 'Hi,\n\n\n\nBest regards,' }); return; }
    const normalised = current.split(/\r?\n/).map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const hasGreeting = /^(hi|hello|dear|hey|good\s)/i.test(normalised);
    const hasSignOff  = /(regards|sincerely|thanks|cheers|best),?\s*$/i.test(normalised);
    const withGreeting = hasGreeting ? normalised : `Hi,\n\n${normalised}`;
    onChange({ body: hasSignOff ? withGreeting : `${withGreeting}\n\nBest regards,` });
  }

  return (
    <div className="space-y-3">
      {action !== 'send_flux' && (
        <CredentialSelect value={String(cfg.credentialId ?? '')} onChange={(id) => onChange({ credentialId: id })} />
      )}

      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { group: 'Flux Actions', options: [
            { value: 'send_flux',  label: '⚡ Send via Flux (SMTP)' },
            { value: 'reply_flux', label: '⚡ Reply via Flux (SMTP)' },
          ]},
          { group: 'Message Actions', options: [
            { value: 'send',           label: 'Send Email' },
            { value: 'send_and_wait',  label: 'Send & Wait for Reply' },
            { value: 'reply',          label: 'Reply to a Message' },
            { value: 'list',           label: 'Get Many Messages' },
            { value: 'read',           label: 'Get a Message' },
            { value: 'mark_read',      label: 'Mark as Read' },
            { value: 'mark_unread',    label: 'Mark as Unread' },
            { value: 'add_label',      label: 'Add Label to Message' },
            { value: 'remove_label',   label: 'Remove Label from Message' },
            { value: 'delete_message',      label: 'Delete a Message' },
            { value: 'delete_conversation', label: 'Remove a Conversation' },
          ]},
          { group: 'Draft Actions', options: [
            { value: 'create_draft',   label: 'Create a Draft' },
            { value: 'get_draft',      label: 'Get a Draft' },
            { value: 'list_drafts',    label: 'Get Many Drafts' },
            { value: 'delete_draft',   label: 'Delete a Draft' },
          ]},
        ]}
      />

      {/* ── Send via Flux SMTP ─────────────────────────────── */}
      {action === 'send_flux' && (
        <>
          <EmailTagInput
            label="To"
            value={(() => {
              const v = cfg.to;
              if (Array.isArray(v)) return v as string[];
              if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
              return [];
            })()}
            onChange={(v) => onChange({ to: v })}
            placeholder="recipient@example.com"
            nodes={otherNodes} testResults={testResults} />
          <EmailTagInput
            label="Cc (optional)"
            value={(() => {
              const v = cfg.cc;
              if (Array.isArray(v)) return v as string[];
              if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
              return [];
            })()}
            onChange={(v) => onChange({ cc: v.length ? v : undefined })}
            placeholder="cc@example.com"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput
            label="Subject"
            value={String(cfg.subject ?? '')}
            onChange={(v) => onChange({ subject: v })}
            placeholder="Your subject line"
            nodes={otherNodes} testResults={testResults} />
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Body</label>
              <button type="button" onClick={autoFormatBody}
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-violet-500 dark:text-violet-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                <Wand2 className="w-2.5 h-2.5" />Auto format
              </button>
            </div>
            <ExpressionTextArea label="" value={String(cfg.body ?? '')} onChange={(v) => onChange({ body: v })}
              placeholder="Write your email body here…" nodes={otherNodes} testResults={testResults} rows={6} resizable />
          </div>
          <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="flux-use-template"
                checked={cfg.useFluxTemplate !== false}
                onChange={(e) => onChange({ useFluxTemplate: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <label htmlFor="flux-use-template" className="text-xs font-medium text-slate-700 dark:text-slate-200">
                Use Flux branded email template
              </label>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed pl-5">
              Wraps your body in a clean branded email card with the Flux Workflow header and footer. Disable to send raw HTML or plain text.
            </p>
            <div className="flex items-center gap-2 pl-5">
              <input type="checkbox" id="flux-is-html"
                checked={Boolean(cfg.isHtml)}
                onChange={(e) => onChange({ isHtml: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <label htmlFor="flux-is-html" className="text-xs text-slate-500 dark:text-slate-400">
                Body is HTML
              </label>
            </div>
          </div>
        </>
      )}

      {/* ── Send Email ─────────────────────────────────────── */}
      {action === 'send' && (
        <GmailBodyComposer cfg={cfg} onChange={onChange} otherNodes={otherNodes}
          testResults={testResults} autoFormatBody={autoFormatBody} />
      )}

      {/* ── Send & Wait for Reply ──────────────────────────── */}
      {action === 'send_and_wait' && (
        <>
          <GmailBodyComposer cfg={cfg} onChange={onChange} otherNodes={otherNodes}
            testResults={testResults} autoFormatBody={autoFormatBody} />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              Wait up to (minutes)
            </label>
            <input type="number" min={1} max={60} value={String(cfg.waitMinutes ?? 5)}
              onChange={(e) => onChange({ waitMinutes: Number(e.target.value) })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              The workflow will poll for a reply every 15 s, up to this limit (max 60 min).
            </p>
          </div>
        </>
      )}

      {/* ── Reply to a Message ─────────────────────────────── */}
      {action === 'reply' && (
        <>
          <ExpressionInput label="Message ID to reply to"
            value={String(cfg.replyToMessageId ?? '')}
            onChange={(v) => onChange({ replyToMessageId: v })}
            placeholder="ID of the message you're replying to"
            nodes={otherNodes} testResults={testResults} />
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Reply mode</label>
            <div className="flex gap-4">
              {([
                { value: false, label: 'Reply to sender' },
                { value: true,  label: 'Reply all' },
              ] as const).map(({ value, label }) => (
                <label key={String(value)} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="gmail-reply-mode"
                    checked={Boolean(cfg.replyAll) === value}
                    onChange={() => onChange({ replyAll: value })}
                    className="w-3 h-3 accent-blue-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
                </label>
              ))}
            </div>
            {Boolean(cfg.replyAll) && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                Replies to all original recipients (From + To + Cc). If the connected Gmail account appears in the thread it will be included.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Reply body</label>
              <button type="button" onClick={autoFormatBody}
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-violet-500 dark:text-violet-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                <Wand2 className="w-2.5 h-2.5" />Auto format
              </button>
            </div>
            <ExpressionTextArea label="" value={String(cfg.body ?? '')} onChange={(v) => onChange({ body: v })}
              placeholder="Your reply…" nodes={otherNodes} testResults={testResults} rows={5} resizable />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gmail-reply-html" checked={Boolean(cfg.isHtml)}
              onChange={(e) => onChange({ isHtml: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gmail-reply-html" className="text-xs text-slate-500 dark:text-slate-400">Send as HTML</label>
          </div>
          <GmailAttachmentInput cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
        </>
      )}

      {/* ── Reply via Flux (SMTP) ───────────────────────────── */}
      {action === 'reply_flux' && (
        <>
          <ExpressionInput label="Message ID to reply to"
            value={String(cfg.replyToMessageId ?? '')}
            onChange={(v) => onChange({ replyToMessageId: v })}
            placeholder="ID of the message you're replying to"
            nodes={otherNodes} testResults={testResults} />
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Reply mode</label>
            <div className="flex gap-4">
              {([
                { value: false, label: 'Reply to sender' },
                { value: true,  label: 'Reply all' },
              ] as const).map(({ value, label }) => (
                <label key={String(value)} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="reply-flux-mode"
                    checked={Boolean(cfg.replyAll) === value}
                    onChange={() => onChange({ replyAll: value })}
                    className="w-3 h-3 accent-blue-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
                </label>
              ))}
            </div>
            {Boolean(cfg.replyAll) && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                Replies to all original recipients (From + To + Cc). The Flux SMTP sender address is excluded since it is the one sending this reply; the connected Gmail account is kept if it appears in the thread.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Reply body</label>
              <button type="button" onClick={autoFormatBody}
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-violet-500 dark:text-violet-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                <Wand2 className="w-2.5 h-2.5" />Auto format
              </button>
            </div>
            <ExpressionTextArea label="" value={String(cfg.body ?? '')} onChange={(v) => onChange({ body: v })}
              placeholder="Your reply…" nodes={otherNodes} testResults={testResults} rows={5} resizable />
          </div>
          <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="reply-flux-use-template"
                checked={cfg.useFluxTemplate !== false}
                onChange={(e) => onChange({ useFluxTemplate: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <label htmlFor="reply-flux-use-template" className="text-xs font-medium text-slate-700 dark:text-slate-200">
                Use Flux branded email template
              </label>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed pl-5">
              Wraps your reply in a clean branded email card with the Flux Workflow header and footer. Disable to send raw HTML or plain text.
            </p>
            <div className="flex items-center gap-2 pl-5">
              <input type="checkbox" id="reply-flux-is-html"
                checked={Boolean(cfg.isHtml)}
                onChange={(e) => onChange({ isHtml: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <label htmlFor="reply-flux-is-html" className="text-xs text-slate-500 dark:text-slate-400">Body is HTML</label>
            </div>
          </div>
        </>
      )}

      {/* ── Get Many Messages (list) ───────────────────────── */}
      {action === 'list' && (
        <>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Read status</label>
            <div className="flex gap-3">
              {(['all', 'unread', 'read'] as const).map((opt) => (
                <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="gmail-read-status" value={opt}
                    checked={(cfg.readStatus as string | undefined ?? 'all') === opt}
                    onChange={() => onChange({ readStatus: opt })} className="w-3 h-3 accent-blue-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    {opt === 'all' ? 'All' : opt === 'unread' ? 'Unread only' : 'Read only'}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <EmailTagInput
            label="From (sender name or email)"
            value={(() => {
              const v = cfg.fromFilter;
              if (Array.isArray(v)) return v as string[];
              if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
              return [];
            })()}
            onChange={(v) => onChange({ fromFilter: v })}
            placeholder="john@example.com or John Smith"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Subject contains" value={String(cfg.subjectFilter ?? '')}
            onChange={(v) => onChange({ subjectFilter: v })} placeholder="Invoice for"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Body contains" value={String(cfg.bodyFilter ?? '')}
            onChange={(v) => onChange({ bodyFilter: v })} placeholder="Any text inside the email body"
            nodes={otherNodes} testResults={testResults} />
          <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="gmail-has-attach" checked={Boolean(cfg.hasAttachment)}
                onChange={(e) => onChange({ hasAttachment: e.target.checked, attachmentTypes: e.target.checked ? attachmentTypes : [] })}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <label htmlFor="gmail-has-attach" className="text-xs font-medium text-slate-600 dark:text-slate-300">Has attachment</label>
            </div>
            {Boolean(cfg.hasAttachment) && (
              <div className="pl-5 space-y-1.5">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Filter by attachment type (optional)</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {([
                    { id: 'image',  label: 'Image (jpg, png…)' },
                    { id: 'pdf',    label: 'PDF' },
                    { id: 'docs',   label: 'Word / Google Docs' },
                    { id: 'sheets', label: 'Excel / Google Sheets' },
                  ] as const).map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={attachmentTypes.includes(id)}
                        onChange={() => toggleAttachType(id)} className="w-3 h-3 rounded accent-blue-500" />
                      <span className="text-[11px] text-slate-600 dark:text-slate-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Max results</label>
            <input type="number" min={1} max={500} value={String(cfg.maxResults ?? 10)}
              onChange={(e) => onChange({ maxResults: Number(e.target.value) })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </>
      )}

      {/* ── Get a Message (read) ───────────────────────────── */}
      {action === 'read' && (
        <>
          <div className="flex gap-2 rounded-md border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 px-3 py-2.5">
            <Info className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-600 dark:text-blue-400 leading-relaxed">
              Fetches the <strong>complete content</strong> of one specific email — full body, all headers, and labels. Use a Message ID from a <strong>Get Many Messages</strong> step.
            </p>
          </div>
          <GmailMessageIdInput cfg={cfg} onChange={onChange} otherNodes={otherNodes}
            testResults={testResults} placeholder="Paste an ID or insert from Get Many Messages" />
        </>
      )}

      {/* ── Mark as Read / Unread ──────────────────────────── */}
      {(action === 'mark_read' || action === 'mark_unread') && (
        <>
          <GmailMessageIdInput cfg={cfg} onChange={onChange} otherNodes={otherNodes}
            testResults={testResults}
            placeholder={`ID of the message or thread to mark as ${action === 'mark_read' ? 'read' : 'unread'}`} />
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Apply to</label>
            <div className="flex gap-4">
              {([
                { value: 'message', label: 'This message only' },
                { value: 'thread',  label: 'Entire conversation' },
              ] as const).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name={`gmail-${action}-target`}
                    checked={(cfg.markTarget as string | undefined ?? 'message') === value}
                    onChange={() => onChange({ markTarget: value })}
                    className="w-3 h-3 accent-blue-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
                </label>
              ))}
            </div>
            {(cfg.markTarget as string | undefined) === 'thread' && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                Marks every message in the conversation as {action === 'mark_read' ? 'read' : 'unread'} in a single API call. You can pass either a message ID or a thread ID — the parent thread is resolved automatically.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Add Label ──────────────────────────────────────── */}
      {action === 'add_label' && (
        <>
          <GmailMessageIdInput cfg={cfg} onChange={onChange} otherNodes={otherNodes}
            testResults={testResults} placeholder="ID of the message to label" />
          <GmailLabelIdsInput cfg={cfg} onChange={onChange} />
        </>
      )}

      {/* ── Remove Label ───────────────────────────────────── */}
      {action === 'remove_label' && (
        <>
          <GmailMessageIdInput cfg={cfg} onChange={onChange} otherNodes={otherNodes}
            testResults={testResults} placeholder="ID of the message to modify" />
          <GmailRemoveLabelInput cfg={cfg} onChange={onChange} testResults={testResults} />
        </>
      )}

      {/* ── Delete a Message ───────────────────────────────── */}
      {action === 'delete_message' && (
        <>
          <GmailMessageIdInput cfg={cfg} onChange={onChange} otherNodes={otherNodes}
            testResults={testResults} placeholder="ID of the message to delete" />
          <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="gmail-permanent" checked={Boolean(cfg.permanent)}
                onChange={(e) => onChange({ permanent: e.target.checked })} className="w-3.5 h-3.5 rounded accent-red-500" />
              <label htmlFor="gmail-permanent" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Permanently delete (cannot be undone)
              </label>
            </div>
            {!cfg.permanent && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 pl-5">
                By default the message is moved to Trash.
              </p>
            )}
            {!!cfg.permanent && (
              <p className="text-[10px] text-red-500 pl-5 font-medium">
                ⚠ The message will be permanently deleted and cannot be recovered.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Remove a Conversation ──────────────────────────── */}
      {action === 'delete_conversation' && (
        <>
          <div className="flex gap-2 rounded-md border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
            <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-blue-700 dark:text-blue-300 leading-relaxed">
              Provide any message from the conversation. The entire thread it belongs to will be removed — including all replies and forwarded messages.
            </p>
          </div>
          <GmailMessageIdInput cfg={cfg} onChange={onChange} otherNodes={otherNodes}
            testResults={testResults} label="Any Message ID in the Conversation"
            placeholder="ID of any message in the thread" />
          <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="gmail-conv-permanent" checked={Boolean(cfg.permanent)}
                onChange={(e) => onChange({ permanent: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-red-500" />
              <label htmlFor="gmail-conv-permanent" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Permanently delete (cannot be undone)
              </label>
            </div>
            {!cfg.permanent && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 pl-5">
                By default the entire conversation is moved to Trash.
              </p>
            )}
            {!!cfg.permanent && (
              <p className="text-[10px] text-red-500 pl-5 font-medium">
                ⚠ All messages in this conversation will be permanently deleted and cannot be recovered.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Create a Draft ─────────────────────────────────── */}
      {action === 'create_draft' && (
        <GmailBodyComposer cfg={cfg} onChange={onChange} otherNodes={otherNodes}
          testResults={testResults} autoFormatBody={autoFormatBody} />
      )}

      {/* ── Get a Draft ────────────────────────────────────── */}
      {action === 'get_draft' && (
        <ExpressionInput label="Draft ID" value={String(cfg.draftId ?? '')}
          onChange={(v) => onChange({ draftId: v })}
          placeholder="Paste a draft ID or insert variable"
          nodes={otherNodes} testResults={testResults} />
      )}

      {/* ── Get Many Drafts ────────────────────────────────── */}
      {action === 'list_drafts' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Max results</label>
          <input type="number" min={1} max={500} value={String(cfg.maxDrafts ?? 10)}
            onChange={(e) => onChange({ maxDrafts: Number(e.target.value) })}
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
      )}

      {/* ── Delete a Draft ─────────────────────────────────── */}
      {action === 'delete_draft' && (
        <>
          <ExpressionInput label="Draft ID" value={String(cfg.draftId ?? '')}
            onChange={(v) => onChange({ draftId: v })}
            placeholder="ID of the draft to delete"
            nodes={otherNodes} testResults={testResults} />
          <div className="flex gap-2 rounded-md border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 px-3 py-2">
            <Info className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
              Deleting a draft is permanent and cannot be undone.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── GDrive sub-components ──────────────────────────────────────────────────────

/** Inline folder browser — lets the user navigate Drive and pick a folder. */
function GDriveFolderBrowser({ credentialId, value, valuePath, onChange, label = 'Folder', placeholder = 'My Drive (root)', foldersOnly = true, mimeTypeFilter }: {
  credentialId: string;
  value: string;
  valuePath: string;
  onChange: (id: string, path: string) => void;
  label?: string;
  placeholder?: string;
  foldersOnly?: boolean;
  /** When set, only files matching this MIME type appear (folders always show for navigation). */
  mimeTypeFilter?: string;
}) {
  const [open, setOpen]           = useState(false);
  const [browseFolderId, setBrowseFolderId] = useState<string>('root');
  const [breadcrumb, setBreadcrumb]         = useState<{ id: string; name: string }[]>([]);

  const itemType = foldersOnly ? 'folders' : 'all';
  const { data, isLoading, isError } = useGDriveItems(credentialId, browseFolderId === 'root' ? undefined : browseFolderId, itemType);

  function navigateInto(id: string, name: string) {
    setBrowseFolderId(id);
    setBreadcrumb((prev) => [...prev, { id, name }]);
  }

  function navigateToBreadcrumb(idx: number) {
    if (idx < 0) {
      setBrowseFolderId('root');
      setBreadcrumb([]);
    } else {
      setBrowseFolderId(breadcrumb[idx].id);
      setBreadcrumb((prev) => prev.slice(0, idx + 1));
    }
  }

  function selectCurrent() {
    const path = breadcrumb.length === 0
      ? 'My Drive'
      : 'My Drive / ' + breadcrumb.map((b) => b.name).join(' / ');
    onChange(browseFolderId === 'root' ? '' : browseFolderId, path);
    setOpen(false);
  }

  function selectItem(id: string, name: string) {
    const path = breadcrumb.length === 0
      ? `My Drive / ${name}`
      : `My Drive / ${breadcrumb.map((b) => b.name).join(' / ')} / ${name}`;
    onChange(id, path);
    setOpen(false);
  }

  const items = data?.items ?? [];
  const folders = items.filter((i) => i.mimeType === 'application/vnd.google-apps.folder');
  const files   = items
    .filter((i) => i.mimeType !== 'application/vnd.google-apps.folder')
    .filter((i) => !mimeTypeFilter || i.mimeType === mimeTypeFilter);

  const displayPath = valuePath || (value ? value : '');

  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>}

      {/* Selected path display */}
      <button
        type="button"
        onClick={() => { if (credentialId) setOpen((o) => !o); }}
        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-xs text-left transition-colors ${
          credentialId
            ? 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-blue-400 dark:hover:border-blue-500'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 cursor-not-allowed'
        }`}
      >
        <span className="truncate">
          {displayPath || <span className="text-slate-400 dark:text-slate-500">{placeholder}</span>}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange('', ''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange('', ''); } }}
              className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          {open ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
        </div>
      </button>

      {!credentialId && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Select a credential above to browse folders.</p>
      )}

      {/* Inline browser */}
      {open && credentialId && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* Breadcrumb nav */}
          <div className="flex items-center gap-0.5 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400 flex-wrap">
            <button type="button" onClick={() => navigateToBreadcrumb(-1)}
              className="hover:text-blue-500 dark:hover:text-blue-400 transition-colors font-medium">
              My Drive
            </button>
            {breadcrumb.map((crumb, idx) => (
              <span key={crumb.id} className="flex items-center gap-0.5">
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <button type="button" onClick={() => navigateToBreadcrumb(idx)}
                  className="hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>

          {/* Items list */}
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : isError ? (
              <div className="flex gap-2 px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-600 dark:text-red-400">Could not load items.</p>
              </div>
            ) : items.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-400 dark:text-slate-500 text-center italic">
                This folder is empty
              </p>
            ) : (
              <>
                {folders.map((item) => (
                  <div key={item.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="text-sm">📁</span>
                    <span className="flex-1 min-w-0 text-xs text-slate-700 dark:text-slate-200 truncate">{item.name}</span>
                    <div className="flex gap-1 shrink-0">
                      {!foldersOnly && (
                        <button type="button" onClick={() => selectItem(item.id, item.name)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors">
                          Select
                        </button>
                      )}
                      <button type="button" onClick={() => navigateInto(item.id, item.name)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                        Open →
                      </button>
                    </div>
                  </div>
                ))}
                {!foldersOnly && files.map((item) => (
                  <div key={item.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="text-sm">📄</span>
                    <span className="flex-1 min-w-0 text-xs text-slate-700 dark:text-slate-200 truncate">{item.name}</span>
                    <button type="button" onClick={() => selectItem(item.id, item.name)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors shrink-0">
                      Select
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Select current folder button */}
          {foldersOnly && (
            <div className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                Currently in: {breadcrumb.length === 0 ? 'My Drive' : breadcrumb[breadcrumb.length - 1].name}
              </span>
              <button type="button" onClick={selectCurrent}
                className="text-[10px] px-2 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600 dark:hover:bg-blue-400 transition-colors font-medium">
                Select this folder
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Upload input — supports local file, text/expression content, or pick from Drive. */
function GDriveUploadInput({ cfg, onChange, otherNodes, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const credentialId = String(cfg.credentialId ?? '');
  const source = (cfg.uploadSource as string | undefined) ?? 'content';

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleFileChange(file: File) {
    const data = await readFileAsBase64(file);
    onChange({ uploadFileName: file.name, uploadData: data, uploadMimeType: file.type || undefined });
  }

  return (
    <div className="space-y-3">
      {/* Source selector */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">File source</label>
        <div className="flex gap-3">
          {([['content', 'Text / expression'], ['local', 'Upload from device'], ['drive', 'From Drive folder']] as const).map(([val, lbl]) => (
            <label key={val} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="gdrive-upload-source" value={val}
                checked={source === val}
                onChange={() => onChange({ uploadSource: val })}
                className="w-3 h-3 accent-blue-500" />
              <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ── Text / expression source ─────────────────────────── */}
      {source === 'content' && (
        <>
          <ExpressionInput label="File name" value={String(cfg.uploadFileName ?? '')}
            onChange={(v) => onChange({ uploadFileName: v })} placeholder="report.csv"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionTextArea label="Content" value={String(cfg.uploadContent ?? '')}
            onChange={(v) => onChange({ uploadContent: v })} placeholder="File content or {{expression}}"
            nodes={otherNodes} testResults={testResults} rows={4} />
        </>
      )}

      {/* ── Upload from device ────────────────────────────────── */}
      {source === 'local' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">File</label>
          <label className="flex flex-col gap-1 cursor-pointer group">
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs transition-colors ${
              cfg.uploadData
                ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                : 'border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 group-hover:border-blue-400 dark:group-hover:border-blue-500'
            }`}>
              {cfg.uploadData ? (
                <><CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{String(cfg.uploadFileName || 'File loaded')}</span></>
              ) : (
                <span>Click to choose a file…</span>
              )}
            </div>
            <input type="file" className="sr-only"
              onChange={(e) => { if (e.target.files?.[0]) handleFileChange(e.target.files[0]); }} />
          </label>
          {!!cfg.uploadData && (
            <p className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
              {String(cfg.uploadFileName)} · {String(cfg.uploadMimeType || 'auto-detected')}
            </p>
          )}
        </div>
      )}

      {/* ── From Drive folder ─────────────────────────────────── */}
      {source === 'drive' && (
        <>
          <GDriveFilePicker
            credentialId={credentialId}
            cfg={cfg}
            onChange={(p) => onChange(p)}
            label="Source file(s) (from Drive)"
            placeholder="Browse and select a Drive file"
            fileIdKey="sourceFileId"
            filePathKey="sourceFilePath"
            otherNodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionInput
            label="New name for copy (optional — single file only)"
            value={String(cfg.uploadFileName ?? '')}
            onChange={(v) => onChange({ uploadFileName: v })}
            placeholder="Leave blank to keep the original file name"
            nodes={otherNodes}
            testResults={testResults}
            hint="Ignored when copying multiple files — each file keeps its original name. Use {{nodes.x.files[0].id}} for one file or {{nodes.x.files}} to copy all."
          />
        </>
      )}

      {/* Destination folder */}
      <GDriveFolderBrowser
        credentialId={credentialId}
        value={String(cfg.destinationFolderId ?? '')}
        valuePath={String(cfg.destinationFolderPath ?? '')}
        onChange={(id, path) => onChange({ destinationFolderId: id, destinationFolderPath: path })}
        label="Destination folder (optional)"
        placeholder="My Drive (root)"
      />
    </div>
  );
}

/**
 * File picker for actions that target a specific file.
 * Supports two modes:
 *   Browse     — navigate Drive visually and click to select
 *   Expression — type / insert a {{nodes.x.files[0].id}} expression
 */
function GDriveFilePicker({ credentialId, cfg, onChange, label = 'File', placeholder = 'Browse and select a file', fileIdKey = 'fileId', filePathKey = 'filePath', otherNodes, testResults }: {
  credentialId: string;
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  label?: string;
  placeholder?: string;
  fileIdKey?: string;
  filePathKey?: string;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const currentValue = String(cfg[fileIdKey] ?? '');
  const [mode, setMode] = useState<'browse' | 'expression'>(() =>
    EXPR_RE.test(currentValue) ? 'expression' : 'browse'
  );

  function switchMode(next: 'browse' | 'expression') {
    setMode(next);
    onChange({ [fileIdKey]: '', [filePathKey]: '' });
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
        <div className="flex rounded overflow-hidden border border-slate-200 dark:border-slate-700 text-[10px] shrink-0">
          <button type="button" onClick={() => switchMode('browse')}
            className={`px-2 py-0.5 transition-colors ${mode === 'browse' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
            Browse
          </button>
          <button type="button" onClick={() => switchMode('expression')}
            className={`px-2 py-0.5 transition-colors flex items-center gap-1 ${mode === 'expression' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
            <Braces className="w-2.5 h-2.5" /> Expression
          </button>
        </div>
      </div>

      {mode === 'browse' ? (
        <GDriveFolderBrowser
          credentialId={credentialId}
          value={currentValue}
          valuePath={String(cfg[filePathKey] ?? '')}
          onChange={(id, path) => onChange({ [fileIdKey]: id, [filePathKey]: path })}
          label=""
          placeholder={placeholder}
          foldersOnly={false}
        />
      ) : (
        <ExpressionInput
          label=""
          value={currentValue}
          onChange={(v) => onChange({ [fileIdKey]: v, [filePathKey]: '' })}
          placeholder="{{nodes.list-node.files[0].id}} or {{nodes.list-node.files}}"
          nodes={otherNodes}
          testResults={testResults}
          hint="One file: {{nodes.list-node.files[0].id}} — All files from list: {{nodes.list-node.files}}"
        />
      )}
    </div>
  );
}

/** Grant-access settings block (share_file / share_folder in "grant" mode). */
function GDriveGrantFields({ cfg, onChange, otherNodes, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const shareType = (cfg.shareType as string | undefined) ?? 'user';
  return (
    <>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Share with</label>
        <div className="flex gap-3">
          {([['user', 'Specific user'], ['anyone', 'Anyone with link']] as const).map(([val, lbl]) => (
            <label key={val} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="gdrive-share-type" value={val}
                checked={shareType === val}
                onChange={() => onChange({ shareType: val })}
                className="w-3 h-3 accent-blue-500" />
              <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
            </label>
          ))}
        </div>
      </div>

      {shareType === 'user' && (
        <>
          <ExpressionInput label="Email address" value={String(cfg.shareEmail ?? '')}
            onChange={(v) => onChange({ shareEmail: v })} placeholder="user@example.com"
            nodes={otherNodes} testResults={testResults} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gdrive-notify" checked={cfg.sendNotification !== false}
              onChange={(e) => onChange({ sendNotification: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gdrive-notify" className="text-xs text-slate-500 dark:text-slate-400">Send notification email</label>
          </div>
        </>
      )}

      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Permission</label>
        <select value={String(cfg.shareRole ?? 'reader')}
          onChange={(e) => onChange({ shareRole: e.target.value })}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="reader">Viewer (read only)</option>
          <option value="commenter">Commenter</option>
          <option value="writer">Editor</option>
        </select>
      </div>
    </>
  );
}

/** Restrict-access settings block (share_file / share_folder in "restrict" mode). */
function GDriveRestrictFields({ cfg, onChange, otherNodes, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const restrictType = (cfg.restrictType as string | undefined) ?? 'user';
  return (
    <>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Remove access for</label>
        <div className="flex flex-col gap-2">
          {([
            ['user',   'Specific user',        'Remove one person\'s access by email'],
            ['anyone', 'Anyone with the link',  'Revoke the public "anyone with link" permission'],
            ['all',    'Everyone (make private)','Remove all shared access — only the owner can open it'],
          ] as const).map(([val, lbl, desc]) => (
            <label key={val} className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="gdrive-restrict-type" value={val}
                checked={restrictType === val}
                onChange={() => onChange({ restrictType: val })}
                className="w-3 h-3 accent-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs text-slate-700 dark:text-slate-200 font-medium">{lbl}</span>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {restrictType === 'user' && (
        <ExpressionInput label="User email to remove" value={String(cfg.shareEmail ?? '')}
          onChange={(v) => onChange({ shareEmail: v })} placeholder="user@example.com"
          nodes={otherNodes} testResults={testResults} />
      )}

      {restrictType === 'all' && (
        <div className="flex gap-2 rounded-md border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
            All collaborators will lose access immediately. Only the owner will retain access.
          </p>
        </div>
      )}
    </>
  );
}

/** Mode toggle + the right fields for share_file / share_folder. */
function GDriveShareFields({ cfg, onChange, otherNodes, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const shareMode = (cfg.shareMode as string | undefined) ?? 'grant';
  return (
    <>
      {/* Grant / Restrict toggle */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Action</label>
        <div className="flex gap-1 p-0.5 bg-slate-100 dark:bg-slate-700 rounded-md w-fit">
          {([['grant', 'Grant access'], ['restrict', 'Restrict access']] as const).map(([val, lbl]) => (
            <button key={val} type="button"
              onClick={() => onChange({ shareMode: val })}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                shareMode === val
                  ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {shareMode === 'restrict'
        ? <GDriveRestrictFields cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
        : <GDriveGrantFields    cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
      }
    </>
  );
}

// ── GDriveConfig ───────────────────────────────────────────────────────────────

function GDriveConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action       = (cfg.action as string) ?? 'list';
  const credentialId = String(cfg.credentialId ?? '');

  const fileTypes = (cfg.fileTypes as string[] | undefined) ?? [];
  function toggleFileType(t: string) {
    const next = fileTypes.includes(t) ? fileTypes.filter((x) => x !== t) : [...fileTypes, t];
    onChange({ fileTypes: next });
  }

  const FILE_TYPE_OPTIONS = [
    { value: 'image',  label: 'Images' },
    { value: 'pdf',    label: 'PDFs' },
    { value: 'docs',   label: 'Documents (Docs / Word)' },
    { value: 'sheets', label: 'Spreadsheets (Sheets / Excel)' },
    { value: 'slides', label: 'Presentations (Slides / PPT)' },
    { value: 'video',  label: 'Video' },
    { value: 'audio',  label: 'Audio' },
    { value: 'zip',    label: 'Archives (zip / rar)' },
  ];

  return (
    <div className="space-y-3">
      <CredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id })}
      />
      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { group: 'File Actions', options: [
            { value: 'list',      label: 'List Files / Folders' },
            { value: 'upload',    label: 'Upload File' },
            { value: 'download',  label: 'Download File' },
            { value: 'create_file', label: 'Create File' },
            { value: 'copy_file',   label: 'Copy File' },
            { value: 'move_file',   label: 'Move File' },
            { value: 'rename_file', label: 'Rename File' },
            { value: 'update_file', label: 'Update File Content' },
            { value: 'share_file',  label: 'Share File' },
            { value: 'delete_file', label: 'Delete File' },
          ]},
          { group: 'Folder Actions', options: [
            { value: 'create_folder', label: 'Create Folder' },
            { value: 'share_folder',  label: 'Share Folder' },
            { value: 'delete_folder', label: 'Delete Folder' },
          ]},
        ]}
      />

      {/* ── List Files / Folders ──────────────────────────────── */}
      {action === 'list' && (
        <>
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.searchFolderId ?? '')}
            valuePath={String(cfg.searchFolderPath ?? '')}
            onChange={(id, path) => onChange({ searchFolderId: id, searchFolderPath: path })}
            label="Search in folder (optional)"
            placeholder="All of My Drive"
          />

          {(() => {
            const hasSearch = String(cfg.searchQuery ?? '').trim().length > 0;
            return (
              <>
                <ExpressionInput label="Search" value={String(cfg.searchQuery ?? '')}
                  onChange={(v) => onChange({ searchQuery: v })}
                  placeholder="e.g. Q4 report, invoice, budget…"
                  nodes={otherNodes} testResults={testResults}
                  hint={
                    hasSearch
                      ? 'Searches both file names and content. Results are sorted by relevance while this field is in use.'
                      : 'Searches both file names and content — no Drive query syntax needed.'
                  } />

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Show</label>
                  <div className="flex gap-3">
                    {([['both', 'Files & Folders'], ['files', 'Files only'], ['folders', 'Folders only']] as const).map(([val, lbl]) => (
                      <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="gdrive-include-type" value={val}
                          checked={(cfg.includeType as string | undefined ?? 'both') === val}
                          onChange={() => onChange({ includeType: val })}
                          className="w-3 h-3 accent-blue-500" />
                        <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className={hasSearch ? 'opacity-40 pointer-events-none select-none' : ''}>
                  <ExpressionInput label="File name contains (optional)" value={String(cfg.fileNameFilter ?? '')}
                    onChange={(v) => onChange({ fileNameFilter: v })} placeholder="report"
                    nodes={otherNodes} testResults={testResults}
                    hint={hasSearch ? 'Not available — Search already matches file names.' : undefined} />
                </div>
              </>
            );
          })()}

          <ExpressionInput label="Owner email (optional)" value={String(cfg.owner ?? '')}
            onChange={(v) => onChange({ owner: v })} placeholder="owner@example.com"
            nodes={otherNodes} testResults={testResults} />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Date filter (optional)</label>
            <select value={String(cfg.dateField ?? '')}
              onChange={(e) => onChange({ dateField: e.target.value || undefined })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">No date filter</option>
              <option value="createdTime">Date created</option>
              <option value="modifiedTime">Date modified</option>
            </select>
            {!!cfg.dateField && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[10px] text-slate-500 dark:text-slate-400">After</label>
                  <input type="date" value={String(cfg.dateAfter ?? '')}
                    onChange={(e) => onChange({ dateAfter: e.target.value || undefined })}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] text-slate-500 dark:text-slate-400">Before</label>
                  <input type="date" value={String(cfg.dateBefore ?? '')}
                    onChange={(e) => onChange({ dateBefore: e.target.value || undefined })}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              File types <span className="text-slate-400 dark:text-slate-500 font-normal">(optional)</span>
            </label>
            <div className="grid grid-cols-2 gap-1">
              {FILE_TYPE_OPTIONS.map((ft) => (
                <label key={ft.value} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={fileTypes.includes(ft.value)}
                    onChange={() => toggleFileType(ft.value)}
                    className="w-3.5 h-3.5 accent-blue-500 flex-shrink-0" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">{ft.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="gdrive-shared" checked={Boolean(cfg.includeShared)}
              onChange={(e) => onChange({ includeShared: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gdrive-shared" className="text-xs text-slate-500 dark:text-slate-400">Include shared drives and files</label>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Max results</label>
            <input type="number" min={1} max={1000} value={String(cfg.maxResults ?? 20)}
              onChange={(e) => onChange({ maxResults: Number(e.target.value) })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </>
      )}

      {/* ── Upload File ───────────────────────────────────────── */}
      {action === 'upload' && (
        <GDriveUploadInput cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
      )}

      {/* ── Download File ─────────────────────────────────────── */}
      {action === 'download' && (
        <>
          <ExpressionInput
            label="Drive URL"
            value={String(cfg.driveUrl ?? '')}
            onChange={(v) => onChange({ driveUrl: v })}
            placeholder="https://drive.google.com/file/d/…/view"
            nodes={otherNodes}
            testResults={testResults}
            hint="Paste a Google Drive share link or file ID. The file ID is extracted automatically. Leave blank to search by folder + filename below."
          />
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.downloadFolderId ?? '')}
            valuePath={String(cfg.downloadFolderPath ?? '')}
            onChange={(id, path) => onChange({ downloadFolderId: id, downloadFolderPath: path })}
            label="Folder to search in (optional)"
            placeholder="All of My Drive"
          />
          <ExpressionInput label="File name" value={String(cfg.downloadFileName ?? '')}
            onChange={(v) => onChange({ downloadFileName: v })} placeholder="monthly_report.xlsx"
            nodes={otherNodes} testResults={testResults}
            hint="The first file whose name contains this text will be downloaded." />
          <label className="flex items-start gap-2.5 cursor-pointer group pt-0.5">
            <input
              type="checkbox"
              checked={Boolean(cfg.skipIfEmpty)}
              onChange={(e) => onChange({ skipIfEmpty: e.target.checked })}
              className="mt-0.5 w-3.5 h-3.5 rounded border-slate-400 text-blue-500 focus:ring-blue-500 shrink-0"
            />
            <span className="space-y-0.5">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                Skip if no file found
              </span>
              <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                When enabled, this step is silently skipped (returning empty output) instead of stopping the workflow if the file input is blank or the file doesn't exist. Useful when the file attachment is optional, e.g. a Google Form with an optional upload field.
              </span>
            </span>
          </label>
        </>
      )}

      {/* ── Create File ───────────────────────────────────────── */}
      {action === 'create_file' && (() => {
        const createMime = String(cfg.mimeType ?? 'text/plain');
        const isGoogleNative = [
          'application/vnd.google-apps.document',
          'application/vnd.google-apps.spreadsheet',
          'application/vnd.google-apps.presentation',
          'application/vnd.google-apps.form',
        ].includes(createMime);

        return (
          <>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">File type</label>
              <select value={createMime}
                onChange={(e) => onChange({ mimeType: e.target.value })}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                <optgroup label="Google Workspace">
                  <option value="application/vnd.google-apps.document">Google Docs</option>
                  <option value="application/vnd.google-apps.spreadsheet">Google Sheets</option>
                  <option value="application/vnd.google-apps.presentation">Google Slides</option>
                  <option value="application/vnd.google-apps.form">Google Forms</option>
                </optgroup>
                <optgroup label="Text files">
                  <option value="text/plain">Plain text (.txt)</option>
                  <option value="text/csv">CSV (.csv)</option>
                  <option value="text/html">HTML (.html)</option>
                  <option value="application/json">JSON (.json)</option>
                  <option value="text/markdown">Markdown (.md)</option>
                </optgroup>
              </select>
            </div>

            <ExpressionInput label="File name" value={String(cfg.fileName ?? '')}
              onChange={(v) => onChange({ fileName: v })}
              placeholder={
                createMime === 'application/vnd.google-apps.document'     ? 'My Document' :
                createMime === 'application/vnd.google-apps.spreadsheet'  ? 'My Spreadsheet' :
                createMime === 'application/vnd.google-apps.presentation' ? 'My Presentation' :
                createMime === 'application/vnd.google-apps.form'         ? 'My Form' :
                'new-file.txt'
              }
              nodes={otherNodes} testResults={testResults}
              hint={isGoogleNative ? 'No extension needed — Drive handles formatting automatically.' : undefined} />

            {isGoogleNative ? (
              <div className="flex gap-2 rounded-md border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
                <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-blue-700 dark:text-blue-300 leading-relaxed">
                  Google Workspace files are created blank — you can open and edit them in Drive after creation. To add content to a Docs or Sheets file, use the Google Docs / Google Sheets nodes.
                </p>
              </div>
            ) : (
              <ExpressionTextArea label="Initial content (optional)" value={String(cfg.content ?? '')}
                onChange={(v) => onChange({ content: v })} placeholder="File content or {{expression}}"
                nodes={otherNodes} testResults={testResults} rows={4} />
            )}

            <GDriveFolderBrowser
              credentialId={credentialId}
              value={String(cfg.folderId ?? '')}
              valuePath={String(cfg.folderPath ?? '')}
              onChange={(id, path) => onChange({ folderId: id, folderPath: path })}
              label="Destination folder (optional)"
              placeholder="My Drive (root)"
            />

            {!isGoogleNative && (
              <div className="flex gap-2 rounded-md border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                <Info className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  For binary files (images, videos, PDFs), use <strong>Upload File</strong> → "Upload from device" instead.
                </p>
              </div>
            )}
          </>
        );
      })()}

      {/* ── Copy File ─────────────────────────────────────────── */}
      {action === 'copy_file' && (
        <>
          <GDriveFilePicker
            credentialId={credentialId} cfg={cfg} onChange={onChange}
            label="Source file" placeholder="Browse and select the file to copy"
            otherNodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="New file name (optional)" value={String(cfg.newName ?? '')}
            onChange={(v) => onChange({ newName: v })} placeholder="Leave blank to keep original name"
            nodes={otherNodes} testResults={testResults} />
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.destinationFolderId ?? '')}
            valuePath={String(cfg.destinationFolderPath ?? '')}
            onChange={(id, path) => onChange({ destinationFolderId: id, destinationFolderPath: path })}
            label="Destination folder (optional)"
            placeholder="Same folder as source"
          />
        </>
      )}

      {/* ── Move File ─────────────────────────────────────────── */}
      {action === 'move_file' && (
        <>
          <GDriveFilePicker
            credentialId={credentialId} cfg={cfg} onChange={onChange}
            label="File to move" placeholder="Browse and select the file to move"
            otherNodes={otherNodes} testResults={testResults} />
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.destinationFolderId ?? '')}
            valuePath={String(cfg.destinationFolderPath ?? '')}
            onChange={(id, path) => onChange({ destinationFolderId: id, destinationFolderPath: path })}
            label="Move to folder"
            placeholder="Select destination folder"
          />
        </>
      )}

      {/* ── Rename File ───────────────────────────────────────── */}
      {action === 'rename_file' && (
        <>
          <GDriveFilePicker
            credentialId={credentialId} cfg={cfg} onChange={onChange}
            label="File to rename" placeholder="Browse and select the file to rename"
            otherNodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="New name" value={String(cfg.newName ?? '')}
            onChange={(v) => onChange({ newName: v })} placeholder="new-filename.xlsx"
            nodes={otherNodes} testResults={testResults} />
        </>
      )}

      {/* ── Update File Content ───────────────────────────────── */}
      {action === 'update_file' && (
        <>
          <GDriveFilePicker
            credentialId={credentialId} cfg={cfg} onChange={onChange}
            label="File to update" placeholder="Browse and select the file to update"
            otherNodes={otherNodes} testResults={testResults} />
          <ExpressionTextArea label="New content" value={String(cfg.content ?? '')}
            onChange={(v) => onChange({ content: v })} placeholder="Replacement content or {{expression}}"
            nodes={otherNodes} testResults={testResults} rows={5} />
        </>
      )}

      {/* ── Share File ────────────────────────────────────────── */}
      {action === 'share_file' && (
        <>
          <GDriveFilePicker
            credentialId={credentialId} cfg={cfg} onChange={onChange}
            label="File to share" placeholder="Browse and select the file to share"
            otherNodes={otherNodes} testResults={testResults} />
          <GDriveShareFields cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
        </>
      )}

      {/* ── Delete File ───────────────────────────────────────── */}
      {action === 'delete_file' && (
        <>
          <GDriveFilePicker
            credentialId={credentialId} cfg={cfg} onChange={onChange}
            label="File to delete" placeholder="Browse and select the file to delete"
            otherNodes={otherNodes} testResults={testResults} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gdrive-del-permanent" checked={Boolean(cfg.permanent)}
              onChange={(e) => onChange({ permanent: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gdrive-del-permanent" className="text-xs text-slate-500 dark:text-slate-400">Permanently delete (skip Trash)</label>
          </div>
          {cfg.permanent && (
            <div className="flex gap-2 rounded-md border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
                Permanently deleted files cannot be recovered.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Create Folder ─────────────────────────────────────── */}
      {action === 'create_folder' && (
        <>
          <ExpressionInput label="Folder name" value={String(cfg.folderName ?? '')}
            onChange={(v) => onChange({ folderName: v })} placeholder="My New Folder"
            nodes={otherNodes} testResults={testResults} />
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.parentFolderId ?? '')}
            valuePath={String(cfg.parentFolderPath ?? '')}
            onChange={(id, path) => onChange({ parentFolderId: id, parentFolderPath: path })}
            label="Create inside folder (optional)"
            placeholder="My Drive (root)"
          />
        </>
      )}

      {/* ── Share Folder ──────────────────────────────────────── */}
      {action === 'share_folder' && (
        <>
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.folderId ?? '')}
            valuePath={String(cfg.folderPath ?? '')}
            onChange={(id, path) => onChange({ folderId: id, folderPath: path })}
            label="Folder to share"
            placeholder="Browse and select a folder"
          />
          <GDriveShareFields cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
        </>
      )}

      {/* ── Delete Folder ─────────────────────────────────────── */}
      {action === 'delete_folder' && (
        <>
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.folderId ?? '')}
            valuePath={String(cfg.folderPath ?? '')}
            onChange={(id, path) => onChange({ folderId: id, folderPath: path })}
            label="Folder to delete"
            placeholder="Browse and select a folder"
          />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gdrive-folder-del-permanent" checked={Boolean(cfg.permanent)}
              onChange={(e) => onChange({ permanent: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gdrive-folder-del-permanent" className="text-xs text-slate-500 dark:text-slate-400">Permanently delete (skip Trash)</label>
          </div>
          {cfg.permanent && (
            <div className="flex gap-2 rounded-md border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
                Permanently deleted folders and all their contents cannot be recovered.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── GDocsConfig ────────────────────────────────────────────────────────────────

/** Picker for a Google Doc — browse Drive (filtered to Docs) or search by name/owner/folder. */
function GDocsDocumentPicker({ cfg, onChange, label = 'Document', otherNodes, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  label?: string;
  otherNodes: ConfigProps['otherNodes'];
  testResults: ConfigProps['testResults'];
}) {
  const credentialId = String(cfg.credentialId ?? '');
  const [mode, setMode] = useState<'browse' | 'search'>(() =>
    (cfg.documentName || cfg.owner || cfg.searchFolderId) ? 'search' : 'browse'
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
        <div className="flex rounded overflow-hidden border border-slate-200 dark:border-slate-700 text-[10px] shrink-0">
          <button type="button" onClick={() => setMode('browse')}
            className={`px-2 py-0.5 transition-colors ${mode === 'browse' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
            Browse Drive
          </button>
          <button type="button" onClick={() => setMode('search')}
            className={`px-2 py-0.5 transition-colors ${mode === 'search' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
            Search / ID
          </button>
        </div>
      </div>

      {mode === 'browse' ? (
        <GDriveFolderBrowser
          credentialId={credentialId}
          value={String(cfg.documentId ?? '')}
          valuePath={String(cfg.documentPath ?? '')}
          onChange={(id, path) => onChange({ documentId: id, documentPath: path, documentName: '', owner: '', searchFolderId: '' })}
          label=""
          placeholder="Browse and select a Google Doc"
          foldersOnly={false}
          mimeTypeFilter="application/vnd.google-apps.document"
        />
      ) : (
        <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 p-2.5">
          <ExpressionInput label="Document name (contains)" value={String(cfg.documentName ?? '')}
            onChange={(v) => onChange({ documentName: v, documentId: '' })}
            placeholder="Q4 Report, Invoice…"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Owner email (optional)" value={String(cfg.owner ?? '')}
            onChange={(v) => onChange({ owner: v })}
            placeholder="owner@example.com"
            nodes={otherNodes} testResults={testResults} />
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.searchFolderId ?? '')}
            valuePath={String(cfg.searchFolderPath ?? '')}
            onChange={(id, path) => onChange({ searchFolderId: id, searchFolderPath: path })}
            label="Search in folder (optional)"
            placeholder="All of My Drive"
          />
          <div className="border-t border-slate-200 dark:border-slate-700 pt-2">
            <ExpressionInput label="— or enter Document ID directly —" value={String(cfg.documentId ?? '')}
              onChange={(v) => onChange({ documentId: v, documentName: '', owner: '', searchFolderId: '' })}
              placeholder="{{nodes.x.documentId}} or paste an ID"
              nodes={otherNodes} testResults={testResults} />
          </div>
        </div>
      )}
    </div>
  );
}

function GDocsConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action       = (cfg.action as string) ?? 'read';
  const credentialId = String(cfg.credentialId ?? '');

  return (
    <div className="space-y-3">
      <CredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id })}
      />
      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { group: 'Document Actions', options: [
            { value: 'create', label: 'Create Document' },
            { value: 'read',   label: 'Read Document' },
            { value: 'append', label: 'Append to Document' },
            { value: 'rename', label: 'Rename Document' },
          ]},
        ]}
      />

      {/* ── Create ──────────────────────────────────────────────── */}
      {action === 'create' && (
        <>
          <ExpressionInput label="Document title" value={String(cfg.title ?? '')}
            onChange={(v) => onChange({ title: v })} placeholder="My Document"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionTextArea label="Initial content (optional)" value={String(cfg.content ?? '')}
            onChange={(v) => onChange({ content: v })} placeholder="Starting text…"
            nodes={otherNodes} testResults={testResults} rows={4} />
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.folderId ?? '')}
            valuePath={String(cfg.folderPath ?? '')}
            onChange={(id, path) => onChange({ folderId: id, folderPath: path })}
            label="Save in folder (optional)"
            placeholder="My Drive (root)"
          />
        </>
      )}

      {/* ── Read ────────────────────────────────────────────────── */}
      {action === 'read' && (
        <GDocsDocumentPicker cfg={cfg} onChange={onChange} label="Document to read"
          otherNodes={otherNodes} testResults={testResults} />
      )}

      {/* ── Append ──────────────────────────────────────────────── */}
      {action === 'append' && (
        <>
          <GDocsDocumentPicker cfg={cfg} onChange={onChange} label="Document to append to"
            otherNodes={otherNodes} testResults={testResults} />

          <ExpressionTextArea label="Text to append (optional)" value={String(cfg.text ?? '')}
            onChange={(v) => onChange({ text: v })} placeholder="Text to add at the end of the document"
            nodes={otherNodes} testResults={testResults} rows={3} />

          {/* Link section */}
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!cfg.appendLink}
                onChange={(e) => onChange({ appendLink: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Append a hyperlink</span>
            </label>
            {!!cfg.appendLink && (
              <div className="space-y-2 pl-5">
                <ExpressionInput label="Link text" value={String(cfg.linkText ?? '')}
                  onChange={(v) => onChange({ linkText: v })} placeholder="Click here"
                  nodes={otherNodes} testResults={testResults} />
                <ExpressionInput label="Link URL" value={String(cfg.linkUrl ?? '')}
                  onChange={(v) => onChange({ linkUrl: v })} placeholder="https://example.com"
                  nodes={otherNodes} testResults={testResults} />
              </div>
            )}
          </div>

          {/* Image section */}
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!cfg.appendImage}
                onChange={(e) => onChange({ appendImage: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-blue-500" />
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Append an image</span>
            </label>
            {!!cfg.appendImage && (
              <div className="space-y-2 pl-5">
                <ExpressionInput label="Image URL (publicly accessible)" value={String(cfg.imageUrl ?? '')}
                  onChange={(v) => onChange({ imageUrl: v })} placeholder="https://example.com/image.png"
                  nodes={otherNodes} testResults={testResults}
                  hint="The Google Docs API fetches the image from this URL — it must be publicly accessible." />
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Width (pt)</label>
                    <input type="number" min={10} max={600}
                      value={Number(cfg.imageWidth ?? 200)}
                      onChange={(e) => onChange({ imageWidth: Number(e.target.value) })}
                      className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Height (pt)</label>
                    <input type="number" min={10} max={600}
                      value={Number(cfg.imageHeight ?? 200)}
                      onChange={(e) => onChange({ imageHeight: Number(e.target.value) })}
                      className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Rename ──────────────────────────────────────────────── */}
      {action === 'rename' && (
        <>
          <GDocsDocumentPicker cfg={cfg} onChange={onChange} label="Document to rename"
            otherNodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="New title" value={String(cfg.newTitle ?? '')}
            onChange={(v) => onChange({ newTitle: v })} placeholder="My Renamed Document"
            nodes={otherNodes} testResults={testResults} />
        </>
      )}
    </div>
  );
}

// ── Slack credential helper ────────────────────────────────────────────────────

function SlackCredentialSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: credentials = [], isLoading } = useCredentialList();
  const slackCreds = credentials.filter((c) => c.provider === 'slack');
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Slack Workspace</label>
      {isLoading ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Loading workspaces…</p>
      ) : slackCreds.length === 0 ? (
        <p className="text-[10px] text-amber-400">
          No Slack workspaces connected. Click <strong>Credentials</strong> in the toolbar to connect one.
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: '— select workspace —' },
            ...slackCreds.map((c) => ({ value: c.id, label: c.label })),
          ]}
        />
      )}
    </div>
  );
}

// ── SlackResourceSelect ────────────────────────────────────────────────────────
// Single-value smart picker with searchable list + expression toggle.

function SlackResourceSelect({
  label,
  value,
  onChange,
  items,
  isLoading,
  isError,
  placeholder,
  renderItem,
  hasCredential,
  otherNodes,
  testResults,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; display: string }[];
  isLoading: boolean;
  isError: boolean;
  placeholder: string;
  renderItem: (item: { id: string; display: string }) => string;
  hasCredential: boolean;
  otherNodes: ConfigProps['otherNodes'];
  testResults: ConfigProps['testResults'];
}) {
  const looksLikeExpression = value.includes('{{');
  const [expressionMode, setExpressionMode] = useState(!hasCredential || looksLikeExpression);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!hasCredential) { setExpressionMode(true); return; }
    if (hasCredential && items.length > 0 && !value.includes('{{')) {
      setExpressionMode(false);
    }
  }, [hasCredential, items.length, value]);

  const filtered = items.filter((i) =>
    i.display.toLowerCase().includes(filter.toLowerCase())
  );
  const selected = items.find((i) => i.id === value);

  if (!hasCredential || expressionMode) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
          {hasCredential && (
            <button type="button" onClick={() => setExpressionMode(false)}
              className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
              Pick from list
            </button>
          )}
        </div>
        <ExpressionInput label="" value={value} onChange={onChange} placeholder={placeholder}
          nodes={otherNodes} testResults={testResults} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <button type="button" onClick={() => setExpressionMode(true)}
          className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
          Use expression
        </button>
      </div>
      {isLoading && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      )}
      {isError && (
        <p className="text-[10px] text-red-400">
          Failed to load.{' '}
          <button type="button" className="underline" onClick={() => setExpressionMode(true)}>Enter manually.</button>
        </p>
      )}
      {!isLoading && !isError && (
        <div className="space-y-1">
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Search…"
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder-slate-500" />
          <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
            {filtered.length === 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No results.</p>
            )}
            {filtered.map((item) => (
              <button key={item.id} type="button"
                onClick={() => { onChange(item.id); setFilter(''); }}
                className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                  item.id === value
                    ? 'bg-violet-600/30 text-violet-300'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}>
                {renderItem(item)}
              </button>
            ))}
          </div>
          {selected && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              Selected: <span className="text-slate-700 dark:text-slate-300">{renderItem(selected)}</span>
              <span className="ml-1 text-slate-600">({selected.id})</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── SlackMultiPicker ───────────────────────────────────────────────────────────
// Multi-select tag input backed by the Slack channels/users list.
// Stores value as a comma-separated string of IDs.

function SlackMultiPicker({
  label,
  value,
  onChange,
  items,
  isLoading,
  isError,
  placeholder,
  renderItem,
  renderTag,
  hasCredential,
  otherNodes,
  testResults,
}: {
  label: string;
  value: string;         // comma-separated IDs
  onChange: (v: string) => void;
  items: { id: string; display: string }[];
  isLoading: boolean;
  isError: boolean;
  placeholder: string;
  renderItem: (item: { id: string; display: string }) => string;
  renderTag:  (item: { id: string; display: string } | undefined, raw: string) => string;
  hasCredential: boolean;
  otherNodes: ConfigProps['otherNodes'];
  testResults: ConfigProps['testResults'];
}) {
  const selected: string[] = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const [filter, setFilter] = useState('');
  const [expressionMode, setExpressionMode] = useState(!hasCredential || value.includes('{{'));
  const inputRef = useRef<HTMLInputElement>(null);
  const [expressionInput, setExpressionInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!hasCredential) { setExpressionMode(true); return; }
    if (hasCredential && items.length > 0 && !value.includes('{{')) {
      setExpressionMode(false);
    }
  }, [hasCredential, items.length, value]);

  function addId(id: string) {
    if (!selected.includes(id)) onChange([...selected, id].join(','));
    setFilter('');
  }

  function removeId(id: string) {
    onChange(selected.filter((s) => s !== id).join(','));
  }

  function commitExpression(raw: string) {
    const trimmed = raw.trim().replace(/,\s*$/, '');
    if (trimmed && !selected.includes(trimmed)) {
      onChange([...selected, trimmed].join(','));
    }
    setExpressionInput('');
  }

  function handleInsert(expr: string) {
    setExpressionInput((prev) => prev + expr);
    setPickerOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const filtered = items.filter(
    (i) => i.display.toLowerCase().includes(filter.toLowerCase()) && !selected.includes(i.id)
  );

  if (!hasCredential || expressionMode) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
          <div className="flex items-center gap-2">
            {hasCredential && (
              <button type="button" onClick={() => { setExpressionMode(false); }}
                className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
                Pick from list
              </button>
            )}
            {otherNodes.length > 0 && (
              <button type="button" onClick={() => setPickerOpen((p) => !p)}
                title="Insert variable"
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                  pickerOpen ? 'bg-blue-600 text-white' : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}>
                <Braces className="w-2.5 h-2.5" />Insert variable
              </button>
            )}
          </div>
        </div>
        {/* Tag display + input for expression mode */}
        <div className="flex flex-wrap gap-1 min-h-[30px] bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1.5 focus-within:ring-1 focus-within:ring-violet-500 cursor-text"
          onClick={() => inputRef.current?.focus()}>
          {selected.map((id, i) => {
            const item = items.find((it) => it.id === id);
            return (
              <span key={i} className="inline-flex items-center gap-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[10px] rounded px-1.5 py-0.5 max-w-full">
                <span className="break-all">{renderTag(item, id)}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); removeId(id); }}
                  className="ml-0.5 text-violet-400 hover:text-red-500 leading-none flex-shrink-0">×</button>
              </span>
            );
          })}
          <input ref={inputRef} type="text" value={expressionInput}
            onChange={(e) => setExpressionInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') { e.preventDefault(); commitExpression(expressionInput); }
              else if (e.key === 'Backspace' && expressionInput === '' && selected.length > 0) removeId(selected[selected.length - 1]);
            }}
            onBlur={() => { if (expressionInput.trim()) commitExpression(expressionInput); }}
            placeholder={selected.length === 0 ? placeholder : ''}
            className="flex-1 min-w-[120px] bg-transparent text-xs text-gray-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 outline-none py-0.5" />
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Press Enter or comma to add each ID / expression</p>
        {pickerOpen && <VariablePickerPanel nodes={otherNodes} testResults={testResults} onInsert={handleInsert} />}
      </div>
    );
  }

  // Picker mode — show searchable list + selected tags
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
        <button type="button" onClick={() => setExpressionMode(true)}
          className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
          Use expression
        </button>
      </div>

      {/* Selected tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id, i) => {
            const item = items.find((it) => it.id === id);
            return (
              <span key={i} className="inline-flex items-center gap-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[10px] rounded px-1.5 py-0.5">
                <span>{renderTag(item, id)}</span>
                <button type="button" onClick={() => removeId(id)}
                  className="ml-0.5 text-violet-400 hover:text-red-500 leading-none">×</button>
              </span>
            );
          })}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      )}
      {isError && (
        <p className="text-[10px] text-red-400">
          Failed to load.{' '}
          <button type="button" className="underline" onClick={() => setExpressionMode(true)}>Enter manually.</button>
        </p>
      )}
      {!isLoading && !isError && (
        <div className="space-y-1">
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Search to add…"
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder-slate-500" />
          <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
            {filtered.length === 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">
                {items.length === 0 ? 'No items available.' : 'All items selected or no results.'}
              </p>
            )}
            {filtered.map((item) => (
              <button key={item.id} type="button" onClick={() => addId(item.id)}
                className="w-full text-left px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                {renderItem(item)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SlackUploadInput ───────────────────────────────────────────────────────────
// File upload input with three source modes:
//   content — plain text / expression
//   local   — pick a file from the user's device (staged server-side, never stored in workflow JSON)
//   node    — reference another node's file output via expression

function SlackUploadInput({ cfg, onChange, otherNodes, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const source = (cfg.uploadSource as string | undefined) ?? 'content';
  const [staging, setStaging] = useState(false);
  const [stagingError, setStagingError] = useState<string | null>(null);

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function handleFileChange(file: File, inputEl: HTMLInputElement) {
    // Reset the input value immediately so the user can re-pick the same
    // file name in a future interaction — without this the browser's change
    // event won't fire if the identical path is selected again.
    inputEl.value = '';

    setStagingError(null);
    // Clear any stale staging metadata so the UI shows a clean loading state
    onChange({
      stagedFileId:  undefined,
      _stagedSize:   undefined,
      _stagedName:   undefined,
      _stagedExpiry: undefined,
    });
    setStaging(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const staged  = await stageFile({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        data:     dataUrl,
      });
      // Store only the lightweight reference — no raw bytes in the workflow config.
      // Also update `filename` so the Slack API always sends the correct file name
      // (the "Filename" field in the UI is pre-filled but user can override it).
      onChange({
        uploadSource:   'staged',
        stagedFileId:   staged.stagedFileId,
        filename:       staged.filename,   // keep filename in sync with staged file
        uploadMimeType: staged.mimeType,
        _stagedSize:    staged.size,
        _stagedName:    staged.filename,
        _stagedExpiry:  staged.expiresAt,
      });
    } catch (err) {
      setStagingError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setStaging(false);
    }
  }

  const isStaged    = source === 'staged' && !!cfg.stagedFileId;
  const displayMode = isStaged ? 'local' : source; // treat staged as local in UI

  return (
    <div className="space-y-3">
      {/* Source selector */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">File source</label>
        <div className="flex gap-3 flex-wrap">
          {([
            ['content', 'Text / expression'],
            ['local',   'Upload from device'],
            ['node',    'From another node'],
          ] as const).map(([val, lbl]) => (
            <label key={val} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="slack-upload-source" value={val}
                checked={displayMode === val}
                onChange={() => onChange({ uploadSource: val, stagedFileId: undefined, _stagedSize: undefined, _stagedName: undefined, _stagedExpiry: undefined })}
                className="w-3 h-3 accent-violet-500" />
              <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ── Text / expression ──────────────────────────────────────── */}
      {displayMode === 'content' && (
        <ExpressionTextArea
          label="File content"
          value={String(cfg.fileContent ?? '')}
          onChange={(v) => onChange({ fileContent: v })}
          placeholder="File contents or {{nodes.x.text}}"
          nodes={otherNodes}
          testResults={testResults}
          rows={4}
        />
      )}

      {/* ── Upload from device ────────────────────────────────────── */}
      {displayMode === 'local' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">File</label>

          {/* Drop zone / file picker */}
          <label className={`flex flex-col gap-1 cursor-pointer group ${staging ? 'pointer-events-none' : ''}`}>
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs transition-colors ${
              staging
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300'
                : isStaged
                  ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : 'border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 group-hover:border-violet-400 dark:group-hover:border-violet-500'
            }`}>
              {staging ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /><span>Uploading file…</span></>
              ) : isStaged ? (
                <><CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{String(cfg._stagedName || cfg.filename || 'File ready')}</span></>
              ) : (
                <span>Click to choose a file…</span>
              )}
            </div>
            <input type="file" className="sr-only" disabled={staging}
              onChange={(e) => { if (e.target.files?.[0]) handleFileChange(e.target.files[0], e.target); }} />
          </label>

          {/* Staged file details */}
          {isStaged && (
            <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-snug">
              {String(cfg._stagedName)} · {String(cfg.uploadMimeType || 'auto-detected')}
              {cfg._stagedSize ? ` · ${(Number(cfg._stagedSize) / 1024 / 1024).toFixed(1)} MB` : ''}
              {' · '}<span className="text-amber-500 dark:text-amber-400">expires {new Date(String(cfg._stagedExpiry)).toLocaleString()}</span>
            </p>
          )}

          {/* Staging error */}
          {stagingError && (
            <p className="text-[10px] text-red-500 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 shrink-0" />{stagingError}
            </p>
          )}

          {/* Re-attach hint for expired staged files */}
          {!isStaged && !staging && (
            <p className="text-[9px] text-slate-400 dark:text-slate-500">
              The file is uploaded immediately and stored temporarily (24 h). Re-attach if you need to re-run after expiry.
            </p>
          )}
        </div>
      )}

      {/* ── From another node ─────────────────────────────────────── */}
      {displayMode === 'node' && (
        <>
          <ExpressionInput
            label="File data (base64 or data-URL)"
            value={String(cfg.uploadData ?? '')}
            onChange={(v) => onChange({ uploadData: v })}
            placeholder="{{nodes.gdrive.data}} or {{nodes.x.base64}}"
            nodes={otherNodes}
            testResults={testResults}
            hint="Use an expression that resolves to a base64 string or data-URL from e.g. a Google Drive node."
          />
          <ExpressionInput
            label="MIME type (optional)"
            value={String(cfg.uploadMimeType ?? '')}
            onChange={(v) => onChange({ uploadMimeType: v })}
            placeholder="application/pdf"
            nodes={otherNodes}
            testResults={testResults}
          />
        </>
      )}
    </div>
  );
}

// ── SlackConfig ────────────────────────────────────────────────────────────────

function SlackConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action       = (cfg.action as string) ?? 'send_message';
  const credentialId = String(cfg.credentialId ?? '');

  const {
    channels, missingScopes,
    isLoading: loadingChannels, isError: errorChannels,
  } = useSlackChannels(credentialId);
  const { data: users = [], isLoading: loadingUsers, isError: errorUsers } =
    useSlackUsers(credentialId);

  const channelItems = channels.map((c) => ({
    id:      c.id!,
    display: c.isPrivate
      ? `🔒 ${c.name}`
      : c.isMember
        ? c.name!
        : `${c.name} (not joined)`,
  }));
  const userItems = users.map((u) => ({
    id:      u.id!,
    display: u.displayName || u.realName || u.name,
  }));

  // Helpers: parse the comma-string fields for multi-pickers
  const channelsValue = String(cfg.channels ?? cfg.channel ?? '');
  const userIdsValue  = String(cfg.userIds  ?? cfg.userId  ?? '');
  const readSource    = (cfg.readSource as string | undefined) ?? 'channel';
  const channelFilter = (cfg.channelFilter as string | undefined) ?? 'all';

  return (
    <div className="space-y-3">
      <SlackCredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id })}
      />

      {credentialId && missingScopes.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
            Private channels are hidden — token is missing{' '}
            <code className="font-mono bg-amber-100 dark:bg-amber-500/20 px-0.5 rounded">
              {missingScopes.join(', ')}
            </code>
            . Add it under <strong>OAuth &amp; Permissions → User Token Scopes</strong>, then reconnect.
          </p>
        </div>
      )}

      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { group: 'Messaging', options: [
            { value: 'send_message',  label: 'Send Message to Channel(s)' },
            { value: 'send_dm',       label: 'Send Direct Message(s)' },
            { value: 'read_messages', label: 'Read Messages' },
            { value: 'read_thread',   label: 'Read Thread Replies' },
          ]},
          { group: 'Files', options: [
            { value: 'upload_file', label: 'Upload File' },
          ]},
          { group: 'Lookup', options: [
            { value: 'list_users',    label: 'List Workspace Users' },
            { value: 'list_channels', label: 'List Channels' },
          ]},
        ]}
      />

      {/* ── Send Message ──────────────────────────────────────────── */}
      {action === 'send_message' && (
        <>
          {/* Sender selector */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Send as</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                ['user', 'My Slack Account', 'Acts as you'],
                ['bot',  'Flux Bot',         'Automated bot sender'],
              ] as const).map(([val, lbl, sub]) => (
                <label
                  key={val}
                  className={`flex flex-col gap-0.5 rounded-md border px-2.5 py-2 cursor-pointer transition-colors ${
                    (cfg.senderType ?? 'user') === val
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="slack-sender-msg"
                    value={val}
                    checked={(cfg.senderType ?? 'user') === val}
                    onChange={() => onChange({ senderType: val })}
                    className="sr-only"
                  />
                  <span className={`text-xs font-medium ${(cfg.senderType ?? 'user') === val ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-slate-200'}`}>{lbl}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{sub}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Flux Bot appearance (only when bot sender selected) */}
          {(cfg.senderType ?? 'user') === 'bot' && (
            <div className="space-y-2 rounded-md border border-violet-200 dark:border-violet-500/20 bg-violet-50/50 dark:bg-violet-500/5 px-3 py-2.5">
              <p className="text-[10px] font-medium text-violet-600 dark:text-violet-400">Flux Bot Appearance</p>
              <ExpressionInput
                label="Display Name"
                value={String(cfg.botUsername ?? '')}
                onChange={(v) => onChange({ botUsername: v })}
                placeholder="Flux Bot"
                nodes={otherNodes}
                testResults={testResults}
                hint="Overrides the bot's name shown in Slack. Supports expressions for dynamic names."
              />
              <ExpressionInput
                label="Icon Emoji"
                value={String(cfg.botIconEmoji ?? '')}
                onChange={(v) => onChange({ botIconEmoji: v })}
                placeholder=":robot_face:"
                nodes={otherNodes}
                testResults={testResults}
                hint="Emoji to use as the bot's icon, e.g. :zap: or :bell:. Supports expressions to vary per run."
              />
              <ExpressionInput
                label="Icon URL (optional, overrides emoji)"
                value={String(cfg.botIconUrl ?? '')}
                onChange={(v) => onChange({ botIconUrl: v })}
                placeholder="https://example.com/icon.png"
                nodes={otherNodes}
                testResults={testResults}
                hint="Public image URL for the bot icon. If set, takes priority over Icon Emoji."
              />
              <p className="text-[10px] text-violet-500/80 dark:text-violet-400/60 leading-relaxed">
                Requires <code className="font-mono bg-violet-100 dark:bg-violet-500/20 px-0.5 rounded">chat:write.customize</code> scope on your Slack app.
              </p>
            </div>
          )}

          <SlackMultiPicker
            label="Channels"
            value={channelsValue}
            onChange={(v) => onChange({ channels: v, channel: v })}
            items={channelItems}
            isLoading={loadingChannels}
            isError={errorChannels}
            placeholder="C1234567890 or {{nodes.x.channel}}"
            renderItem={(item) => `#${item.display}`}
            renderTag={(item, raw) => item ? `#${item.display}` : raw}
            hasCredential={!!credentialId}
            otherNodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionTextArea
            label="Message Text"
            value={String(cfg.text ?? '')}
            onChange={(v) => onChange({ text: v })}
            placeholder="Hello from your workflow!"
            nodes={otherNodes}
            testResults={testResults}
            rows={5}
            resizable
          />
        </>
      )}

      {/* ── Send DM ───────────────────────────────────────────────── */}
      {action === 'send_dm' && (
        <>
          {/* Sender selector */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Send as</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                ['user', 'My Slack Account', 'Acts as you'],
                ['bot',  'Flux Bot',         'Automated bot sender'],
              ] as const).map(([val, lbl, sub]) => (
                <label
                  key={val}
                  className={`flex flex-col gap-0.5 rounded-md border px-2.5 py-2 cursor-pointer transition-colors ${
                    (cfg.senderType ?? 'user') === val
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-500/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="slack-sender-dm"
                    value={val}
                    checked={(cfg.senderType ?? 'user') === val}
                    onChange={() => onChange({ senderType: val })}
                    className="sr-only"
                  />
                  <span className={`text-xs font-medium ${(cfg.senderType ?? 'user') === val ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-slate-200'}`}>{lbl}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{sub}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Flux Bot appearance (only when bot sender selected) */}
          {(cfg.senderType ?? 'user') === 'bot' && (
            <div className="space-y-2 rounded-md border border-violet-200 dark:border-violet-500/20 bg-violet-50/50 dark:bg-violet-500/5 px-3 py-2.5">
              <p className="text-[10px] font-medium text-violet-600 dark:text-violet-400">Flux Bot Appearance</p>
              <ExpressionInput
                label="Display Name"
                value={String(cfg.botUsername ?? '')}
                onChange={(v) => onChange({ botUsername: v })}
                placeholder="Flux Bot"
                nodes={otherNodes}
                testResults={testResults}
                hint="Overrides the bot's name shown in Slack. Supports expressions for dynamic names."
              />
              <ExpressionInput
                label="Icon Emoji"
                value={String(cfg.botIconEmoji ?? '')}
                onChange={(v) => onChange({ botIconEmoji: v })}
                placeholder=":robot_face:"
                nodes={otherNodes}
                testResults={testResults}
                hint="Emoji to use as the bot's icon, e.g. :zap: or :bell:. Supports expressions to vary per run."
              />
              <ExpressionInput
                label="Icon URL (optional, overrides emoji)"
                value={String(cfg.botIconUrl ?? '')}
                onChange={(v) => onChange({ botIconUrl: v })}
                placeholder="https://example.com/icon.png"
                nodes={otherNodes}
                testResults={testResults}
                hint="Public image URL for the bot icon. If set, takes priority over Icon Emoji."
              />
              <p className="text-[10px] text-violet-500/80 dark:text-violet-400/60 leading-relaxed">
                Requires <code className="font-mono bg-violet-100 dark:bg-violet-500/20 px-0.5 rounded">chat:write.customize</code> scope on your Slack app.
              </p>
            </div>
          )}

          <SlackMultiPicker
            label="Recipients"
            value={userIdsValue}
            onChange={(v) => onChange({ userIds: v, userId: v })}
            items={userItems}
            isLoading={loadingUsers}
            isError={errorUsers}
            placeholder="U1234567890 or {{nodes.x.userId}}"
            renderItem={(item) => `@${item.display}`}
            renderTag={(item, raw) => item ? `@${item.display}` : raw}
            hasCredential={!!credentialId}
            otherNodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionTextArea
            label="Message Text"
            value={String(cfg.text ?? '')}
            onChange={(v) => onChange({ text: v })}
            placeholder="Hello from your workflow!"
            nodes={otherNodes}
            testResults={testResults}
            rows={5}
            resizable
          />
        </>
      )}

      {/* ── Read Messages ─────────────────────────────────────────── */}
      {action === 'read_messages' && (
        <>
          {/* Source: channel or DM */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Read from</label>
            <div className="flex gap-4">
              {([['channel', 'Channel'], ['dm', 'Direct Message']] as const).map(([val, lbl]) => (
                <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="slack-read-source" value={val}
                    checked={readSource === val}
                    onChange={() => onChange({ readSource: val })}
                    className="w-3 h-3 accent-violet-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
                </label>
              ))}
            </div>
          </div>

          {readSource === 'channel' && (
            <SlackResourceSelect
              label="Channel"
              value={String(cfg.channel ?? cfg.channels ?? '')}
              onChange={(v) => onChange({ channel: v, channels: v })}
              items={channelItems}
              isLoading={loadingChannels}
              isError={errorChannels}
              placeholder="C1234567890 or {{nodes.x.channel}}"
              renderItem={(item) => `#${item.display}`}
              hasCredential={!!credentialId}
              otherNodes={otherNodes}
              testResults={testResults}
            />
          )}

          {readSource === 'dm' && (
            <SlackResourceSelect
              label="User (DM)"
              value={String(cfg.readUserId ?? '')}
              onChange={(v) => onChange({ readUserId: v })}
              items={userItems}
              isLoading={loadingUsers}
              isError={errorUsers}
              placeholder="U1234567890 or {{nodes.x.userId}}"
              renderItem={(item) => `@${item.display}`}
              hasCredential={!!credentialId}
              otherNodes={otherNodes}
              testResults={testResults}
            />
          )}

          {/* Message limit */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              Message limit <span className="text-slate-400 font-normal">(max 200)</span>
            </label>
            <input type="number" min={1} max={200}
              value={String(cfg.limit ?? 20)}
              onChange={(e) => onChange({ limit: Number(e.target.value) })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500" />
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Messages are returned oldest → newest.
            </p>
          </div>
        </>
      )}

      {/* ── Read Thread ───────────────────────────────────────────── */}
      {action === 'read_thread' && (
        <>
          {/* Source: channel or DM */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Read from</label>
            <div className="flex gap-4">
              {([['channel', 'Channel'], ['dm', 'Direct Message']] as const).map(([val, lbl]) => (
                <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="slack-thread-source" value={val}
                    checked={readSource === val}
                    onChange={() => onChange({ readSource: val })}
                    className="w-3 h-3 accent-violet-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
                </label>
              ))}
            </div>
          </div>

          {readSource === 'channel' && (
            <SlackResourceSelect
              label="Channel"
              value={String(cfg.channel ?? cfg.channels ?? '')}
              onChange={(v) => onChange({ channel: v, channels: v })}
              items={channelItems}
              isLoading={loadingChannels}
              isError={errorChannels}
              placeholder="C1234567890 or {{nodes.x.channel}}"
              renderItem={(item) => `#${item.display}`}
              hasCredential={!!credentialId}
              otherNodes={otherNodes}
              testResults={testResults}
            />
          )}

          {readSource === 'dm' && (
            <SlackResourceSelect
              label="User (DM)"
              value={String(cfg.readUserId ?? '')}
              onChange={(v) => onChange({ readUserId: v })}
              items={userItems}
              isLoading={loadingUsers}
              isError={errorUsers}
              placeholder="U1234567890 or {{nodes.x.userId}}"
              renderItem={(item) => `@${item.display}`}
              hasCredential={!!credentialId}
              otherNodes={otherNodes}
              testResults={testResults}
            />
          )}

          <ExpressionInput
            label="Thread Timestamp (ts)"
            value={String(cfg.threadTs ?? '')}
            onChange={(v) => onChange({ threadTs: v })}
            placeholder="1715000000.123456 or {{nodes.x.ts}}"
            nodes={otherNodes}
            testResults={testResults}
          />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-2">
            The <code className="font-mono bg-slate-100 dark:bg-slate-700 px-0.5 rounded">ts</code> value of the parent message — found in the output of a Read Messages node.
          </p>

          {/* Reply limit */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              Reply limit <span className="text-slate-400 font-normal">(max 200)</span>
            </label>
            <input type="number" min={1} max={200}
              value={String(cfg.limit ?? 50)}
              onChange={(e) => onChange({ limit: Number(e.target.value) })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </div>
        </>
      )}

      {/* ── Upload File ───────────────────────────────────────────── */}
      {action === 'upload_file' && (
        <>
          <ExpressionInput
            label="Filename"
            value={String(cfg.filename ?? '')}
            onChange={(v) => onChange({ filename: v })}
            placeholder="report.pdf"
            nodes={otherNodes}
            testResults={testResults}
          />

          <SlackUploadInput cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />

          {/* ── Send to ──────────────────────────────────────────── */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Send to</label>
            <div className="flex gap-4 flex-wrap">
              {([
                ['channel', 'Channel'],
                ['dm',      'Direct Message'],
                ['none',    'Upload privately'],
              ] as const).map(([val, lbl]) => (
                <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="slack-share-target" value={val}
                    checked={(cfg.shareTarget ?? 'channel') === val}
                    onChange={() => onChange({ shareTarget: val })}
                    className="w-3 h-3 accent-violet-500" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
                </label>
              ))}
            </div>
          </div>

          {(cfg.shareTarget ?? 'channel') === 'channel' && (
            <SlackResourceSelect
              label="Channel (optional)"
              value={String(cfg.channel ?? cfg.channels ?? '')}
              onChange={(v) => onChange({ channel: v, channels: v })}
              items={channelItems}
              isLoading={loadingChannels}
              isError={errorChannels}
              placeholder="Leave blank to upload without sharing"
              renderItem={(item) => `#${item.display}`}
              hasCredential={!!credentialId}
              otherNodes={otherNodes}
              testResults={testResults}
            />
          )}

          {(cfg.shareTarget ?? 'channel') === 'dm' && (
            <SlackResourceSelect
              label="Recipient (DM)"
              value={String(cfg.uploadUserId ?? '')}
              onChange={(v) => onChange({ uploadUserId: v })}
              items={userItems}
              isLoading={loadingUsers}
              isError={errorUsers}
              placeholder="U1234567890 or {{nodes.x.userId}}"
              renderItem={(item) => `@${item.display}`}
              hasCredential={!!credentialId}
              otherNodes={otherNodes}
              testResults={testResults}
            />
          )}
        </>
      )}

      {/* ── List Users ────────────────────────────────────────────── */}
      {action === 'list_users' && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5">
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Returns all workspace members (bots included) with their IDs, display names, and email addresses.
            No additional configuration required.
          </p>
        </div>
      )}

      {/* ── List Channels ─────────────────────────────────────────── */}
      {action === 'list_channels' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Channel type</label>
          <div className="flex gap-4">
            {([['all', 'All'], ['public', 'Public only'], ['private', 'Private only']] as const).map(([val, lbl]) => (
              <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="slack-channel-filter" value={val}
                  checked={channelFilter === val}
                  onChange={() => onChange({ channelFilter: val })}
                  className="w-3 h-3 accent-violet-500" />
                <span className="text-xs text-slate-600 dark:text-slate-300">{lbl}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── GSheetsFormatPanel ─────────────────────────────────────────────────────────

/** Colour swatch + expression-aware hex input for font / background colour pickers. */
function ColorPicker({ label, value, onChange, nodes, testResults }: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const isExpr = EXPR_RE.test(value);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {!isExpr && (
          <input
            type="color"
            value={value || '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border border-slate-300 dark:border-slate-600 bg-transparent p-0.5 shrink-0"
          />
        )}
        <div className="flex-1">
          <ExpressionInput
            label={label}
            value={value}
            onChange={onChange}
            placeholder="#RRGGBB or {{nodes.x.color}}"
            nodes={nodes}
            testResults={testResults}
          />
        </div>
      </div>
    </div>
  );
}

function GSheetsFormatPanel({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  return (
    <div className="space-y-3">
      {/* Target range */}
      <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
        onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
        nodes={otherNodes} testResults={testResults} />

      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Range to format</label>
        <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2.5 space-y-2">
          <ExpressionInput label="A1 notation (e.g. A1:D5, A:D, 1:3)" value={String(cfg.formatRange ?? '')}
            onChange={(v) => onChange({ formatRange: v })}
            placeholder="A1:D10 — overrides row/column fields below"
            nodes={otherNodes} testResults={testResults} />
          <div className="text-[10px] text-slate-400 dark:text-slate-500 text-center italic">— or specify rows and columns separately —</div>
          <div className="flex gap-2">
            <div className="flex-1">
              <ExpressionInput label="Start row (1-based)"
                value={String(cfg.formatRowStart ?? '')}
                onChange={(v) => onChange({ formatRowStart: v || undefined })}
                placeholder="1 or {{nodes.x.row}}"
                nodes={otherNodes} testResults={testResults} />
            </div>
            <div className="flex-1">
              <ExpressionInput label="End row (inclusive)"
                value={String(cfg.formatRowEnd ?? '')}
                onChange={(v) => onChange({ formatRowEnd: v || undefined })}
                placeholder="same as start"
                nodes={otherNodes} testResults={testResults} />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <ExpressionInput label="Start column (letter)"
                value={String(cfg.formatColumnStart ?? '')}
                onChange={(v) => onChange({ formatColumnStart: v || undefined })}
                placeholder="A or {{nodes.x.col}}"
                nodes={otherNodes} testResults={testResults} />
            </div>
            <div className="flex-1">
              <ExpressionInput label="End column (letter, inclusive)"
                value={String(cfg.formatColumnEnd ?? '')}
                onChange={(v) => onChange({ formatColumnEnd: v || undefined })}
                placeholder="same as start"
                nodes={otherNodes} testResults={testResults} />
            </div>
          </div>
        </div>
      </div>

      {/* Text style */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Text style</label>
        <div className="flex flex-wrap gap-1.5">
          {([['bold','B','font-bold'], ['italic','I','italic'], ['underline','U','underline'], ['strikethrough','S','line-through']] as const).map(([key, lbl, cls]) => (
            <button key={key} type="button"
              onClick={() => onChange({ [key]: cfg[key] === true ? undefined : cfg[key] === false ? true : true })}
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${cls} ${
                cfg[key] === true
                  ? 'bg-blue-500 text-white border-blue-500'
                  : cfg[key] === false
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-300 dark:border-red-700'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-blue-400'
              }`}>
              {lbl}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Click once to enable, click again to disable, click a third time to leave unchanged.</p>
      </div>

      {/* Font size */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <ExpressionInput label="Font size (pt)"
            value={String(cfg.fontSize ?? '')}
            onChange={(v) => onChange({ fontSize: v || undefined })}
            placeholder="Default or {{nodes.x.size}}"
            nodes={otherNodes} testResults={testResults} />
        </div>
        <div className="flex-1">
          <ColorPicker label="Font colour"
            value={String(cfg.fontColor ?? '')}
            onChange={(v) => onChange({ fontColor: v || undefined })}
            nodes={otherNodes} testResults={testResults} />
        </div>
      </div>

      {/* Background colour */}
      <ColorPicker label="Cell background colour"
        value={String(cfg.backgroundColor ?? '')}
        onChange={(v) => onChange({ backgroundColor: v || undefined })}
        nodes={otherNodes} testResults={testResults} />

      {/* Number format */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Number format</label>
        <select
          value={String(cfg.numberFormat ?? '')}
          onChange={(e) => onChange({ numberFormat: e.target.value || undefined })}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="">— no change —</option>
          <option value="TEXT">Text (plain text)</option>
          <option value="NUMBER">Number (1234.56)</option>
          <option value="CURRENCY">Currency ($1,234.56)</option>
          <option value="PERCENT">Percent (12.34%)</option>
          <option value="DATE">Date</option>
          <option value="TIME">Time</option>
          <option value="DATE_TIME">Date + Time</option>
          <option value="SCIENTIFIC">Scientific (1.23E+03)</option>
          <option value="FRACTION">Fraction (1/2)</option>
          <option value="CUSTOM">Custom pattern…</option>
        </select>
        {cfg.numberFormat === 'CUSTOM' && (
          <input type="text"
            value={String(cfg.numberFormatPattern ?? '')}
            onChange={(e) => onChange({ numberFormatPattern: e.target.value })}
            placeholder='#,##0.00 — or — yyyy-MM-dd — or — "€"#,##0.00'
            className="w-full mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
        )}
      </div>

      {/* Layout */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Alignment &amp; wrap</label>
        <div className="space-y-1">
          <label className="block text-[10px] text-slate-400 dark:text-slate-500">Horizontal</label>
          <div className="flex gap-1">
            {(['LEFT','CENTER','RIGHT'] as const).map((v) => (
              <button key={v} type="button"
                onClick={() => onChange({ horizontalAlignment: cfg.horizontalAlignment === v ? undefined : v })}
                className={`flex-1 py-1 text-xs rounded border transition-colors ${
                  cfg.horizontalAlignment === v
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-blue-400'
                }`}>
                {v[0] + v.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] text-slate-400 dark:text-slate-500">Vertical</label>
          <div className="flex gap-1">
            {(['TOP','MIDDLE','BOTTOM'] as const).map((v) => (
              <button key={v} type="button"
                onClick={() => onChange({ verticalAlignment: cfg.verticalAlignment === v ? undefined : v })}
                className={`flex-1 py-1 text-xs rounded border transition-colors ${
                  cfg.verticalAlignment === v
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-blue-400'
                }`}>
                {v[0] + v.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] text-slate-400 dark:text-slate-500">Wrap</label>
          <div className="flex gap-1">
            {([['OVERFLOW_CELL','Overflow'],['CLIP','Clip'],['WRAP','Wrap']] as const).map(([v, lbl]) => (
              <button key={v} type="button"
                onClick={() => onChange({ wrapStrategy: cfg.wrapStrategy === v ? undefined : v })}
                className={`flex-1 py-1 text-xs rounded border transition-colors ${
                  cfg.wrapStrategy === v
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-blue-400'
                }`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── GSheetsConfig ──────────────────────────────────────────────────────────────

/** Picker for a Google Spreadsheet — browse Drive (filtered to Sheets) or search by name/owner/folder. */
function GSheetsSpreadsheetPicker({ cfg, onChange, label = 'Spreadsheet', otherNodes, testResults }: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  label?: string;
  otherNodes: ConfigProps['otherNodes'];
  testResults: ConfigProps['testResults'];
}) {
  const credentialId = String(cfg.credentialId ?? '');
  const [mode, setMode] = useState<'browse' | 'search'>(() =>
    (cfg.spreadsheetName || cfg.owner || cfg.searchFolderId) ? 'search' : 'browse'
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
        <div className="flex rounded overflow-hidden border border-slate-200 dark:border-slate-700 text-[10px] shrink-0">
          <button type="button" onClick={() => setMode('browse')}
            className={`px-2 py-0.5 transition-colors ${mode === 'browse' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
            Browse Drive
          </button>
          <button type="button" onClick={() => setMode('search')}
            className={`px-2 py-0.5 transition-colors ${mode === 'search' ? 'bg-blue-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
            Search / ID
          </button>
        </div>
      </div>

      {mode === 'browse' ? (
        <GDriveFolderBrowser
          credentialId={credentialId}
          value={String(cfg.spreadsheetId ?? '')}
          valuePath={String(cfg.spreadsheetPath ?? '')}
          onChange={(id, path) => onChange({ spreadsheetId: id, spreadsheetPath: path, spreadsheetName: '', owner: '', searchFolderId: '' })}
          label=""
          placeholder="Browse and select a spreadsheet"
          foldersOnly={false}
          mimeTypeFilter="application/vnd.google-apps.spreadsheet"
        />
      ) : (
        <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-700 p-2.5">
          <ExpressionInput label="Spreadsheet name (contains)" value={String(cfg.spreadsheetName ?? '')}
            onChange={(v) => onChange({ spreadsheetName: v, spreadsheetId: '' })}
            placeholder="Budget 2025, Employee Data…"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Owner email (optional)" value={String(cfg.owner ?? '')}
            onChange={(v) => onChange({ owner: v })}
            placeholder="owner@example.com"
            nodes={otherNodes} testResults={testResults} />
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.searchFolderId ?? '')}
            valuePath={String(cfg.searchFolderPath ?? '')}
            onChange={(id, path) => onChange({ searchFolderId: id, searchFolderPath: path })}
            label="Search in folder (optional)"
            placeholder="All of My Drive"
          />
          <div className="border-t border-slate-200 dark:border-slate-700 pt-2">
            <ExpressionInput label="— or enter Spreadsheet ID directly —" value={String(cfg.spreadsheetId ?? '')}
              onChange={(v) => onChange({ spreadsheetId: v, spreadsheetName: '', owner: '', searchFolderId: '' })}
              placeholder="{{nodes.x.spreadsheetId}} or paste an ID"
              nodes={otherNodes} testResults={testResults} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Value input option selector shared between write/append actions. */
function GSheetsValueInputOption({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (p: Partial<Record<string, unknown>>) => void }) {
  return (
    <Select
      label="Value input option"
      value={String(cfg.valueInputOption ?? 'USER_ENTERED')}
      onChange={(e) => onChange({ valueInputOption: e.target.value })}
      options={[
        { value: 'USER_ENTERED', label: 'User Entered — parses formulas & numbers' },
        { value: 'RAW',          label: 'Raw — everything stored as plain text' },
      ]}
    />
  );
}

/**
 * Smart values + columnKeys input used by all write / append / upsert actions.
 * - Accepts any shape: 2-D array, 1-D array, array of objects, single object,
 *   or an expression like {{nodes.x.data}}.
 * - Formula strings (e.g. =SUM(A1:B1)) are automatically evaluated by Google
 *   Sheets when "User Entered" mode is selected.
 * - columnKeys controls which object properties are extracted and in what column order.
 */
function GSheetsValuesInput({
  cfg,
  onChange,
  label,
  placeholder,
  hint,
  multiRow = false,
  otherNodes,
  testResults,
}: {
  cfg: Record<string, unknown>;
  onChange: (p: Partial<Record<string, unknown>>) => void;
  label: string;
  placeholder: string;
  hint?: string;
  multiRow?: boolean;
  otherNodes: ConfigProps['otherNodes'];
  testResults: ConfigProps['testResults'];
}) {
  const valStr = typeof cfg.values === 'string'
    ? cfg.values
    : JSON.stringify(cfg.values ?? (multiRow ? [['value1', 'value2']] : ['value1', 'value2']), null, 2);

  return (
    <div className="space-y-2">
      <ExpressionTextArea
        label={label}
        value={valStr}
        onChange={(v) => onChange({ values: v })}
        placeholder={placeholder}
        nodes={otherNodes}
        testResults={testResults}
        rows={multiRow ? 4 : 3}
      />
      {hint && <p className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>}

      {/* Column keys — shown collapsed by default */}
      <div className="space-y-1">
        <ExpressionInput
          label="Column keys (optional — for object inputs)"
          value={String(cfg.columnKeys ?? '')}
          onChange={(v) => onChange({ columnKeys: v })}
          placeholder="name, email, status"
          nodes={otherNodes}
          testResults={testResults}
          hint="Comma-separated property names. When your values come from an object or array of objects, this controls which keys are extracted and in which column order. Example: name,email,status → columns A, B, C. Omit to use the object's own key order."
        />
      </div>

      {/* Formula callout */}
      <div className="flex gap-2 rounded-md border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-900/20 px-2.5 py-2">
        <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-blue-700 dark:text-blue-300 leading-relaxed">
          <strong>Smart data handling:</strong> arrays, objects, or expressions are automatically converted.
          Any cell value starting with <code className="font-mono bg-blue-100 dark:bg-blue-800/40 px-0.5 rounded">=</code> (e.g.{' '}
          <code className="font-mono bg-blue-100 dark:bg-blue-800/40 px-0.5 rounded">=SUM(A1:B1)</code>) is
          treated as a formula when <em>Value input</em> is set to "User Entered".
          Nested objects or arrays within a cell are serialised to JSON.
        </p>
      </div>

      <GSheetsValueInputOption cfg={cfg} onChange={onChange} />
    </div>
  );
}

function GSheetsConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action       = (cfg.action as string) ?? 'read';
  const credentialId = String(cfg.credentialId ?? '');

  const needsSpreadsheet = action !== 'create_spreadsheet';

  return (
    <div className="space-y-3">
      <CredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id })}
      />
      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { group: 'Read & Write', options: [
            { value: 'read',   label: 'Read Rows' },
            { value: 'write',  label: 'Write / Update Rows' },
            { value: 'append', label: 'Append Rows (bulk)' },
          ]},
          { group: 'Spreadsheet (Document)', options: [
            { value: 'create_spreadsheet', label: 'Create Spreadsheet' },
            { value: 'delete_spreadsheet', label: 'Delete Spreadsheet' },
          ]},
          { group: 'Insert & Delete Rows / Columns', options: [
            { value: 'insert_rows',         label: 'Insert Rows' },
            { value: 'insert_columns',      label: 'Insert Columns' },
            { value: 'delete_rows_columns', label: 'Delete Rows or Columns' },
          ]},
          { group: 'Row & Cell Data', options: [
            { value: 'get_rows',           label: 'Get Row(s)' },
            { value: 'append_row',         label: 'Append Row(s)' },
            { value: 'append_to_row',      label: 'Append to Specific Row (horizontal)' },
            { value: 'append_to_column',   label: 'Append to Specific Column (vertical)' },
            { value: 'append_update_row',  label: 'Append or Update Row (Upsert)' },
            { value: 'update_row',         label: 'Update Row' },
          ]},
          { group: 'Formatting & Structure', options: [
            { value: 'format_cells',  label: 'Format Cells / Rows / Columns' },
            { value: 'clear_sheet',   label: 'Clear Sheet' },
            { value: 'create_sheet',  label: 'Create Sheet Tab' },
            { value: 'delete_sheet',  label: 'Delete Sheet Tab' },
          ]},
        ]}
      />

      {/* ── Spreadsheet picker (all actions except create_spreadsheet) ── */}
      {needsSpreadsheet && (
        <GSheetsSpreadsheetPicker cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
      )}

      {/* ── create_spreadsheet ──────────────────────────────────── */}
      {action === 'create_spreadsheet' && (
        <>
          <ExpressionInput label="Spreadsheet title" value={String(cfg.title ?? '')}
            onChange={(v) => onChange({ title: v })} placeholder="My Spreadsheet"
            nodes={otherNodes} testResults={testResults} />
          <GDriveFolderBrowser
            credentialId={credentialId}
            value={String(cfg.folderId ?? '')}
            valuePath={String(cfg.folderPath ?? '')}
            onChange={(id, path) => onChange({ folderId: id, folderPath: path })}
            label="Save in folder (optional)"
            placeholder="My Drive (root)"
          />
        </>
      )}

      {/* ── delete_spreadsheet ──────────────────────────────────── */}
      {action === 'delete_spreadsheet' && (
        <div className="flex items-center gap-2">
          <input type="checkbox" id="gsheets-perm" checked={!!cfg.permanent}
            onChange={(e) => onChange({ permanent: e.target.checked })} className="w-3.5 h-3.5 rounded" />
          <label htmlFor="gsheets-perm" className="text-xs text-slate-500 dark:text-slate-400">
            Permanently delete (bypass trash)
          </label>
        </div>
      )}

      {/* ── read ────────────────────────────────────────────────── */}
      {action === 'read' && (
        <>
          <ExpressionInput label="Range (A1 notation)" value={String(cfg.range ?? '')}
            onChange={(v) => onChange({ range: v })} placeholder="Sheet1!A1:Z100 — or Sheet1!B:D for specific columns"
            nodes={otherNodes} testResults={testResults} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gsheets-hasHeaders" checked={cfg.hasHeaders !== false}
              onChange={(e) => onChange({ hasHeaders: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gsheets-hasHeaders" className="text-xs text-slate-500 dark:text-slate-400">
              First row is headers (returns objects)
            </label>
          </div>
          {cfg.hasHeaders !== false && (
            <ExpressionInput label="Select columns (optional — comma-separated header names)"
              value={String(cfg.selectColumns ?? '')}
              onChange={(v) => onChange({ selectColumns: v })}
              placeholder="name, email, status"
              nodes={otherNodes} testResults={testResults}
              hint="Only these columns will appear in the returned data objects. Leave blank to return all columns." />
          )}
        </>
      )}

      {/* ── write ───────────────────────────────────────────────── */}
      {action === 'write' && (
        <>
          <ExpressionInput label="Range (A1 notation)" value={String(cfg.range ?? '')}
            onChange={(v) => onChange({ range: v })} placeholder="Sheet1!A1:Z100"
            nodes={otherNodes} testResults={testResults} />
          <GSheetsValuesInput
            cfg={cfg} onChange={onChange}
            label="Values"
            placeholder={'[["col1","col2"],["val1","val2"]] — or {{nodes.x.data}}'}
            hint="Pass a 2-D array, an array of objects, or a single object. Each object becomes one row."
            multiRow
            otherNodes={otherNodes} testResults={testResults}
          />
        </>
      )}

      {/* ── append ──────────────────────────────────────────────── */}
      {action === 'append' && (
        <>
          <ExpressionInput label="Range / Sheet name" value={String(cfg.range ?? '')}
            onChange={(v) => onChange({ range: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults}
            hint="Rows will be appended after the last row of data in this range." />
          <GSheetsValuesInput
            cfg={cfg} onChange={onChange}
            label="Values"
            placeholder={'[["row1col1","row1col2"],["row2col1","row2col2"]] — or {{nodes.x.data}}'}
            hint="Pass a 2-D array, an array of objects, or a single object. Each object / sub-array becomes one new row."
            multiRow
            otherNodes={otherNodes} testResults={testResults}
          />
        </>
      )}

      {/* ── get_rows ────────────────────────────────────────────── */}
      {action === 'get_rows' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Range override (optional)" value={String(cfg.range ?? '')}
            onChange={(v) => onChange({ range: v })} placeholder="Sheet1!A1:Z100 — or Sheet1!B:D for columns"
            nodes={otherNodes} testResults={testResults} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gsheets-getrows-headers" checked={cfg.hasHeaders !== false}
              onChange={(e) => onChange({ hasHeaders: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gsheets-getrows-headers" className="text-xs text-slate-500 dark:text-slate-400">
              First row is headers (returns objects)
            </label>
          </div>
          {cfg.hasHeaders !== false && (
            <ExpressionInput label="Select columns (optional — comma-separated header names)"
              value={String(cfg.selectColumns ?? '')}
              onChange={(v) => onChange({ selectColumns: v })}
              placeholder="name, email, status"
              nodes={otherNodes} testResults={testResults}
              hint="Only these columns are included in the output. Leave blank for all columns." />
          )}
          <ExpressionInput label="Filter column (optional)" value={String(cfg.filterColumn ?? '')}
            onChange={(v) => onChange({ filterColumn: v })} placeholder="email or A"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Filter value (optional)" value={String(cfg.filterValue ?? '')}
            onChange={(v) => onChange({ filterValue: v })} placeholder="john@example.com or {{nodes.x.email}}"
            nodes={otherNodes} testResults={testResults} />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Max results (0 = all)</label>
            <input type="number" min={0}
              value={Number(cfg.maxResults ?? 0)}
              onChange={(e) => onChange({ maxResults: Number(e.target.value) })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </>
      )}

      {/* ── append_row ──────────────────────────────────────────── */}
      {action === 'append_row' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <GSheetsValuesInput
            cfg={cfg} onChange={onChange}
            label="Row data"
            placeholder={'["John", "Doe", "=A2&B2"] — or {{nodes.x.record}} — or {{nodes.x.records}}'}
            hint="1-D array → one row. Object → one row from its values. Array of objects → each becomes a row. Formulas like =A1+B1 work when Value input is User Entered."
            otherNodes={otherNodes} testResults={testResults}
          />
        </>
      )}

      {/* ── append_update_row (upsert) ───────────────────────────── */}
      {action === 'append_update_row' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Key column (header name or letter)" value={String(cfg.keyColumn ?? '')}
            onChange={(v) => onChange({ keyColumn: v })} placeholder="email or A"
            nodes={otherNodes} testResults={testResults}
            hint="The column whose value is used to find an existing row. If a match is found the row is updated; otherwise the data is appended as a new row." />
          <ExpressionInput label="Key value to match" value={String(cfg.keyValue ?? '')}
            onChange={(v) => onChange({ keyValue: v })} placeholder="john@example.com or {{nodes.x.email}}"
            nodes={otherNodes} testResults={testResults} />
          <GSheetsValuesInput
            cfg={cfg} onChange={onChange}
            label="Row data"
            placeholder={'["John", "Doe", "john@example.com"] — or {{nodes.x.record}}'}
            hint="Pass a 1-D array, a single object (use Column keys to control order), or an expression. The first row of the resolved data is used for the upsert."
            otherNodes={otherNodes} testResults={testResults}
          />
        </>
      )}

      {/* ── update_row ──────────────────────────────────────────── */}
      {action === 'update_row' && (
        <>
          <ExpressionInput label="Range (A1 notation — e.g. Sheet1!A2)" value={String(cfg.range ?? '')}
            onChange={(v) => onChange({ range: v })} placeholder="Sheet1!A2"
            nodes={otherNodes} testResults={testResults} />
          <GSheetsValuesInput
            cfg={cfg} onChange={onChange}
            label="Row data"
            placeholder={'["John", "Doe", "john@example.com"] — or {{nodes.x.record}}'}
            hint="Pass a 1-D array, a single object, or an expression. The row is written starting at the given range."
            otherNodes={otherNodes} testResults={testResults}
          />
        </>
      )}

      {/* ── append_to_row (horizontal) ──────────────────────────── */}
      {action === 'append_to_row' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Row number (1-based)"
            value={String(cfg.rowNumber ?? '1')}
            onChange={(v) => onChange({ rowNumber: v })}
            placeholder="1 or {{nodes.x.rowNum}}"
            nodes={otherNodes} testResults={testResults}
            hint="Which row to append to. Accepts a literal number or an expression." />
          <GSheetsValuesInput
            cfg={cfg} onChange={onChange}
            label="Data to append (written after the last non-empty cell in that row)"
            placeholder={'["Q4 Total", "=SUM(B2:E2)", "2025-01-01"] — or {{nodes.x.row}}'}
            hint="1-D array or expression. Data is written horizontally starting at the first empty column in the specified row."
            otherNodes={otherNodes} testResults={testResults}
          />
        </>
      )}

      {/* ── append_to_column (vertical) ─────────────────────────── */}
      {action === 'append_to_column' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Column letter" value={String(cfg.columnLetter ?? '')}
            onChange={(v) => onChange({ columnLetter: v })} placeholder="A, B, C…"
            nodes={otherNodes} testResults={testResults}
            hint="The column where data will be appended below the last non-empty cell. E.g. B to append to column B." />
          <GSheetsValuesInput
            cfg={cfg} onChange={onChange}
            label="Data to append (each item becomes a new row in this column)"
            placeholder={'["Alice", "Bob", "Carol"] — or {{nodes.x.names}} — or {{nodes.x.records}}'}
            hint="Each element of the array becomes one new cell going down. Accepts a 1-D array, an array of objects (first value of each), or an expression."
            otherNodes={otherNodes} testResults={testResults}
          />
        </>
      )}

      {/* ── insert_rows ─────────────────────────────────────────── */}
      {action === 'insert_rows' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Number of rows to insert"
            value={String(cfg.insertCount ?? '1')}
            onChange={(v) => onChange({ insertCount: v })}
            placeholder="1 or {{nodes.x.count}}"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Insert before row (0-based index)"
            value={String(cfg.insertStartIndex ?? '0')}
            onChange={(v) => onChange({ insertStartIndex: v })}
            placeholder="0 or {{nodes.x.rowIndex}}"
            nodes={otherNodes} testResults={testResults}
            hint="0 = before the first row, 1 = before row 2, etc. Accepts a literal number or an expression." />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gsheets-inherit-rows" checked={!!cfg.inheritFromBefore}
              onChange={(e) => onChange({ inheritFromBefore: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gsheets-inherit-rows" className="text-xs text-slate-500 dark:text-slate-400">
              Inherit formatting from the row above
            </label>
          </div>
        </>
      )}

      {/* ── insert_columns ───────────────────────────────────────── */}
      {action === 'insert_columns' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Number of columns to insert"
            value={String(cfg.insertCount ?? '1')}
            onChange={(v) => onChange({ insertCount: v })}
            placeholder="1 or {{nodes.x.count}}"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Insert before column (letter or 0-based index)"
            value={String(cfg.columnLetter ?? String(cfg.insertStartIndex ?? '0'))}
            onChange={(v) => onChange({ columnLetter: v, insertStartIndex: undefined })}
            placeholder="A, B, C… or 0 or {{nodes.x.col}}"
            nodes={otherNodes} testResults={testResults}
            hint="Enter a column letter (A, B, C…), a 0-based index, or an expression. The new columns are inserted BEFORE this position." />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gsheets-inherit-cols" checked={!!cfg.inheritFromBefore}
              onChange={(e) => onChange({ inheritFromBefore: e.target.checked })} className="w-3.5 h-3.5 rounded" />
            <label htmlFor="gsheets-inherit-cols" className="text-xs text-slate-500 dark:text-slate-400">
              Inherit formatting from the column to the left
            </label>
          </div>
        </>
      )}

      {/* ── format_cells ─────────────────────────────────────────── */}
      {action === 'format_cells' && (
        <GSheetsFormatPanel cfg={cfg} onChange={onChange} otherNodes={otherNodes} testResults={testResults} />
      )}

      {/* ── clear_sheet ─────────────────────────────────────────── */}
      {action === 'clear_sheet' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Range override (optional)" value={String(cfg.range ?? '')}
            onChange={(v) => onChange({ range: v })} placeholder="Sheet1!A1:Z100 — leave blank to clear the whole sheet"
            nodes={otherNodes} testResults={testResults} />
        </>
      )}

      {/* ── create_sheet ────────────────────────────────────────── */}
      {action === 'create_sheet' && (
        <ExpressionInput label="New sheet tab title" value={String(cfg.newSheetTitle ?? '')}
          onChange={(v) => onChange({ newSheetTitle: v })} placeholder="Summary"
          nodes={otherNodes} testResults={testResults} />
      )}

      {/* ── delete_sheet ────────────────────────────────────────── */}
      {action === 'delete_sheet' && (
        <ExpressionInput label="Sheet tab name to delete" value={String(cfg.sheetName ?? '')}
          onChange={(v) => onChange({ sheetName: v })} placeholder="OldData"
          nodes={otherNodes} testResults={testResults} />
      )}

      {/* ── delete_rows_columns ─────────────────────────────────── */}
      {action === 'delete_rows_columns' && (
        <>
          <ExpressionInput label="Sheet name" value={String(cfg.sheetName ?? '')}
            onChange={(v) => onChange({ sheetName: v })} placeholder="Sheet1"
            nodes={otherNodes} testResults={testResults} />
          <Select
            label="Delete"
            value={String(cfg.deleteType ?? 'rows')}
            onChange={(e) => onChange({ deleteType: e.target.value })}
            options={[
              { value: 'rows',    label: 'Rows' },
              { value: 'columns', label: 'Columns' },
            ]}
          />
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Start index (0-based)</label>
              <input type="number" min={0}
                value={Number(cfg.startIndex ?? 0)}
                onChange={(e) => onChange({ startIndex: Number(e.target.value) })}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div className="flex-1 space-y-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">End index (exclusive)</label>
              <input type="number" min={1}
                value={Number(cfg.endIndex ?? 1)}
                onChange={(e) => onChange({ endIndex: Number(e.target.value) })}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            Example: start 1, end 3 deletes 2 rows (rows 2 and 3 in the sheet, 0-indexed).
          </p>
        </>
      )}
    </div>
  );
}

// ── Teams credential helper ────────────────────────────────────────────────────

function TeamsCredentialSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: credentials = [], isLoading } = useCredentialList();
  const teamsCreds = credentials.filter((c) => c.provider === 'teams');
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Microsoft Account</label>
      {isLoading ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Loading accounts…</p>
      ) : teamsCreds.length === 0 ? (
        <p className="text-[10px] text-amber-400">
          No Microsoft accounts connected. Click <strong>Credentials</strong> in the toolbar to connect one.
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: '— select account —' },
            ...teamsCreds.map((c) => ({ value: c.id, label: c.label })),
          ]}
        />
      )}
    </div>
  );
}

// ── TeamsConfig ────────────────────────────────────────────────────────────────

function TeamsConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action       = (cfg.action as string) ?? 'send_message';
  const credentialId = String(cfg.credentialId ?? '');
  const teamId       = String(cfg.teamId ?? '');
  const channelId    = String(cfg.channelId ?? '');

  const { teams,    isLoading: loadingTeams,    isError: errorTeams }    = useTeamsTeams(credentialId);
  const { channels, isLoading: loadingChannels, isError: errorChannels } = useTeamsChannels(credentialId, teamId);
  const { data: users = [], isLoading: loadingUsers, isError: errorUsers } = useTeamsUsers(
    action === 'send_dm' ? credentialId : ''
  );

  const teamItems = teams.map((t) => ({ id: t.id, display: t.displayName }));
  const channelItems = channels.map((c) => ({
    id:      c.id,
    display: c.membershipType === 'private' ? `🔒 ${c.displayName}` : c.displayName,
  }));
  const userItems = users.map((u) => ({
    id:      u.id,
    display: u.displayName || u.mail || u.userPrincipalName,
  }));

  const needsTeamChannel = action === 'send_message' || action === 'read_messages' || action === 'read_thread';

  return (
    <div className="space-y-3">
      <TeamsCredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id, teamId: '', channelId: '' })}
      />

      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { value: 'send_message',  label: 'Send Channel Message' },
          { value: 'send_dm',       label: 'Send Direct Message' },
          { value: 'read_messages', label: 'Read Channel Messages' },
          { value: 'read_thread',   label: 'Read Thread Replies' },
        ]}
      />

      {needsTeamChannel && (
        <>
          {/* Team picker */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Team</span>
            </div>
            {!credentialId ? (
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Select an account first.</p>
            ) : loadingTeams ? (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading teams…
              </div>
            ) : errorTeams ? (
              <p className="text-[10px] text-red-400">Failed to load teams.</p>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                {teamItems.length === 0 && (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No teams found.</p>
                )}
                {teamItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChange({ teamId: item.id, channelId: '' })}
                    className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                      item.id === teamId
                        ? 'bg-blue-200 dark:bg-blue-600/30 text-blue-700 dark:text-blue-300'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.display}
                  </button>
                ))}
              </div>
            )}
            {teamId && teams.length > 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                Selected: <span className="text-slate-700 dark:text-slate-300">{teams.find((t) => t.id === teamId)?.displayName ?? teamId}</span>
              </p>
            )}
          </div>

          {/* Channel picker — shown only once a team is selected */}
          {teamId && (
            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Channel</span>
              {loadingChannels ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading channels…
                </div>
              ) : errorChannels ? (
                <p className="text-[10px] text-red-400">Failed to load channels.</p>
              ) : (
                <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                  {channelItems.length === 0 && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No channels found.</p>
                  )}
                  {channelItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onChange({ channelId: item.id })}
                      className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                        item.id === channelId
                          ? 'bg-blue-200 dark:bg-blue-600/30 text-blue-700 dark:text-blue-300'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {item.display}
                    </button>
                  ))}
                </div>
              )}
              {channelId && channels.length > 0 && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                  Selected: <span className="text-slate-700 dark:text-slate-300">{channels.find((c) => c.id === channelId)?.displayName ?? channelId}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}

      {action === 'send_dm' && (
        <div className="space-y-1">
          {!credentialId ? (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">User</label>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Select an account first.</p>
            </div>
          ) : loadingUsers ? (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">User</label>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading users…
              </div>
            </div>
          ) : errorUsers ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  Could not load users. This usually means your Microsoft account needs to be reconnected
                  to grant the <code className="font-mono bg-amber-100 dark:bg-amber-500/20 px-0.5 rounded">User.ReadBasic.All</code> permission.
                  Go to <strong>Credentials</strong> and reconnect your Microsoft account, then try again.
                </p>
              </div>
              <ExpressionInput
                label="User"
                value={String(cfg.userId ?? '')}
                onChange={(v) => onChange({ userId: v })}
                placeholder="User ID or {{nodes.x.userId}}"
                nodes={otherNodes}
                testResults={testResults}
              />
            </div>
          ) : (
          <>
            <Select
              label="User"
              value={String(cfg.userId ?? '')}
              onChange={(e) => onChange({ userId: e.target.value })}
              options={[
                { value: '',       label: '— select user —' },
                { value: '__self__', label: 'Myself' },
                ...userItems.map((u) => ({ value: u.id, label: u.display })),
              ]}
            />
            {String(cfg.userId ?? '') === '__self__' && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                The message will be sent to your own Teams chat (i.e. the account connected above).
              </p>
            )}
          </>
          )}
        </div>
      )}

      {(action === 'send_message' || action === 'send_dm') && (
        <ExpressionTextArea
          label="Message Text"
          value={String(cfg.text ?? '')}
          onChange={(v) => onChange({ text: v })}
          placeholder="Hello from your workflow!"
          nodes={otherNodes}
          testResults={testResults}
          rows={3}
        />
      )}

      {action === 'read_messages' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Message limit</label>
          <input
            type="number"
            min={1}
            max={50}
            value={String(cfg.limit ?? 10)}
            onChange={(e) => onChange({ limit: Number(e.target.value) })}
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {action === 'read_thread' && channelId && (
        <>
          <ExpressionInput
            label="Message ID (thread parent)"
            value={String(cfg.messageId ?? '')}
            onChange={(v) => onChange({ messageId: v })}
            placeholder="Message ID or {{nodes.x.id}}"
            nodes={otherNodes}
            testResults={testResults}
          />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-2">
            The <code className="font-mono bg-slate-100 dark:bg-slate-700 px-0.5 rounded">id</code> of the parent message. Found in the output of a Read Channel Messages node.
          </p>
        </>
      )}
    </div>
  );
}

// ── Basecamp credential helper ──────────────────────────────────────────────

function BasecampCredentialSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: credentials = [], isLoading } = useCredentialList();
  const basecampCreds = credentials.filter((c) => c.provider === 'basecamp');
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Basecamp Account</label>
      {isLoading ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Loading accounts…</p>
      ) : basecampCreds.length === 0 ? (
        <p className="text-[10px] text-amber-400">
          No Basecamp accounts connected. Click <strong>Credentials</strong> in the toolbar to connect one.
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: '— select account —' },
            ...basecampCreds.map((c) => ({ value: c.id, label: c.label })),
          ]}
        />
      )}
    </div>
  );
}

// ── BasecampAssigneePicker ──────────────────────────────────────────────────

function BasecampAssigneePicker({
  people,
  loading,
  hasProject,
  assigneeIds,
  onChange,
  otherNodes,
  testResults,
}: {
  people: Array<{ id: number; name: string; email: string; company: string | null }>;
  loading: boolean;
  hasProject: boolean;
  assigneeIds: string;
  onChange: (ids: string) => void;
  otherNodes: ConfigProps['otherNodes'];
  testResults: ConfigProps['testResults'];
}) {
  const isExprVal = (v: string) => /\{\{/.test(v);
  const [mode, setMode] = useState<'select' | 'expr'>(() => isExprVal(assigneeIds) ? 'expr' : 'select');
  const [filter, setFilter] = useState('');
  const currentIds = assigneeIds.split(',').map((s) => s.trim()).filter(Boolean);
  const selectedCount = currentIds.length;

  if (!hasProject) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Assignees (optional)</label>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Select a project first to see available people.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Assignees (optional)</label>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading people…
        </div>
      </div>
    );
  }

  // No people loaded — always show expression input (no toggle needed)
  if (people.length === 0) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Assignees (optional)</label>
        <ExpressionInput
          value={assigneeIds}
          onChange={onChange}
          placeholder="Comma-separated person IDs or {{nodes.x.assigneeId}}"
          nodes={otherNodes}
          testResults={testResults}
          autoSeparator=", "
        />
      </div>
    );
  }

  const q = filter.toLowerCase();
  const filtered = q
    ? people.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.company ?? '').toLowerCase().includes(q)
      )
    : people;

  const companies = [...new Set(filtered.map((p) => p.company ?? ''))].sort((a, b) =>
    !a ? 1 : !b ? -1 : a.localeCompare(b)
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Assignees (optional)</label>
        <div className="flex items-center gap-2">
          {mode === 'select' && selectedCount > 0 && (
            <span className="text-[10px] text-green-400">{selectedCount} selected</span>
          )}
          {mode === 'select' && selectedCount === 0 && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{people.length} people</span>
          )}
          <button
            type="button"
            onClick={() => {
              const next = mode === 'select' ? 'expr' : 'select';
              setMode(next);
              if (next === 'select') onChange('');
            }}
            className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded transition-colors text-blue-400 hover:text-white hover:bg-blue-700"
            title="Toggle between picking from the list and entering a variable expression"
          >
            <Braces className="w-2.5 h-2.5" />
            {mode === 'select' ? 'Use variable' : 'Select from list'}
          </button>
        </div>
      </div>

      {mode === 'expr' ? (
        <ExpressionInput
          value={assigneeIds}
          onChange={onChange}
          placeholder="{{nodes.x.assigneeId}} or comma-separated IDs"
          nodes={otherNodes}
          testResults={testResults}
          hint="Enter a variable expression or comma-separated Basecamp person IDs."
          autoSeparator=", "
        />
      ) : (
        <>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name, email, or company…"
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 placeholder-slate-500"
          />

          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
            {filtered.length === 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No people match "{filter}"</p>
            )}
            {companies.map((company) => {
              const group = filtered.filter((p) => (p.company ?? '') === company);
              return (
                <div key={company || '__none__'}>
                  {companies.length > 1 && (
                    <div className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-[1]">
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        {company || 'No company'}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-1.5">({group.length})</span>
                    </div>
                  )}
                  {group.map((p) => {
                    const isSelected = currentIds.includes(String(p.id));
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          const next = isSelected
                            ? currentIds.filter((id) => id !== String(p.id))
                            : [...currentIds, String(p.id)];
                          onChange(next.join(','));
                        }}
                        className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors flex items-center gap-2 border-b border-slate-200 dark:border-slate-700/50 last:border-0 ${
                          isSelected ? 'bg-green-600/20 text-green-300' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-green-600 border-green-500' : 'border-slate-500'
                        }`}>
                          {isSelected && <Check className="w-2 h-2 text-gray-900 dark:text-white" />}
                        </span>
                        <span className="truncate">{p.name}</span>
                        {p.email && <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate ml-auto">{p.email}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── BasecampConfig ──────────────────────────────────────────────────────────

function needsTodolistForAction(action: string): boolean {
  return ['create_todo', 'list_todos'].includes(action);
}

function BasecampConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action       = (cfg.action as string) ?? 'create_todo';
  const credentialId = String(cfg.credentialId ?? '');
  const projectId    = String(cfg.projectId ?? '');
  const todolistId   = String(cfg.todolistId ?? '');
  const groupId          = String(cfg.groupId ?? '');
  const includeCompleted = Boolean(cfg.includeCompleted);

  // Detect whether a config value is a variable expression (contains {{ }})
  const isExprVal = (v: string) => /\{\{/.test(v);

  // Mode state: 'select' = pick from list, 'expr' = type / insert variable
  const [projectMode,   setProjectMode]   = useState<'select' | 'expr'>(() => isExprVal(projectId)  ? 'expr' : 'select');
  const [todolistMode,  setTodolistMode]  = useState<'select' | 'expr'>(() => isExprVal(todolistId) ? 'expr' : 'select');

  // When project is an expression, force todolist to expression mode too (no project to query todolists from)
  const effectiveTodolistMode: 'select' | 'expr' = projectMode === 'expr' ? 'expr' : todolistMode;

  // Don't query APIs with expression strings — pass empty string to disable the hooks
  const safeProjectId   = isExprVal(projectId)  ? '' : projectId;
  const safeTodolistId  = isExprVal(todolistId) ? '' : todolistId;

  const { data: projects = [],  isLoading: loadingProjects,  isError: errorProjects }  = useBasecampProjects(credentialId);
  const { data: todolists = [], isLoading: loadingTodolists, isError: errorTodolists } = useBasecampTodolists(credentialId, safeProjectId);
  const { data: todoGroups = [], isLoading: loadingGroups } = useBasecampTodoGroups(
    needsTodolistForAction(action) ? credentialId : '', safeTodolistId
  );
  const todoStatus = action === 'uncomplete_todo' ? 'completed' as const : 'active' as const;
  const { data: todos = [],     isLoading: loadingTodos,     isError: errorTodos }     = useBasecampTodos(
    (action === 'complete_todo' || action === 'uncomplete_todo') ? credentialId : '', safeTodolistId, todoStatus
  );
  const { data: people = [],    isLoading: loadingPeople }    = useBasecampPeople(credentialId, isExprVal(projectId) ? undefined : (projectId || undefined));
  const { data: companies = [], isLoading: loadingCompanies } = useBasecampCompanies(
    (action === 'invite_users' || action === 'remove_user') ? credentialId : ''
  );

  const [companyMode,       setCompanyMode]       = useState<'select' | 'expr'>(() => isExprVal(String(cfg.inviteCompany  ?? '')) ? 'expr' : 'select');
  const [removeCompanyMode, setRemoveCompanyMode] = useState<'select' | 'expr'>(() => isExprVal(String(cfg.removeCompany  ?? '')) ? 'expr' : 'select');

  const needsProject  = ['create_todo', 'post_message', 'send_campfire', 'list_todos', 'invite_users'].includes(action);
  const needsTodolist = ['create_todo', 'list_todos'].includes(action);

  return (
    <div className="space-y-3">
      <BasecampCredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id, projectId: '', todolistId: '', groupId: '', todoId: '' })}
      />

      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value, projectId: '', todolistId: '', groupId: '', todoId: '' })}
        options={[
          { value: 'create_todo',     label: 'Create To-Do' },
          { value: 'complete_todo',   label: 'Complete a To-Do' },
          { value: 'uncomplete_todo', label: 'Re-Open a To-Do' },
          { value: 'post_message',    label: 'Post Message' },
          { value: 'post_comment',    label: 'Post Comment' },
          { value: 'send_campfire',   label: 'Send Campfire Message' },
          { value: 'list_todos',      label: 'List To-Dos' },
          { value: 'invite_users',       label: 'Invite User to Organization' },
          { value: 'remove_user',        label: 'Remove User from Organization' },
          { value: 'list_organizations', label: 'List Organizations' },
        ]}
      />

      {/* ── Project picker (cascading, supports variables) ─────────────── */}
      {needsProject && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              Project{action === 'invite_users' && <span className="text-slate-600 font-normal"> (optional)</span>}
            </span>
            <div className="flex items-center gap-1">
              {action === 'invite_users' && projectId && (
                <button
                  type="button"
                  onClick={() => onChange({ projectId: '', todolistId: '', groupId: '', todoId: '' })}
                  className="text-[9px] px-1.5 py-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-600 transition-colors"
                  title="Clear selection — a project will be auto-picked at run time"
                >
                  Clear
                </button>
              )}
              {credentialId && (
                <button
                  type="button"
                  onClick={() => {
                    const next = projectMode === 'select' ? 'expr' : 'select';
                    setProjectMode(next);
                    if (next === 'select') onChange({ projectId: '', todolistId: '', groupId: '', todoId: '' });
                  }}
                  className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded transition-colors text-blue-400 hover:text-white hover:bg-blue-700"
                  title="Toggle between picking from the list and entering a variable expression"
                >
                  <Braces className="w-2.5 h-2.5" />
                  {projectMode === 'select' ? 'Use variable' : 'Select from list'}
                </button>
              )}
            </div>
          </div>

          {!credentialId ? (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Select an account first.</p>
          ) : projectMode === 'expr' ? (
            <ExpressionInput
              value={projectId}
              onChange={(v) => onChange({ projectId: v })}
              placeholder="{{nodes.trigger.items[0].projectId}}"
              nodes={otherNodes}
              testResults={testResults}
              hint="Enter a Basecamp project ID directly or insert a variable expression."
            />
          ) : loadingProjects ? (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading projects…
            </div>
          ) : errorProjects ? (
            <p className="text-[10px] text-red-400">Failed to load projects.</p>
          ) : (
            <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {projects.length === 0 && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No projects found.</p>
              )}
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChange({ projectId: String(p.id), todolistId: '', groupId: '', todoId: '' })}
                  className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                    String(p.id) === projectId
                      ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {projectMode === 'select' && projectId && projects.length > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              Selected: <span className="text-slate-700 dark:text-slate-300">{projects.find((p) => String(p.id) === projectId)?.name ?? projectId}</span>
            </p>
          )}
          {action === 'invite_users' && !projectId && projectMode === 'select' && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
              Leave blank to mirror the Basecamp website's "Invite a teammate" flow — a project will be auto-picked just to satisfy Basecamp's API requirement.
            </p>
          )}
        </div>
      )}

      {/* ── To-do list picker (cascading from project, supports variables) ─ */}
      {needsTodolist && (effectiveTodolistMode === 'expr' || safeProjectId) && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">To-Do List</span>
            {/* Only show mode toggle when project is not already an expression */}
            {credentialId && projectMode !== 'expr' && (
              <button
                type="button"
                onClick={() => {
                  const next = todolistMode === 'select' ? 'expr' : 'select';
                  setTodolistMode(next);
                  if (next === 'select') onChange({ todolistId: '', groupId: '', todoId: '' });
                }}
                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded transition-colors text-blue-400 hover:text-white hover:bg-blue-700"
                title="Toggle between picking from the list and entering a variable expression"
              >
                <Braces className="w-2.5 h-2.5" />
                {todolistMode === 'select' ? 'Use variable' : 'Select from list'}
              </button>
            )}
          </div>

          {effectiveTodolistMode === 'expr' ? (
            <>
              {projectMode === 'expr' && (
                <p className="text-[10px] text-amber-400/80">
                  Project is a variable — enter the to-do list ID as a variable too.
                </p>
              )}
              <ExpressionInput
                value={todolistId}
                onChange={(v) => onChange({ todolistId: v, groupId: '', todoId: '' })}
                placeholder="{{nodes.trigger.items[0].todolistId}}"
                nodes={otherNodes}
                testResults={testResults}
                hint="Enter a Basecamp to-do list ID directly or insert a variable expression."
              />
            </>
          ) : loadingTodolists ? (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading to-do lists…
            </div>
          ) : errorTodolists ? (
            <p className="text-[10px] text-red-400">Failed to load to-do lists.</p>
          ) : (
            <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {todolists.length === 0 && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No to-do lists found.</p>
              )}
              {todolists.map((tl) => (
                <button
                  key={tl.id}
                  type="button"
                  onClick={() => onChange({ todolistId: String(tl.id), groupId: '', todoId: '' })}
                  className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                    String(tl.id) === todolistId
                      ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tl.name}
                  {tl.todosRemaining > 0 && (
                    <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500">({tl.todosRemaining} remaining)</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {effectiveTodolistMode === 'select' && todolistId && todolists.length > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              Selected: <span className="text-slate-700 dark:text-slate-300">{todolists.find((tl) => String(tl.id) === todolistId)?.name ?? todolistId}</span>
            </p>
          )}
        </div>
      )}

      {/* ── Group (section) picker (optional, cascading from todolist) ── */}
      {needsTodolist && todolistId && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Group / Section <span className="text-slate-600">(optional)</span>
          </label>
          {loadingGroups && <p className="text-xs text-slate-400 dark:text-slate-500 italic">Loading groups…</p>}
          {!loadingGroups && todoGroups.length === 0 && (
            <p className="text-[10px] text-slate-600 italic">No groups in this to-do list (all to-dos are ungrouped)</p>
          )}
          {!loadingGroups && todoGroups.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              <button
                type="button"
                onClick={() => onChange({ groupId: '' })}
                className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                  !groupId
                    ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                (Ungrouped / Top-level)
              </button>
              {todoGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChange({ groupId: String(g.id) })}
                  className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                    String(g.id) === groupId
                      ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          {groupId && todoGroups.length > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              Selected: <span className="text-slate-700 dark:text-slate-300">{todoGroups.find((g) => String(g.id) === groupId)?.name ?? groupId}</span>
            </p>
          )}
        </div>
      )}

      {/* ── create_todo fields ────────────────────────────────────────── */}
      {action === 'create_todo' && (
        <>
          <ExpressionInput
            label="To-Do Title"
            value={String(cfg.content ?? '')}
            onChange={(v) => onChange({ content: v })}
            placeholder="What needs to be done?"
            nodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionTextArea
            label="Description (optional, supports HTML)"
            value={String(cfg.description ?? '')}
            onChange={(v) => onChange({ description: v })}
            placeholder="Additional details…"
            nodes={otherNodes}
            testResults={testResults}
            rows={4}
            resizable
          />
          <ExpressionInput
            label="Due Date (optional, YYYY-MM-DD)"
            value={String(cfg.dueOn ?? '')}
            onChange={(v) => onChange({ dueOn: v })}
            placeholder="2026-04-15"
            nodes={otherNodes}
            testResults={testResults}
          />
          {/* Assignees multi-select */}
          <BasecampAssigneePicker
            people={people}
            loading={loadingPeople}
            hasProject={!!projectId}
            assigneeIds={String(cfg.assigneeIds ?? '')}
            onChange={(ids) => onChange({ assigneeIds: ids })}
            otherNodes={otherNodes}
            testResults={testResults}
          />
          {/* File attachment (from a GDrive download node) */}
          <div className="space-y-2 pt-1">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">File Attachment (optional)</p>
            <ExpressionInput
              label="File Content (base64)"
              value={String(cfg.attachmentContent ?? '')}
              onChange={(v) => onChange({ attachmentContent: v })}
              placeholder="{{nodes.<gdrive-node>.content}}"
              nodes={otherNodes}
              testResults={testResults}
              hint="Connect a Google Drive download node and reference its 'content' output here."
            />
            <ExpressionInput
              label="File Name"
              value={String(cfg.attachmentName ?? '')}
              onChange={(v) => onChange({ attachmentName: v })}
              placeholder="{{nodes.<gdrive-node>.name}}"
              nodes={otherNodes}
              testResults={testResults}
            />
            <ExpressionInput
              label="MIME Type"
              value={String(cfg.attachmentMimeType ?? '')}
              onChange={(v) => onChange({ attachmentMimeType: v })}
              placeholder="{{nodes.<gdrive-node>.mimeType}}"
              nodes={otherNodes}
              testResults={testResults}
            />
          </div>
        </>
      )}

      {/* ── complete_todo / uncomplete_todo fields ──────────────────────── */}
      {(action === 'complete_todo' || action === 'uncomplete_todo') && (
        <>
          {/* Optional: pick from a list if project + todolist are set */}
          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Project (optional, to browse to-dos)</span>
              {!credentialId ? (
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Select an account first.</p>
              ) : loadingProjects ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </div>
              ) : (
                <Select
                  value={projectId}
                  onChange={(e) => onChange({ projectId: e.target.value, todolistId: '', todoId: '' })}
                  options={[
                    { value: '', label: '— select project —' },
                    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                />
              )}
          </div>

          {projectId && (
            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">To-Do List (optional)</span>
              {loadingTodolists ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </div>
              ) : (
                <Select
                  value={todolistId}
                  onChange={(e) => onChange({ todolistId: e.target.value, todoId: '' })}
                  options={[
                    { value: '', label: '— select to-do list —' },
                    ...todolists.map((tl) => ({ value: String(tl.id), label: tl.name })),
                  ]}
                />
              )}
            </div>
          )}

          {todolistId && (
            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                To-Do {todos.length > 0 && (
                  <span className="text-slate-600 font-normal">
                    ({todos.length} {action === 'uncomplete_todo' ? 'completed' : 'active'})
                  </span>
                )}
              </span>
              {loadingTodos ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading {action === 'uncomplete_todo' ? 'completed' : 'active'} to-dos…
                </div>
              ) : errorTodos ? (
                <p className="text-[10px] text-red-400">Failed to load to-dos.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                  {todos.length === 0 && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No to-dos found.</p>
                  )}
                  {(() => {
                    const ungrouped = todos.filter((t) => !t.groupName);
                    const grouped = todos.filter((t) => !!t.groupName);
                    const groupNames = [...new Set(grouped.map((t) => t.groupName!))];
                    return (
                      <>
                        {ungrouped.length > 0 && groupNames.length > 0 && (
                          <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/50 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50">
                            Ungrouped
                          </div>
                        )}
                        {ungrouped.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onChange({ todoId: String(t.id) })}
                            className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors flex items-center gap-1.5 ${
                              String(t.id) === String(cfg.todoId ?? '')
                                ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                                : t.completed ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            <span className={`inline-block w-2.5 h-2.5 rounded-sm border flex-shrink-0 ${t.completed ? 'bg-green-600/60 border-green-600' : 'border-slate-500'}`} />
                            <span className={t.completed ? 'line-through' : ''}>{t.title}</span>
                          </button>
                        ))}
                        {groupNames.map((gn) => (
                          <div key={gn}>
                            <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/50 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50">
                              {gn}
                            </div>
                            {grouped.filter((t) => t.groupName === gn).map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => onChange({ todoId: String(t.id) })}
                                className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors pl-4 flex items-center gap-1.5 ${
                                  String(t.id) === String(cfg.todoId ?? '')
                                    ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                                    : t.completed ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                              >
                                <span className={`inline-block w-2.5 h-2.5 rounded-sm border flex-shrink-0 ${t.completed ? 'bg-green-600/60 border-green-600' : 'border-slate-500'}`} />
                                <span className={t.completed ? 'line-through' : ''}>{t.title}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          <ExpressionInput
            label="To-Do ID"
            value={String(cfg.todoId ?? '')}
            onChange={(v) => onChange({ todoId: v })}
            placeholder="Basecamp to-do ID or pick from list above"
            nodes={otherNodes}
            testResults={testResults}
            hint="You can type a to-do ID directly or pick one from the list above."
          />
        </>
      )}

      {/* ── post_message fields ───────────────────────────────────────── */}
      {action === 'post_message' && (
        <>
          <ExpressionInput
            label="Subject"
            value={String(cfg.subject ?? '')}
            onChange={(v) => onChange({ subject: v })}
            placeholder="Message subject"
            nodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionTextArea
            label="Content (supports HTML)"
            value={String(cfg.text ?? '')}
            onChange={(v) => onChange({ text: v })}
            placeholder="Your message content…"
            nodes={otherNodes}
            testResults={testResults}
            rows={4}
          />
        </>
      )}

      {/* ── post_comment fields ───────────────────────────────────────── */}
      {action === 'post_comment' && (
        <>
          <ExpressionInput
            label="Recording ID"
            value={String(cfg.recordingId ?? '')}
            onChange={(v) => onChange({ recordingId: v })}
            placeholder="Basecamp recording ID (to-do, message, etc.)"
            nodes={otherNodes}
            testResults={testResults}
            hint="The ID of the to-do, message, or other item you want to comment on."
          />
          <ExpressionTextArea
            label="Comment (supports HTML)"
            value={String(cfg.text ?? '')}
            onChange={(v) => onChange({ text: v })}
            placeholder="Your comment…"
            nodes={otherNodes}
            testResults={testResults}
            rows={3}
          />
        </>
      )}

      {/* ── send_campfire fields ──────────────────────────────────────── */}
      {action === 'send_campfire' && (
        <ExpressionTextArea
          label="Message"
          value={String(cfg.text ?? '')}
          onChange={(v) => onChange({ text: v })}
          placeholder="Your Campfire message…"
          nodes={otherNodes}
          testResults={testResults}
          rows={3}
        />
      )}

      {/* ── list_todos fields ─────────────────────────────────────────── */}
      {action === 'list_todos' && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="basecamp-include-completed"
            checked={includeCompleted}
            onChange={(e) => onChange({ includeCompleted: e.target.checked })}
            className="w-3.5 h-3.5 rounded"
          />
          <label htmlFor="basecamp-include-completed" className="text-xs text-slate-500 dark:text-slate-400">
            Include completed to-dos (including hidden)
          </label>
        </div>
      )}

      {/* ── remove_user fields ────────────────────────────────────────── */}
      {action === 'remove_user' && (
        <>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            Permanently removes the person from your Basecamp account. Requires admin privileges. The user is looked up by email address; provide a Company to disambiguate if needed.
          </p>
          <ExpressionInput
            label="Email Address"
            value={String(cfg.removeEmail ?? '')}
            onChange={(v) => onChange({ removeEmail: v })}
            placeholder="jane@example.com"
            nodes={otherNodes}
            testResults={testResults}
            hint="The email address of the person to remove from your Basecamp account."
          />

          {/* Company — dropdown from account with variable fallback */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                Company <span className="text-slate-600 font-normal">(optional, to disambiguate)</span>
              </span>
              {credentialId && (
                <button
                  type="button"
                  onClick={() => {
                    const next = removeCompanyMode === 'select' ? 'expr' : 'select';
                    setRemoveCompanyMode(next);
                    if (next === 'select') onChange({ removeCompany: '' });
                  }}
                  className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded transition-colors text-blue-400 hover:text-white hover:bg-blue-700"
                  title="Toggle between picking from the list and entering a variable expression"
                >
                  <Braces className="w-2.5 h-2.5" />
                  {removeCompanyMode === 'select' ? 'Use variable' : 'Select from list'}
                </button>
              )}
            </div>
            {removeCompanyMode === 'expr' ? (
              <ExpressionInput
                value={String(cfg.removeCompany ?? '')}
                onChange={(v) => onChange({ removeCompany: v })}
                placeholder="{{nodes.trigger.items[0].company}}"
                nodes={otherNodes}
                testResults={testResults}
                hint="Enter a company name directly or insert a variable expression."
              />
            ) : loadingCompanies ? (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading companies…
              </div>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                <button
                  type="button"
                  onClick={() => onChange({ removeCompany: '' })}
                  className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                    !cfg.removeCompany
                      ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                      : 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  (any company)
                </button>
                {companies.length === 0 && (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No companies found in this account.</p>
                )}
                {companies.map((co) => (
                  <button
                    key={co.id}
                    type="button"
                    onClick={() => onChange({ removeCompany: co.name })}
                    className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                      cfg.removeCompany === co.name
                        ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {co.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── list_organizations fields ─────────────────────────────────── */}
      {action === 'list_organizations' && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          Returns all unique organizations (companies) found across everyone in your Basecamp account. Use the output <code className="font-mono bg-slate-100 dark:bg-slate-800 px-0.5 rounded">organizations</code> array in downstream nodes.
        </p>
      )}

      {/* ── invite_users fields ───────────────────────────────────────── */}
      {action === 'invite_users' && (
        <>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Sends an invitation to the specified address. Basecamp's public API has no organization-only invite endpoint — under the hood the person must be added via a project, but you can leave the Project field blank above and we'll pick one for you (matching the Basecamp website's "Invite a teammate" behavior). If the person is already in the org, they'll simply be granted access. If they were previously removed from the org, a fresh invitation is issued automatically (status: <code className="font-mono bg-slate-100 dark:bg-slate-800 px-0.5 rounded">reinvited</code>). Requires admin privileges.
          </p>
          <ExpressionInput
            label="Email Address"
            value={String(cfg.inviteEmail ?? '')}
            onChange={(v) => onChange({ inviteEmail: v })}
            placeholder="jane@example.com"
            nodes={otherNodes}
            testResults={testResults}
            hint="The email address of the person to invite to the project (and your Basecamp account)."
          />
          <ExpressionInput
            label="Name"
            value={String(cfg.inviteName ?? '')}
            onChange={(v) => onChange({ inviteName: v })}
            placeholder="Jane Smith"
            nodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionInput
            label="Job Title (optional)"
            value={String(cfg.inviteTitle ?? '')}
            onChange={(v) => onChange({ inviteTitle: v })}
            placeholder="Designer"
            nodes={otherNodes}
            testResults={testResults}
          />
          {/* Company Name — dropdown from account, with variable fallback */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                Company Name <span className="text-slate-600 font-normal">(optional)</span>
              </span>
              {credentialId && (
                <button
                  type="button"
                  onClick={() => {
                    const next = companyMode === 'select' ? 'expr' : 'select';
                    setCompanyMode(next);
                    if (next === 'select') onChange({ inviteCompany: '' });
                  }}
                  className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded transition-colors text-blue-400 hover:text-white hover:bg-blue-700"
                  title="Toggle between picking from the list and entering a variable expression"
                >
                  <Braces className="w-2.5 h-2.5" />
                  {companyMode === 'select' ? 'Use variable' : 'Select from list'}
                </button>
              )}
            </div>
            {companyMode === 'expr' ? (
              <ExpressionInput
                value={String(cfg.inviteCompany ?? '')}
                onChange={(v) => onChange({ inviteCompany: v })}
                placeholder="{{nodes.trigger.items[0].company}}"
                nodes={otherNodes}
                testResults={testResults}
                hint="Enter a company name directly or insert a variable expression."
              />
            ) : loadingCompanies ? (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading companies…
              </div>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                <button
                  type="button"
                  onClick={() => onChange({ inviteCompany: '' })}
                  className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                    !cfg.inviteCompany
                      ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                      : 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  (none)
                </button>
                {companies.length === 0 && (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No companies found in this account.</p>
                )}
                {companies.map((co) => (
                  <button
                    key={co.id}
                    type="button"
                    onClick={() => onChange({ inviteCompany: co.name })}
                    className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                      cfg.inviteCompany === co.name
                        ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {co.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── TriggerConfig ────────────────────────────────────────────────────────────

const TRIGGER_TYPE_OPTIONS = [
  { value: 'manual',    label: 'Manual' },
  { value: 'webhook',   label: 'Webhook' },
  { value: 'cron',      label: 'Schedule / Cron' },
  { value: 'app_event', label: 'App Event' },
];

const WEBHOOK_METHOD_OPTIONS = ['POST', 'GET', 'PUT'].map((m) => ({ value: m, label: m }));

const APP_EVENT_APP_OPTIONS = [
  { value: '',        label: 'Select an app…' },
  { value: 'basecamp', label: 'Basecamp' },
  { value: 'gdrive',  label: 'Google Drive' },
  { value: 'gsheets', label: 'Google Sheets' },
  { value: 'slack',   label: 'Slack' },
  { value: 'teams',   label: 'Microsoft Teams' },
  { value: 'gmail',   label: 'Gmail' },
];

const APP_EVENT_TYPE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  basecamp: [
    { value: '',               label: 'Select an event…' },
    { value: 'new_todo',       label: 'New To-Do created' },
    { value: 'new_message',    label: 'New Message posted' },
    { value: 'new_comment',    label: 'New Comment posted' },
    { value: 'todo_completed', label: 'To-Do completed' },
  ],
  gdrive: [
    { value: '',               label: 'Select an event…' },
    { value: 'file_changed',   label: 'On changes to a specific file' },
    { value: 'folder_changed', label: 'On changes involving a specific folder' },
  ],
  gsheets: [
    { value: '',                    label: 'Select an event…' },
    { value: 'row_added',           label: 'On row added' },
    { value: 'row_updated',         label: 'On row updated' },
    { value: 'row_added_or_updated', label: 'On row added or updated' },
  ],
  slack: [
    { value: '',                   label: 'Select an event…' },
    { value: 'any_event',          label: 'On any event' },
    { value: 'app_mention',        label: 'On bot app mention' },
    { value: 'file_public',        label: 'On file made public' },
    { value: 'file_shared',        label: 'On file shared' },
    { value: 'new_message',        label: 'On new message posted to channel' },
    { value: 'new_public_channel', label: 'On new public channel created' },
    { value: 'new_user',           label: 'On new user' },
    { value: 'reaction_added',     label: 'On reaction added' },
  ],
  teams: [
    { value: '',                  label: 'Select an event…' },
    { value: 'new_channel',       label: 'On new channel' },
    { value: 'new_channel_message', label: 'On new channel message' },
    { value: 'new_chat',          label: 'On new chat' },
    { value: 'new_chat_message',  label: 'On new chat message' },
    { value: 'new_team_member',   label: 'On new team member' },
  ],
  gmail: [
    { value: '',          label: 'Select an event…' },
    { value: 'new_email', label: 'New email received' },
  ],
};

const CRON_PRESETS = [
  { value: '',                 label: 'Choose a preset…' },
  { value: '* * * * *',       label: 'Every minute' },
  { value: '*/5 * * * *',     label: 'Every 5 minutes' },
  { value: '*/15 * * * *',    label: 'Every 15 minutes' },
  { value: '0 * * * *',       label: 'Every hour' },
  { value: '0 0 * * *',       label: 'Every day at midnight' },
  { value: '0 9 * * *',       label: 'Every day at 9:00 AM' },
  { value: '0 9 * * 1-5',     label: 'Every weekday at 9 AM' },
  { value: '0 9 * * 1',       label: 'Every Monday at 9 AM' },
  { value: '0 0 1 * *',       label: 'First of month at midnight' },
];


function describeCron(expr: string): string {
  const preset = CRON_PRESETS.find((p) => p.value === expr);
  return preset?.label ?? '';
}

function TriggerConfig({
  cfg,
  onChange,
  workflowId,
  nodeId,
  otherNodes,
  testResults,
}: ConfigProps & { workflowId: string; nodeId: string }) {
  const triggerType   = (cfg.triggerType   as string) || 'manual';
  const appType       = (cfg.appType       as string) || '';
  const credentialId  = (cfg.credentialId  as string) || '';
  const eventType     = (cfg.eventType     as string) || '';
  const spreadsheetId = (cfg.spreadsheetId as string) || '';
  const teamId        = (cfg.teamId        as string) || '';
  const projectId     = (cfg.projectId     as string) || '';
  const todolistId    = (cfg.todolistId    as string) || '';

  const credentials = useCredentialList();

  // Data hooks — always called (hooks can't be conditional), but each
  // passes '' when not applicable so React Query keeps them disabled.
  const slackChs    = useSlackChannels(appType === 'slack'     ? credentialId : '');
  const teamsTeams  = useTeamsTeams   (appType === 'teams'     ? credentialId : '');
  const teamsChans  = useTeamsChannels(appType === 'teams'     ? credentialId : '', teamId);
  const gsheetsTabs = useGSheetsSheets(appType === 'gsheets'   ? credentialId : '', spreadsheetId);
  const bcProjects  = useBasecampProjects (appType === 'basecamp' ? credentialId : '');
  const bcTodolists = useBasecampTodolists(appType === 'basecamp' ? credentialId : '', projectId);

  const baseUrl    = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = workflowId && nodeId ? `${baseUrl}/webhooks/${workflowId}/trigger/${nodeId}` : '';
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const credentialOptions = (provider: string) => {
    const filtered = (credentials.data ?? []).filter((c) => {
      if (provider === 'gmail' || provider === 'gdrive' || provider === 'gsheets') return c.provider === 'google';
      return c.provider === provider;
    });
    return [
      { value: '', label: 'Select credential…' },
      ...filtered.map((c) => ({ value: c.id, label: c.label || c.provider })),
    ];
  };

  const inputCls = 'w-full rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs text-gray-900 dark:text-white placeholder-slate-500';
  const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400';
  const hintCls  = 'text-[10px] text-slate-400 dark:text-slate-500';

  const resetAppFields = {
    eventType: '', credentialId: '', fileId: '', fileIdPath: '', folderId: '', folderIdPath: '',
    spreadsheetId: '', spreadsheetPath: '', spreadsheetName: '', owner: '', searchFolderId: '',
    searchFolderPath: '', sheetName: '', teamId: '', channelId: '', slackChannelId: '',
    projectId: '', todolistId: '',
  };
  const resetCredFields = {
    eventType: '', fileId: '', fileIdPath: '', folderId: '', folderIdPath: '',
    spreadsheetId: '', spreadsheetPath: '', spreadsheetName: '', owner: '', searchFolderId: '',
    searchFolderPath: '', sheetName: '', teamId: '', channelId: '', slackChannelId: '',
    projectId: '', todolistId: '',
  };
  const resetEventFields = {
    fileId: '', fileIdPath: '', folderId: '', folderIdPath: '',
    spreadsheetId: '', spreadsheetPath: '', spreadsheetName: '', owner: '', searchFolderId: '',
    searchFolderPath: '', sheetName: '', teamId: '', channelId: '', slackChannelId: '',
    projectId: '', todolistId: '',
  };

  // Shared: Teams team button-list item row
  const teamsTeamItems  = teamsTeams.teams.map((t) => ({ id: t.id, display: t.displayName }));
  const teamsChanItems  = teamsChans.channels.map((c) => ({
    id: c.id,
    display: c.membershipType === 'private' ? `🔒 ${c.displayName}` : c.displayName,
  }));
  const slackChanItems  = slackChs.channels.map((c) => ({
    id: c.id,
    display: c.isPrivate ? `🔒 ${c.name}` : `#${c.name}`,
  }));

  return (
    <div className="space-y-3">
      <Select
        label="Trigger Type"
        value={triggerType}
        onChange={(e) => onChange({ triggerType: e.target.value })}
        options={TRIGGER_TYPE_OPTIONS}
      />

      {/* ── Manual ── */}
      {triggerType === 'manual' && (
        <div className="bg-slate-100 dark:bg-slate-800/50 rounded-lg p-3 space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Click <span className="font-semibold text-purple-400">Run</span> or use the{' '}
            <span className="font-semibold text-purple-400">Test This Node</span> button to trigger this workflow manually.
          </p>
        </div>
      )}

      {/* ── Webhook ── */}
      {triggerType === 'webhook' && (
        <div className="space-y-3">
          <Select label="HTTP Method" value={(cfg.webhookMethod as string) || 'POST'} onChange={(e) => onChange({ webhookMethod: e.target.value })} options={WEBHOOK_METHOD_OPTIONS} />
          <div className="space-y-1">
            <label className={labelCls}>Webhook URL</label>
            <div className="flex items-center gap-1.5">
              <input type="text" readOnly value={webhookUrl || 'Save workflow first to generate URL'} className="flex-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 font-mono select-all" />
              {webhookUrl && (
                <button type="button" className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                  onClick={() => { navigator.clipboard.writeText(webhookUrl); setCopiedWebhook(true); setTimeout(() => setCopiedWebhook(false), 2000); }}>
                  {copiedWebhook ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                </button>
              )}
            </div>
            {webhookUrl && <p className={hintCls}>Send a {(cfg.webhookMethod as string) || 'POST'} request to this URL to trigger the workflow.</p>}
          </div>
        </div>
      )}

      {/* ── Cron / Schedule ── */}
      {triggerType === 'cron' && (
        <div className="space-y-3">
          <Select label="Preset" value="" onChange={(e) => { if (e.target.value) onChange({ cronExpression: e.target.value }); }} options={CRON_PRESETS} />
          <div className="space-y-1">
            <label className={labelCls}>Cron Expression</label>
            <input type="text" value={(cfg.cronExpression as string) || ''} onChange={(e) => onChange({ cronExpression: e.target.value })} placeholder="* * * * *" className={`${inputCls} font-mono`} />
            {Boolean(cfg.cronExpression) && <p className={hintCls}>{describeCron(cfg.cronExpression as string) || 'Custom expression'}</p>}
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Timezone (optional)</label>
            <input type="text" value={(cfg.cronTimezone as string) || ''} onChange={(e) => onChange({ cronTimezone: e.target.value })} placeholder="e.g. America/New_York" className={inputCls} />
          </div>
        </div>
      )}

      {/* ── App Event ── */}
      {triggerType === 'app_event' && (
        <div className="space-y-3">

          {/* Step 1 — App */}
          <Select label="App" value={appType}
            onChange={(e) => onChange({ appType: e.target.value, ...resetAppFields })}
            options={APP_EVENT_APP_OPTIONS}
          />

          {/* Step 2 — Credential (shown as soon as app is chosen) */}
          {Boolean(appType) && (
            <Select label="Credential" value={credentialId}
              onChange={(e) => onChange({ credentialId: e.target.value, ...resetCredFields })}
              options={credentialOptions(appType)}
            />
          )}

          {/* Step 3 — Event (shown after credential is chosen) */}
          {Boolean(appType) && Boolean(credentialId) && (
            <Select label="Event" value={eventType}
              onChange={(e) => onChange({ eventType: e.target.value, ...resetEventFields })}
              options={APP_EVENT_TYPE_OPTIONS[appType] ?? [{ value: '', label: 'Select an event…' }]}
            />
          )}

          {/* Step 4 — App-specific extra fields (shown after event is chosen) */}
          {Boolean(appType) && Boolean(credentialId) && Boolean(eventType) && (
            <>

              {/* ── Google Drive — navigable folder/file browser ── */}
              {appType === 'gdrive' && eventType === 'file_changed' && (
                <GDriveFolderBrowser
                  credentialId={credentialId}
                  value={String(cfg.fileId ?? '')}
                  valuePath={String(cfg.fileIdPath ?? '')}
                  onChange={(id, path) => onChange({ fileId: id, fileIdPath: path })}
                  label="File to watch"
                  placeholder="Browse and select a file"
                  foldersOnly={false}
                />
              )}

              {appType === 'gdrive' && eventType === 'folder_changed' && (
                <GDriveFolderBrowser
                  credentialId={credentialId}
                  value={String(cfg.folderId ?? '')}
                  valuePath={String(cfg.folderIdPath ?? '')}
                  onChange={(id, path) => onChange({ folderId: id, folderIdPath: path })}
                  label="Folder to watch"
                  placeholder="Browse and select a folder"
                  foldersOnly={true}
                />
              )}

              {/* ── Google Sheets — spreadsheet browser + sheet tab picker ── */}
              {appType === 'gsheets' && (
                <>
                  <GSheetsSpreadsheetPicker
                    cfg={cfg}
                    onChange={onChange}
                    label="Spreadsheet"
                    otherNodes={otherNodes}
                    testResults={testResults}
                  />

                  {Boolean(spreadsheetId) && (
                    <div className="space-y-1">
                      <span className={labelCls}>Sheet Tab <span className="font-normal text-slate-400">(optional)</span></span>
                      {gsheetsTabs.isLoading ? (
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Loading sheets…
                        </div>
                      ) : gsheetsTabs.isError ? (
                        <p className="text-[10px] text-red-400">Failed to load sheet tabs.</p>
                      ) : (
                        <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                          {[{ id: '', display: 'First / all sheets' }, ...gsheetsTabs.sheets.map((s) => ({ id: s.title, display: s.title }))].map((item) => (
                            <button key={item.id} type="button"
                              onClick={() => onChange({ sheetName: item.id })}
                              className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                                (cfg.sheetName ?? '') === item.id
                                  ? 'bg-blue-200 dark:bg-blue-600/30 text-blue-700 dark:text-blue-300'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                              }`}>{item.display}</button>
                          ))}
                        </div>
                      )}
                      {Boolean(cfg.sheetName) && (
                        <p className={hintCls}>Selected tab: <span className="text-slate-700 dark:text-slate-300">{String(cfg.sheetName)}</span></p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ── Microsoft Teams — team picker (button list) ── */}
              {appType === 'teams' && (eventType === 'new_channel' || eventType === 'new_channel_message' || eventType === 'new_team_member') && (
                <div className="space-y-1">
                  <span className={labelCls}>Team <span className="font-normal text-slate-400">(optional — leave blank to watch all teams)</span></span>
                  {teamsTeams.isLoading ? (
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading teams…
                    </div>
                  ) : teamsTeams.isError ? (
                    <p className="text-[10px] text-red-400">Failed to load teams.</p>
                  ) : (
                    <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                      {[{ id: '', display: 'All joined teams' }, ...teamsTeamItems].map((item) => (
                        <button key={item.id} type="button"
                          onClick={() => onChange({ teamId: item.id, channelId: '' })}
                          className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                            teamId === item.id
                              ? 'bg-blue-200 dark:bg-blue-600/30 text-blue-700 dark:text-blue-300'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}>{item.display}</button>
                      ))}
                    </div>
                  )}
                  {teamId && <p className={hintCls}>Selected: <span className="text-slate-700 dark:text-slate-300">{teamsTeams.teams.find((t) => t.id === teamId)?.displayName ?? teamId}</span></p>}
                </div>
              )}

              {/* ── Microsoft Teams — channel picker (button list, only when team is set) ── */}
              {appType === 'teams' && eventType === 'new_channel_message' && Boolean(teamId) && (
                <div className="space-y-1">
                  <span className={labelCls}>Channel</span>
                  {teamsChans.isLoading ? (
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading channels…
                    </div>
                  ) : teamsChans.isError ? (
                    <p className="text-[10px] text-red-400">Failed to load channels.</p>
                  ) : (
                    <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                      {teamsChanItems.length === 0 && <p className="text-[10px] text-slate-400 px-2.5 py-2">No channels found.</p>}
                      {teamsChanItems.map((item) => (
                        <button key={item.id} type="button"
                          onClick={() => onChange({ channelId: item.id })}
                          className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                            (cfg.channelId ?? '') === item.id
                              ? 'bg-blue-200 dark:bg-blue-600/30 text-blue-700 dark:text-blue-300'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}>{item.display}</button>
                      ))}
                    </div>
                  )}
                  {Boolean(cfg.channelId) && <p className={hintCls}>Selected: <span className="text-slate-700 dark:text-slate-300">{teamsChans.channels.find((c) => c.id === String(cfg.channelId))?.displayName ?? String(cfg.channelId)}</span></p>}
                </div>
              )}

              {/* ── Slack — channel picker (SlackResourceSelect, searchable) ── */}
              {appType === 'slack' && (eventType === 'new_message' || eventType === 'any_event' || eventType === 'app_mention' || eventType === 'reaction_added') && (
                <SlackResourceSelect
                  label="Channel (optional — leave blank to watch all)"
                  value={(cfg.slackChannelId as string) || ''}
                  onChange={(v) => onChange({ slackChannelId: v })}
                  items={slackChanItems}
                  isLoading={slackChs.isLoading}
                  isError={slackChs.isError}
                  placeholder="Leave blank or enter channel ID"
                  renderItem={(item) => item.display}
                  hasCredential={Boolean(credentialId)}
                  otherNodes={otherNodes}
                  testResults={testResults}
                />
              )}

              {/* ── Basecamp — project + to-do list pickers ── */}
              {appType === 'basecamp' && (
                <>
                  {/* Project picker — always shown for Basecamp events */}
                  <div className="space-y-1">
                    <span className={labelCls}>Project</span>
                    {bcProjects.isLoading ? (
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading projects…
                      </div>
                    ) : bcProjects.isError ? (
                      <p className="text-[10px] text-red-400">Failed to load projects.</p>
                    ) : (
                      <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                        {(bcProjects.data ?? []).length === 0 && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No projects found.</p>
                        )}
                        {(bcProjects.data ?? []).map((p) => (
                          <button key={p.id} type="button"
                            onClick={() => onChange({ projectId: String(p.id), todolistId: '' })}
                            className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                              String(p.id) === projectId
                                ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {Boolean(projectId) && (bcProjects.data ?? []).length > 0 && (
                      <p className={hintCls}>Selected: <span className="text-slate-700 dark:text-slate-300">{(bcProjects.data ?? []).find((p) => String(p.id) === projectId)?.name ?? projectId}</span></p>
                    )}
                  </div>

                  {/* To-Do List picker — shown only for events that need it */}
                  {(eventType === 'new_todo' || eventType === 'todo_completed') && Boolean(projectId) && (
                    <div className="space-y-1">
                      <span className={labelCls}>To-Do List</span>
                      {bcTodolists.isLoading ? (
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Loading to-do lists…
                        </div>
                      ) : bcTodolists.isError ? (
                        <p className="text-[10px] text-red-400">Failed to load to-do lists.</p>
                      ) : (
                        <div className="max-h-36 overflow-y-auto rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                          {(bcTodolists.data ?? []).length === 0 && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No to-do lists found.</p>
                          )}
                          {(bcTodolists.data ?? []).map((tl) => (
                            <button key={tl.id} type="button"
                              onClick={() => onChange({ todolistId: String(tl.id) })}
                              className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                                String(tl.id) === todolistId
                                  ? 'bg-green-100 dark:bg-green-600/30 text-green-800 dark:text-green-300 font-medium'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                              }`}>
                              {tl.name}
                              {tl.todosRemaining > 0 && (
                                <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500">({tl.todosRemaining} remaining)</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      {Boolean(todolistId) && (bcTodolists.data ?? []).length > 0 && (
                        <p className={hintCls}>Selected: <span className="text-slate-700 dark:text-slate-300">{(bcTodolists.data ?? []).find((tl) => String(tl.id) === todolistId)?.name ?? todolistId}</span></p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Step 5 — Trigger mode: Polling vs Instant */}
              {(() => {
                const mode = (cfg.triggerMode as 'polling' | 'instant') || 'polling';

                return (
                  <div className="space-y-3">
                    {/* Mode selector */}
                    <div className="space-y-1">
                      <span className={labelCls}>Trigger Mode</span>
                      <div className="flex gap-2">
                        {(['polling', 'instant'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => onChange({ triggerMode: m })}
                            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium border transition-colors ${
                              mode === m
                                ? 'bg-violet-600 border-violet-500 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-violet-400'
                            }`}
                          >
                            {m === 'polling' ? '⏱ Polling' : '⚡ Instant'}
                          </button>
                        ))}
                      </div>
                      <p className={hintCls}>
                        {mode === 'polling'
                          ? 'Your server checks for new events on a fixed interval. Events may be delayed up to the interval length.'
                          : 'Events trigger the workflow immediately — no manual setup required. The platform auto-registers the connection when you save.'}
                      </p>
                    </div>

                    {/* Polling — check interval */}
                    {mode === 'polling' && (
                      <div className="space-y-1">
                        <label className={labelCls}>
                          Check Interval (minutes)
                          <span className="ml-1 font-normal text-slate-400 dark:text-slate-500 normal-case">
                            — how often to poll for new events
                          </span>
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={(cfg.pollIntervalMinutes as number) || 5}
                          onChange={(e) => onChange({ pollIntervalMinutes: Math.max(1, Number(e.target.value)) })}
                          className={inputCls}
                        />
                        <p className={hintCls}>
                          The workflow only runs when a matching event is detected — not on every check. Default: 5 min.
                        </p>
                      </div>
                    )}

                    {/* Instant — fully automatic, no user setup needed */}
                    {mode === 'instant' && null}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
