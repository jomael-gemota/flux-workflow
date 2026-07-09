import { NodeExecutor } from '../engine/NodeExecutor';
import { WorkflowNode, ExecutionContext } from '../types/workflow.types';
import { ExpressionResolver } from '../engine/ExpressionResolver';

type LoopMode = 'forEach' | 'times' | 'while' | 'batch';

interface LoopNodeConfig {
    mode: LoopMode;
    /**
     * forEach / batch — path expression resolving to an array.
     * Accepts `{{nodes.x.field}}`, `nodes.x.field`, or any path the
     * standard ExpressionResolver understands.
     */
    items?: string;
    /** times — number of iterations (literal or path expression that resolves to a number). */
    count?: string | number;
    /** while — JavaScript expression evaluated each iteration; loop stops when it returns false. */
    condition?: string;
    /**
     * JavaScript body executed for each iteration. The last expression / `return`
     * value is the iteration result. Available identifiers depend on `mode`:
     *
     *   • forEach → item, index, acc, nodes, input, vars
     *   • times   → index (also passed as item), acc, nodes, input, vars
     *   • while   → index, acc, nodes, input, vars
     *   • batch   → batch (an array slice, also passed as item), index, acc, nodes, input, vars
     */
    body: string;
    /** JavaScript expression for the initial accumulator value (default: undefined). */
    initialAcc?: string;
    /** batch — chunk size (default 10). */
    batchSize?: number;
    /** Hard cap on iterations to guard against infinite while loops (default 1000). */
    maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 1000;

/**
 * Self-contained loop. Returns the array of iteration results plus the
 * final accumulator value — does NOT modify the workflow graph or fan
 * other nodes out per item. For per-item side effects (e.g., calling
 * Gmail N times) chain a Code node inside the body, or use a future
 * sub-graph loop variant.
 */
export class LoopNode implements NodeExecutor {
    private resolver = new ExpressionResolver();

    async execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> {
        const config = node.config as unknown as LoopNodeConfig;
        const mode = (config.mode ?? 'forEach') as LoopMode;
        const body = (config.body ?? '').trim();
        if (!body) throw new Error('Loop node: body is required');

        const maxIterations = Math.max(1, config.maxIterations ?? DEFAULT_MAX_ITERATIONS);

        // eslint-disable-next-line @typescript-eslint/ban-types
        let bodyFn: Function;
        try {
            bodyFn = new Function(
                'item', 'index', 'acc', 'nodes', 'input', 'vars',
                `return (async () => {\n${body}\n})();`,
            );
        } catch (err) {
            throw new Error(`Loop node: body syntax error — ${(err as Error).message}`);
        }

        const varsCtx = context.vars ?? {};

        let acc: unknown = undefined;
        if (config.initialAcc && config.initialAcc.trim()) {
            try {
                const initFn = new Function('nodes', 'input', 'vars', `return (${config.initialAcc});`);
                acc = initFn(context.variables, context.variables.input, varsCtx);
            } catch (err) {
                throw new Error(`Loop node: initialAcc error — ${(err as Error).message}`);
            }
        }

        const results: unknown[] = [];
        const nodesCtx = context.variables;
        const inputCtx = context.variables.input;

        switch (mode) {
            case 'forEach': {
                const items = this.resolveArray(config.items, context, 'forEach');
                const limit = Math.min(items.length, maxIterations);
                for (let index = 0; index < limit; index++) {
                    const out = await bodyFn(items[index], index, acc, nodesCtx, inputCtx, varsCtx);
                    results.push(out);
                    acc = out;
                }
                return {
                    mode,
                    iterations: results.length,
                    totalItems: items.length,
                    truncated: items.length > limit,
                    results,
                    acc,
                };
            }

            case 'times': {
                const raw = typeof config.count === 'number'
                    ? config.count
                    : Number(this.resolver.resolve(String(config.count ?? '0'), context));
                if (!Number.isFinite(raw) || raw < 0) {
                    throw new Error(`Loop node (times): count must be a non-negative number, got ${raw}`);
                }
                const requested = Math.floor(raw);
                const limit = Math.min(requested, maxIterations);
                for (let index = 0; index < limit; index++) {
                    const out = await bodyFn(index, index, acc, nodesCtx, inputCtx, varsCtx);
                    results.push(out);
                    acc = out;
                }
                return {
                    mode,
                    iterations: results.length,
                    requested,
                    truncated: requested > limit,
                    results,
                    acc,
                };
            }

            case 'while': {
                const conditionSrc = (config.condition ?? '').trim();
                if (!conditionSrc) throw new Error('Loop node (while): condition is required');
                // eslint-disable-next-line @typescript-eslint/ban-types
                let condFn: Function;
                try {
                    condFn = new Function('index', 'acc', 'nodes', 'input', 'vars', `return (${conditionSrc});`);
                } catch (err) {
                    throw new Error(`Loop node (while): condition syntax error — ${(err as Error).message}`);
                }
                let index = 0;
                let hitCap = false;
                while (true) {
                    if (index >= maxIterations) { hitCap = true; break; }
                    let keepGoing: unknown;
                    try {
                        keepGoing = condFn(index, acc, nodesCtx, inputCtx, varsCtx);
                    } catch (err) {
                        throw new Error(`Loop node (while): condition runtime error — ${(err as Error).message}`);
                    }
                    if (!keepGoing) break;
                    const out = await bodyFn(undefined, index, acc, nodesCtx, inputCtx, varsCtx);
                    results.push(out);
                    acc = out;
                    index++;
                }
                return { mode, iterations: results.length, hitCap, results, acc };
            }

            case 'batch': {
                const items = this.resolveArray(config.items, context, 'batch');
                const size = Math.max(1, Math.floor(config.batchSize ?? 10));
                const batches: unknown[][] = [];
                for (let i = 0; i < items.length; i += size) {
                    batches.push(items.slice(i, i + size));
                }
                const limit = Math.min(batches.length, maxIterations);
                for (let index = 0; index < limit; index++) {
                    const batch = batches[index];
                    const out = await bodyFn(batch, index, acc, nodesCtx, inputCtx, varsCtx);
                    results.push(out);
                    acc = out;
                }
                return {
                    mode,
                    iterations: results.length,
                    totalBatches: batches.length,
                    batchSize: size,
                    truncated: batches.length > limit,
                    results,
                    acc,
                };
            }

            default:
                throw new Error(`Loop node: unknown mode "${mode}"`);
        }
    }

    private resolveArray(
        expression: string | undefined,
        context: ExecutionContext,
        mode: string,
    ): unknown[] {
        if (!expression || !expression.trim()) {
            throw new Error(`Loop node (${mode}): items expression is required`);
        }
        const value = this.resolver.resolve(expression, context);
        if (!Array.isArray(value)) {
            const got = value === null ? 'null' : typeof value;
            throw new Error(
                `Loop node (${mode}): items expression "${expression}" did not resolve to an array (got ${got})`,
            );
        }
        return value;
    }
}
