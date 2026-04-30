import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { ExpressionResolver } from '../engine/ExpressionResolver';
import { LLMProviderFactory } from '../llm/LLMProviderFactory';
import { LLMProviderName, ChatMessage } from '../types/llm.types';
import { JSONPath } from 'jsonpath-plus';

// ── Field strategies ──────────────────────────────────────────────────────────
//
// Every field describes one named value that we want to pull out of a piece of
// text. The caller picks the strategy that best suits how the value appears in
// the source — anything from a brittle regex up to a natural-language
// description handed to an LLM.

export type ExtractStrategy =
    | { kind: 'regex';     pattern: string;  flags?: string;   group?: number }
    | { kind: 'between';   before: string;   after: string }
    | { kind: 'labeled';   label: string;    stopAt?: string }
    | { kind: 'jsonpath';  path: string }
    | {
          kind: 'ai';
          description: string;
          /** Coerce the LLM output into the requested shape (best-effort). */
          type?: 'string' | 'number' | 'boolean' | 'string[]';
      };

export interface ExtractField {
    /** The output key — accessible downstream as `nodes.<extractId>.<name>`. */
    name: string;
    /** Optional per-field source expression; falls back to the node-level source. */
    source?: string;
    strategy: ExtractStrategy;
    /** Return all matches as an array (only meaningful for regex / between / labeled). */
    multiple?: boolean;
    /** Fail the node if the value is missing. Otherwise the key is set to `null`. */
    required?: boolean;
    /** Returned when the extraction yields nothing and the field is not `required`. */
    default?: string;
    /** Lightweight post-processing applied to non-AI string results. */
    transform?: 'trim' | 'lower' | 'upper' | 'normalize-email';
}

export type Preprocess = 'none' | 'plain-text' | 'strip-quoted-reply' | 'strip-signature';

export interface ExtractNodeConfig {
    /** Default source for fields that don't override it. May contain `{{...}}`. */
    source: string;
    /** Optional sanitisation applied to every resolved source string. */
    preprocess?: Preprocess;
    fields: ExtractField[];
    // ── AI ─────────────────────────────────────────────────────────────────
    // Used when at least one field has `strategy.kind === 'ai'`. All AI
    // fields with the same source are batched into a single LLM call so
    // costs stay sane.
    aiProvider?: LLMProviderName;
    aiModel?: string;
    aiTemperature?: number;
}

function isExtractNodeConfig(config: unknown): config is ExtractNodeConfig {
    if (typeof config !== 'object' || config === null) return false;
    const c = config as Record<string, unknown>;
    return typeof c.source === 'string' && Array.isArray(c.fields);
}

// ── Source preprocessing ──────────────────────────────────────────────────────

function stripHtml(html: string): string {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>(\s*)/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g,  '<')
        .replace(/&gt;/g,  '>')
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, ' ');
}

function stripQuotedReply(text: string): string {
    // Strip everything from the first reply-header line onward. Covers Gmail,
    // Outlook, and most clients. We bail on the first matching marker to keep
    // the surviving body intact.
    const markers = [
        /^On .+ wrote:\s*$/im,
        /^[-_]{2,}\s*Original Message\s*[-_]{2,}\s*$/im,
        /^From:\s.+$/im,
        /^>\s/m, // Quoted reply prefix
    ];
    let cutAt = text.length;
    for (const re of markers) {
        const m = text.match(re);
        if (m && m.index !== undefined && m.index < cutAt) cutAt = m.index;
    }
    return text.slice(0, cutAt).trimEnd();
}

function stripSignature(text: string): string {
    // The standard sigdash separator (\n-- \n) plus a few common variants.
    const sigRe = /\n[-_=]{2,}\s*\n[\s\S]*$|\n--\s*\n[\s\S]*$/;
    return text.replace(sigRe, '').trimEnd();
}

function preprocessSource(text: string, mode: Preprocess | undefined): string {
    if (!text) return '';
    let out = text;
    switch (mode) {
        case 'plain-text':         out = stripHtml(out); break;
        case 'strip-quoted-reply': out = stripQuotedReply(stripHtml(out)); break;
        case 'strip-signature':    out = stripSignature(stripHtml(out)); break;
        case 'none':
        case undefined:
        default:
            // Light normalisation only — collapse \r\n into \n so anchors work
            out = out.replace(/\r\n/g, '\n');
    }
    return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyTransform(value: unknown, transform: ExtractField['transform']): unknown {
    if (typeof value !== 'string' || !transform) return value;
    switch (transform) {
        case 'trim':             return value.trim();
        case 'lower':            return value.toLowerCase();
        case 'upper':            return value.toUpperCase();
        case 'normalize-email':  {
            // Pull the address out of "Jane Doe <jane@acme.com>" if present, then lowercase.
            const m = value.match(/<([^>]+)>/);
            const addr = (m ? m[1] : value).trim().toLowerCase();
            return addr;
        }
        default: return value;
    }
}

// ── Per-strategy extractors ───────────────────────────────────────────────────

function runRegex(text: string, pattern: string, flags: string | undefined, group: number | undefined, multiple: boolean): unknown {
    let re: RegExp;
    try {
        // Force the global flag when the caller asked for multiple matches.
        const f = (flags ?? '') + (multiple && !(flags ?? '').includes('g') ? 'g' : '');
        re = new RegExp(pattern, f);
    } catch (err) {
        throw new Error(`Invalid regex "${pattern}": ${(err as Error).message}`);
    }
    const g = group ?? 1;

    if (!multiple) {
        const m = text.match(re);
        if (!m) return null;
        return m[g] ?? m[0];
    }

    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        results.push(m[g] ?? m[0]);
        if (m.index === re.lastIndex) re.lastIndex++; // Prevent zero-width loop
    }
    return results;
}

