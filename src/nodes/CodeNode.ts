import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { ExpressionResolver } from '../engine/ExpressionResolver';

interface CodeNodeConfig {
    /** User-supplied JavaScript. Last expression / explicit `return` becomes the node output. */
    code: string;
}

interface CapturedLog {
    level: 'log' | 'info' | 'warn' | 'error';
    message: string;
    timestamp: string;
}

/**
 * Executes arbitrary JavaScript supplied by the workflow author.
 *
 * Globals exposed to user code:
 *   • `nodes`       — every prior node's output, keyed by node id
 *   • `input`       — workflow-level input payload
 *   • `vars`        — per-workflow plain variables, keyed by name
 *   • `console`     — captured into the node output's `logs` array
 *   • `workflow`    — { id }
 *   • `execution`   — { id, startedAt }
 *   • `require`     — full Node.js `require` (this is a privileged execution mode)
 *   • `process`, `Buffer`, `fetch`, etc. — inherited from the host
 *
 * Variable chips: any `{{nodes.<id>.<path>}}` / `{{vars.<key>}}` token in the
 * code is resolved to its *real value* (not a stringified copy) and injected as
 * a generated binding, so authors can use the same @-menu chips as other fields
 * while keeping object references and types intact. Code with no tokens (e.g.
 * plain `nodes['id'].result` access) is unaffected.
 *
 * The user code is wrapped in an `async` IIFE so `await` is always available.
 * The value returned from the user code becomes `output.result`.
 */
export class CodeNode implements NodeExecutor {
    private resolver = new ExpressionResolver();

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as CodeNodeConfig;
        const rawCode = (config.code ?? '').trim();
        if (!rawCode) throw new Error('Code node: code is required');

        // Replace each {{...}} token with a generated identifier bound to its
        // resolved value. This keeps real objects/arrays (unlike template
        // string substitution, which would stringify them).
        const injectedNames: string[] = [];
        const injectedValues: unknown[] = [];
        const userCode = rawCode.replace(/\{\{\s*(.+?)\s*\}\}/g, (_match, expr: string) => {
            const name = `__var${injectedNames.length}`;
            let value: unknown;
            try {
                value = this.resolver.resolve(String(expr).trim(), context);
            } catch {
                value = undefined;
            }
            injectedNames.push(name);
            injectedValues.push(value);
            return name;
        });

        const logs: CapturedLog[] = [];
        const capture = (level: CapturedLog['level']) =>
            (...args: unknown[]) => {
                logs.push({
                    level,
                    message: args.map(safeStringify).join(' '),
                    timestamp: new Date().toISOString(),
                });
            };
        const sandboxConsole = {
            log:   capture('log'),
            info:  capture('info'),
            warn:  capture('warn'),
            error: capture('error'),
            debug: capture('log'),
        };

        // Wrap user code in an async IIFE so `await` works seamlessly and
        // `return` from the user's code produces our value.
        const wrapped = `return (async () => {\n${userCode}\n})();`;

        // eslint-disable-next-line @typescript-eslint/ban-types
        let asyncFn: Function;
        try {
            asyncFn = new Function(
                'nodes', 'input', 'vars', 'console', 'workflow', 'execution',
                ...injectedNames,
                wrapped,
            );
        } catch (err) {
            throw new Error(`Code node: syntax error — ${(err as Error).message}`);
        }

        let result: unknown;
        try {
            result = await asyncFn(
                context.variables,
                context.variables.input,
                context.vars ?? {},
                sandboxConsole,
                { id: context.workflowId },
                { id: context.executionId, startedAt: context.startedAt.toISOString() },
                ...injectedValues,
            );
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`Code node: runtime error — ${detail}`);
        }

        return { result, logs };
    }
}

function safeStringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return '[Circular]'; }
    }
    return String(value);
}
