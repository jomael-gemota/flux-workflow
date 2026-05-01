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

/**
 * How the node handles a Source that resolves to a list (e.g. a Gmail thread's
 * `messages` array).
 *
 *   - `auto`       (default) — detect at runtime; if the resolved value is an
 *                   array, run extraction once per item; otherwise run once.
 *   - `single`     — JSON-stringify the whole resolved value and run once.
 *                   Escape hatch for power users.
 *   - `each-item`  — explicitly require an array source; throw if it isn't.
 */
export type ExtractMode = 'auto' | 'single' | 'each-item';

export interface ExtractNodeConfig {
    /** Default source for fields that don't override it. May contain `{{...}}`. */
    source: string;
    /** Optional sanitisation applied to every resolved source string. */
    preprocess?: Preprocess;
    fields: ExtractField[];
    /** How to treat a Source that resolves to a list. Defaults to `auto`. */
    mode?: ExtractMode;
    /**
     * When the Source resolves to a list of objects, where to find the text
     * inside each item. Dotted/bracket path, e.g. `body`, `payload.body.text`.
     * If empty, the executor probes a few common keys (`body`, `text`,
     * `content`, `message`) and falls back to JSON-stringifying the item.
     *
     * Per-field `source` overrides opt out of iteration entirely — those
     * fields always resolve once against their own expression.
     */
    textPath?: string;
    // ── AI ─────────────────────────────────────────────────────────────────
    // Used when at least one field has `strategy.kind === 'ai'`. AI fields
    // with the same source are batched into a single LLM call so costs stay
    // sane (one call per item when iterating).
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

// ── Source coercion ───────────────────────────────────────────────────────────
//
// Helpers that turn whatever the Source resolved to (strings, numbers, arrays,
// objects) into the plain-text the regex/between/labeled strategies expect.

/** Walk a dotted/bracket path the same way ExpressionResolver does (best-effort). */
function walkObjectPath(obj: unknown, path: string): unknown {
    if (!path) return obj;
    let current: unknown = obj;
    for (const rawKey of path.split('.')) {
        if (current == null) return undefined;

        const propPlusBracket = rawKey.match(/^(.+?)\[(\d+)\]$/);
        if (propPlusBracket) {
            const [, propKey, idxStr] = propPlusBracket;
            if (typeof current !== 'object') return undefined;
            const next = (current as Record<string, unknown>)[propKey];
            if (!Array.isArray(next)) return undefined;
            current = next[parseInt(idxStr, 10)];
            continue;
        }
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

/** Coerce any value to a string suitable for regex/between/labeled strategies. */
function coerceToString(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch { return String(value); }
}

/**
 * Pull the extractable text out of an iteration item. When `textPath` is set,
 * walk that path; otherwise probe a few common email-shaped keys before
 * falling back to a JSON dump (so AI extraction can still see the structure).
 */
function toExtractText(item: unknown, textPath: string | undefined): string {
    if (item == null) return '';
    if (typeof item === 'string') return item;
    if (typeof item !== 'object') return coerceToString(item);

    if (textPath && textPath.trim()) {
        const picked = walkObjectPath(item, textPath.trim());
        if (picked != null) return coerceToString(picked);
        // textPath was set but didn't resolve — fall through to defaults rather
        // than returning empty, so the user's rules still see something.
    }

    // Common keys we look for in order. Designed for emails / chat / API
    // responses: most of them surface a "body" or "text" field.
    const probes = ['body', 'text', 'content', 'message', 'snippet', 'value'];
    for (const key of probes) {
        const v = (item as Record<string, unknown>)[key];
        if (typeof v === 'string' && v.length > 0) return v;
    }

    // Last resort — JSON-stringify so AI strategies still have something to
    // work with. Non-AI strategies running against a JSON blob will produce
    // weak matches, which is the user's cue to set a textPath.
    return coerceToString(item);
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
        const mode: ExtractMode = config.mode ?? 'auto';

        // ── Iteration decision ────────────────────────────────────────────
        // We resolve the node-level Source as a raw value (object/array/string)
        // and decide whether to run the extraction once or once-per-item.
        // Per-field sources opt out of iteration — each field with its own
        // `source` always resolves against its own expression, single-shot.
        const rawNodeSource = this.resolveRawValue(config.source, context);

        const isArraySource = Array.isArray(rawNodeSource);
        const shouldIterate =
            mode === 'each-item' ? true :
            mode === 'single'    ? false :
            /* auto */             isArraySource;

        if (mode === 'each-item' && !isArraySource) {
            throw new Error(
                `Extract node "${node.id}" is set to "each-item" but the Source did not resolve to a list. ` +
                `Either change Mode to "auto" / "single" or point Source at an array.`,
            );
        }

        if (!shouldIterate) {
            // Single-shot: same shape as before — flat field/value object.
            return await this.extractOne(rawNodeSource, config, context);
        }

        // Iteration mode: produce { items: [...], count: N }.
        const list = (rawNodeSource as unknown[]) ?? [];
        const items: Record<string, unknown>[] = [];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            try {
                const oneResult = await this.extractOne(item, config, context);
                items.push(oneResult);
            } catch (err) {
                // Re-throw with a useful index so the user can find the bad item.
                throw new Error(
                    `Extract node "${node.id}" failed on item ${i}: ${(err as Error).message}`,
                );
            }
        }

        return { items, count: items.length };
    }

    /**
     * Run all configured fields against a single source value (string, object,
     * or array — we don't care, the per-field strategy decides what to do).
     *
     * `rawSource` is the *raw* value the node-level source resolves to (or a
     * single array element when iterating). Per-field sources are resolved
     * inside this method against the original execution context.
     */
    private async extractOne(
        rawSource: unknown,
        config: ExtractNodeConfig,
        context: ExecutionContext,
    ): Promise<Record<string, unknown>> {
        const result: Record<string, unknown> = {};

        // Cache raw and stringified-cleaned representations of the per-field
        // source expressions. Falsy "source override" → use the iteration's
        // raw value directly.
        const stringCache = new Map<string, string>();
        const rawCache    = new Map<string, unknown>();

        const getFieldRaw = (fieldSource: string | undefined): unknown => {
            if (!fieldSource) return rawSource;
            if (rawCache.has(fieldSource)) return rawCache.get(fieldSource);
            const v = this.resolveRawValue(fieldSource, context);
            rawCache.set(fieldSource, v);
            return v;
        };

        const getFieldString = (fieldSource: string | undefined): string => {
            const cacheKey = fieldSource ?? '__node_source__';
            if (stringCache.has(cacheKey)) return stringCache.get(cacheKey)!;

            // Per-field override → resolve fresh as a template string.
            // Node-source iteration item → coerce via toExtractText so we
            // pick the configured textPath out of object items.
            const raw = getFieldRaw(fieldSource);
            const text =
                fieldSource
                    ? coerceToString(raw)
                    : toExtractText(raw, config.textPath);
            const cleaned = preprocessSource(text, config.preprocess);
            stringCache.set(cacheKey, cleaned);
            return cleaned;
        };

        // ── Pass 1: every non-AI field is computed synchronously and stored.
        const aiFields: ExtractField[] = [];
        for (const field of config.fields) {
            if (!field || !field.name) continue;
            if (field.strategy.kind === 'ai') {
                aiFields.push(field);
                continue;
            }

            let value: unknown;

            try {
                if (field.strategy.kind === 'jsonpath') {
                    value = runJsonPath(getFieldRaw(field.source), field.strategy.path, !!field.multiple);
                } else {
                    const text = getFieldString(field.source);
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

        // ── Pass 2: AI fields batched per source. Within one extractOne call
        // we typically have one source (the iteration item) so this is a
        // single LLM call per item even when the user defined many AI fields.
        if (aiFields.length > 0) {
            const groups = new Map<string | undefined, ExtractField[]>();
            for (const f of aiFields) {
                const key = f.source;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(f);
            }

            for (const [fieldSource, fields] of groups) {
                const text = getFieldString(fieldSource);
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

    /**
     * Resolve a raw expression to its underlying value (object/array/string),
     * gracefully returning `undefined` when the path can't be resolved (e.g.
     * during isolated testing). Special-cases bare `{{nodes.<id>}}` since the
     * standard resolver requires at least three path segments.
     */
    private resolveRawValue(rawExpr: string, context: ExecutionContext): unknown {
        if (!rawExpr) return undefined;
        const trimmed = rawExpr.trim();
        const single  = trimmed.match(/^\{\{\s*(.+?)\s*\}\}$/);

        if (single) {
            const inner = single[1].trim();
            const bareNode = inner.match(/^nodes\.([^.]+)$/);
            if (bareNode) return context.variables[bareNode[1]];
            try { return this.resolver.resolve(inner, context); }
            catch { return undefined; }
        }

        // Mixed template (e.g. "Hello {{nodes.x.name}}") — fall back to a
        // template-resolved string. There's no sensible "raw" for mixed
        // templates because they're string-shaped by definition.
        try { return this.resolver.resolveTemplate(rawExpr, context); }
        catch { return undefined; }
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