function runBetween(text: string, before: string, after: string, multiple: boolean): unknown {
    if (!before && !after) return null;
    // Build a non-greedy regex that captures whatever sits between the anchors.
    // Anchors are matched literally (escaped) — they are text, not patterns.
    const beforeRe = before ? escapeRegex(before) : '';
    const afterRe  = after  ? escapeRegex(after)  : '$';
    const pattern  = `${beforeRe}([\\s\\S]*?)(?=${afterRe})`;
    return runRegex(text, pattern, multiple ? 'g' : undefined, 1, multiple);
}

function runLabeled(text: string, label: string, stopAt: string | undefined, multiple: boolean): unknown {
    if (!label) return null;
    // Match "<label>[: ]<value>" up to the stop-at marker (defaults to end-of-line).
    const labelRe = escapeRegex(label.replace(/:\s*$/, '')); // tolerate user-supplied trailing colon
    const stopRe  = stopAt ? escapeRegex(stopAt) : '\\n|$';
    const pattern = `${labelRe}\\s*[:\\-]?\\s*([^\\n]*?)(?=${stopRe})`;
    return runRegex(text, pattern, multiple ? 'gi' : 'i', 1, multiple);
}

function runJsonPath(rawSource: unknown, path: string, multiple: boolean): unknown {
    let json: unknown = rawSource;
    if (typeof rawSource === 'string') {
        try { json = JSON.parse(rawSource); }
        catch { /* leave as string — JSONPath will simply return [] */ }
    }
    try {
        const results = JSONPath({ path, json: json as object });
        if (!Array.isArray(results) || results.length === 0) return null;
        if (multiple) return results;
        return results.length === 1 ? results[0] : results;
    } catch (err) {
        throw new Error(`Invalid JSONPath "${path}": ${(err as Error).message}`);
    }
}

function coerceAiValue(raw: unknown, type: NonNullable<Extract<ExtractStrategy, { kind: 'ai' }>['type']> | undefined): unknown {
    if (raw === null || raw === undefined) return null;
    switch (type) {
        case 'number': {
            const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.\-]/g, ''));
            return Number.isFinite(n) ? n : null;
        }
        case 'boolean': {
            if (typeof raw === 'boolean') return raw;
            const s = String(raw).trim().toLowerCase();
            if (['true', 'yes', 'y', '1'].includes(s))  return true;
            if (['false', 'no', 'n', '0'].includes(s)) return false;
            return null;
        }
        case 'string[]': {
            if (Array.isArray(raw)) return raw.map((v) => String(v));
            if (typeof raw === 'string') {
                return raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
            }
            return [];
        }
        case 'string':
        default:
            return typeof raw === 'string' ? raw : String(raw);
    }
}

// ── Executor ──────────────────────────────────────────────────────────────────

