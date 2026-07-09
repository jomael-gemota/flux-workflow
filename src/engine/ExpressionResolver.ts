import { JSONPath } from "jsonpath-plus";
import { ExecutionContext, WorkflowVariable } from '../types/workflow.types';

/**
 * Flatten a workflow's ordered variable list into the `Record<string, string>`
 * map consumed by `ExecutionContext.vars`. Later entries win on duplicate keys.
 */
export function buildVarsMap(variables?: WorkflowVariable[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const v of variables ?? []) {
        if (v && typeof v.key === 'string' && v.key.length > 0) {
            map[v.key] = typeof v.value === 'string' ? v.value : String(v.value ?? '');
        }
    }
    return map;
}

export class ExpressionResolver {
    resolve(expression: string, context: ExecutionContext): unknown {
        const trimmed = expression.trim();

        // Strip {{...}} wrapper — the variable picker inserts expressions in this format
        // so both "nodes.x.field" and "{{nodes.x.field}}" are accepted everywhere.
        const templateWrapper = trimmed.match(/^\{\{\s*(.+?)\s*\}\}$/);
        if (templateWrapper) {
            return this.resolve(templateWrapper[1].trim(), context);
        }

        if (trimmed.startsWith('$')) {
            return this.resolveJsonPath(trimmed, context);
        }

        if (trimmed.startsWith('vars.')) {
            return this.resolveVars(trimmed, context);
        }

        if (trimmed.startsWith('nodes.')) {
            return this.resolveDotNotation(trimmed, context);
        }

        return trimmed;
    }

    /**
     * Resolve a `vars.<key>` reference to a plain workflow variable value.
     * Variable values are plain strings, so there is no nested path to walk.
     */
    private resolveVars(expression: string, context: ExecutionContext): unknown {
        const key = expression.slice('vars.'.length).trim();
        if (!key) {
            throw new Error(`Invalid variable expression: "${expression}". Expected format: vars.<name>`);
        }

        const vars = context.vars ?? {};
        if (!(key in vars)) {
            throw new Error(
                `Workflow variable "${key}" is not defined. ` +
                `Add it in the workflow's Variables panel or check the spelling.`
            );
        }

        return vars[key];
    }

    private resolveDotNotation(expression: string, context: ExecutionContext): unknown {
        const parts = expression.split('.');
        if (parts[0] !== 'nodes' || parts.length < 3) {
            throw new Error(`Invalid dot notation expression: "${expression}". Expected format: nodes.<nodeId>.output.<field>`);
        }

        const nodeId = parts[1];
        const nodeOutput = context.variables[nodeId];

        if (nodeOutput === undefined) {
            throw new Error(`Node "${nodeId}" has no output in context. Make sure it runs before this condition.`);
        }

        // Disabled-node sentinel set by WorkflowRunner when the node is bypassed
        if (
            nodeOutput !== null &&
            typeof nodeOutput === 'object' &&
            (nodeOutput as Record<string, unknown>).__disabled === true
        ) {
            throw new Error(
                `Node "${nodeId}" is disabled and produced no output. ` +
                `Enable the node or remove references to its output from downstream nodes.`
            );
        }

        const remainingPath = parts.slice(2);
        return this.walkPath(nodeOutput, remainingPath, expression);
    }

    private resolveJsonPath(expression: string, context: ExecutionContext): unknown {
        const data = { nodes: context.variables, vars: context.vars ?? {} };

        try {
            const results = JSONPath({ path: expression, json: data as object });
            if (!Array.isArray(results) || results.length === 0) return undefined;
            return results.length == 1 ? results[0] : results;
        } catch {
            throw new Error(`Invalid JSONPath expression: "${expression}"`);
        }
    }

    private walkPath(obj: unknown, path: string[], fullExpression: string): unknown {
        let current = obj;

        for (const rawKey of path) {
            if (current == null || current == undefined) return undefined;

            // Bracket array access attached to a property name: body[0], items[2]
            const propPlusBracket = rawKey.match(/^(.+?)\[(\d+)\]$/);
            if (propPlusBracket) {
                const [, propKey, idxStr] = propPlusBracket;
                if (typeof current !== 'object') {
                    throw new Error(`Cannot access "${propKey}" on a non-object value in expression: "${fullExpression}"`);
                }
                current = (current as Record<string, unknown>)[propKey];
                if (current == null) return undefined;
                if (!Array.isArray(current)) {
                    throw new Error(`"${propKey}" is not an array in expression: "${fullExpression}"`);
                }
                current = current[parseInt(idxStr, 10)];
                continue;
            }

            // Bare bracket index as its own segment: [0] (e.g. user wrote nodes.x.body.[0])
            const bareBracket = rawKey.match(/^\[(\d+)\]$/);
            if (bareBracket) {
                if (!Array.isArray(current)) {
                    throw new Error(`Expected an array to index into in expression: "${fullExpression}"`);
                }
                current = current[parseInt(bareBracket[1], 10)];
                continue;
            }

            if (typeof current !== 'object') {
                throw new Error(`Cannot access "${rawKey}" on a non-object value in expression: "${fullExpression}"`);
            }
            current = (current as Record<string, unknown>)[rawKey];
        }

        return current;
    }

    resolveTemplate(template: string, context: ExecutionContext): string {
        return template.replace(/\{\{\s*(.+?)\s*\}\}/g, (_, expr) => {
            try {
                const value = this.resolve(expr.trim(), context);
                if (value === undefined || value === null) return `[missing: ${expr.trim()}]`;
                if (typeof value === 'object') return JSON.stringify(value);
                return String(value);
            } catch {
                // Node not yet in context (e.g. testing in isolation) — emit a readable placeholder
                return `[missing: ${expr.trim()}]`;
            }
        });
    }

    /**
     * Recursively walk any config value and resolve all embedded `{{...}}`
     * expressions in string leaves. Non-string scalars and undefined/null
     * pass through unchanged. Errors in individual expressions are swallowed
     * so a single bad reference never aborts the snapshot.
     */
    resolveDeep(obj: unknown, context: ExecutionContext): unknown {
        if (typeof obj === 'string') {
            try { return this.resolveTemplate(obj, context); } catch { return obj; }
        }
        if (Array.isArray(obj)) return obj.map(v => this.resolveDeep(v, context));
        if (obj !== null && typeof obj === 'object') {
            return Object.fromEntries(
                Object.entries(obj as Record<string, unknown>).map(
                    ([k, v]) => [k, this.resolveDeep(v, context)]
                )
            );
        }
        return obj;
    }
}