export class ExtractNode implements NodeExecutor {
    private resolver = new ExpressionResolver();

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<Record<string, unknown>> {
        if (!isExtractNodeConfig(node.config)) {
            throw new Error(
                `Node "${node.id}" has an invalid or incomplete extract config. ` +
                `Expected: { source: string, fields: ExtractField[] }`,
            );
        }

        const config = node.config;
        const result: Record<string, unknown> = {};

        // ── Resolve sources up-front. We cache by raw expression so two fields
        // pointing at the same source don't re-resolve / re-preprocess.
        const sourceCache = new Map<string, string>();
        const resolveSource = (rawExpr: string): string => {
            if (sourceCache.has(rawExpr)) return sourceCache.get(rawExpr)!;
            // resolveTemplate gracefully replaces unknown references with
            // "[missing: ...]"; resolveTemplate also handles bare "{{...}}".
            const resolved = this.resolver.resolveTemplate(rawExpr, context);
            const cleaned  = preprocessSource(resolved, config.preprocess);
            sourceCache.set(rawExpr, cleaned);
            return cleaned;
        };

        // We also need raw (un-preprocessed) JSON for the jsonpath strategy
        // because preprocessing strips structure.
        const rawCache = new Map<string, unknown>();
        const resolveRaw = (rawExpr: string): unknown => {
            if (rawCache.has(rawExpr)) return rawCache.get(rawExpr);

            const trimmed = rawExpr.trim();
            const single  = trimmed.match(/^\{\{\s*(.+?)\s*\}\}$/);
            const inner   = single ? single[1].trim() : '';

            // Special-case bare top-level node refs ({{nodes.<id>}}) — the
            // standard ExpressionResolver requires at least nodes.<id>.<field>.
            // For JSONPath input we frequently want the whole node output as
            // the root document, so we look it up directly here.
            const bareNode = inner.match(/^nodes\.([^.]+)$/);
            if (bareNode) {
                const value = context.variables[bareNode[1]];
                rawCache.set(rawExpr, value);
                return value;
            }

            try {
                const value = single
                    ? this.resolver.resolve(inner, context)
                    : this.resolver.resolveTemplate(rawExpr, context);
                rawCache.set(rawExpr, value);
                return value;
            } catch {
                rawCache.set(rawExpr, undefined);
                return undefined;
            }
        };

        // ── Pass 1: every non-AI field is computed synchronously and stored.
        const aiFields: ExtractField[] = [];
        for (const field of config.fields) {
            if (!field || !field.name) continue;
            if (field.strategy.kind === 'ai') {
                aiFields.push(field);
                continue;
            }

            const sourceExpr = field.source ?? config.source;
            let value: unknown;

            try {
                if (field.strategy.kind === 'jsonpath') {
                    value = runJsonPath(resolveRaw(sourceExpr), field.strategy.path, !!field.multiple);
                } else {
                    const text = resolveSource(sourceExpr);
                    switch (field.strategy.kind) {
                        case 'regex':
                            value = runRegex(text, field.strategy.pattern, field.strategy.flags, field.strategy.group, !!field.multiple);
                            break;
                        case 'between':
                            value = runBetween(text, field.strategy.before, field.strategy.after, !!field.multiple);
                            break;
                        case 'labeled':
                            value = runLabeled(text, field.strategy.label, field.strategy.stopAt, !!field.multiple);
                            break;
                    }
                }
            } catch (err) {
                if (field.required) throw err;
                value = null;
            }

            value = applyTransform(value, field.transform);
            value = applyMissingPolicy(value, field);
            result[field.name] = value;
        }

        // ── Pass 2: AI fields are batched per source so we make one LLM call
        // even when the user defined a dozen AI extractions.
        if (aiFields.length > 0) {
            const groups = new Map<string, ExtractField[]>();
            for (const f of aiFields) {
                const key = f.source ?? config.source;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(f);
            }

            for (const [sourceExpr, fields] of groups) {
                const text = resolveSource(sourceExpr);
                const aiResults = await this.runAiBatch(text, fields, config);
                for (const f of fields) {
                    const strat = f.strategy as Extract<ExtractStrategy, { kind: 'ai' }>;
                    let value = coerceAiValue(aiResults[f.name], strat.type);
                    value = applyMissingPolicy(value, f);
                    result[f.name] = value;
                }
            }
        }

        return result;
    }

    private async runAiBatch(
        text: string,
        fields: ExtractField[],
        config: ExtractNodeConfig,
    ): Promise<Record<string, unknown>> {
        const provider = LLMProviderFactory.create(config.aiProvider ?? 'openai');
        const model    = config.aiModel ?? 'gpt-4o-mini';
        const temperature = config.aiTemperature ?? 0;

        const fieldSpec = fields
            .map((f) => {
                const s = f.strategy as Extract<ExtractStrategy, { kind: 'ai' }>;
                const type = s.type ?? 'string';
                return `- "${f.name}" (${type}): ${s.description}`;
            })
            .join('\n');

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content:
                    'You extract structured data from unstructured text. Respond ONLY with a single ' +
                    'minified JSON object, no commentary, no Markdown fences. Keys must match the ' +
                    'requested field names exactly. Use null when a value cannot be determined.',
            },
            {
                role: 'user',
                content:
                    `Extract the following fields from the source text:\n${fieldSpec}\n\n` +
                    `--- SOURCE TEXT ---\n${text}\n--- END SOURCE TEXT ---`,
            },
        ];

        const response = await provider.complete(messages, model, temperature, 800);

        // Strip code fences in case the model ignored the instructions
        const raw = response.content
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();

        try {
            return JSON.parse(raw) as Record<string, unknown>;
        } catch {
            // Fallback: try to find the first {...} block
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
                try { return JSON.parse(match[0]) as Record<string, unknown>; }
                catch { /* fall through */ }
            }
            throw new Error(
                `Extract AI: model did not return valid JSON. First 200 chars: "${raw.slice(0, 200)}"`,
            );
        }
    }
}

function applyMissingPolicy(value: unknown, field: ExtractField): unknown {
    const isMissing =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0);

    if (!isMissing) return value;

    if (field.required) {
        throw new Error(`Extract field "${field.name}" is required but no value was found.`);
    }
    if (field.default !== undefined) return field.default;
    return null;
}
