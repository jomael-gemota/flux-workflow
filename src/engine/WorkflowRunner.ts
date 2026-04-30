import crypto from 'crypto';
import { WorkflowDefinition, WorkflowNode, ExecutionContext, NodeResult } from '../types/workflow.types';
import { NodeExecutorRegistry } from './NodeExecutorRegistry';
import { WorkflowExecutionResult } from '../types/workflow.types';
import { ConditionNodeOutput } from '../nodes/ConditionNode';
import { SwitchNodeOutput } from '../nodes/SwitchNode';

export class WorkflowRunner {
    constructor(private registry: NodeExecutorRegistry) {}

    async run(
        workflow: WorkflowDefinition,
        input: unknown,
        triggerNodeId?: string,
        onNodeResult?: (result: NodeResult) => void,
    ): Promise<WorkflowExecutionResult> {
        const context: ExecutionContext = {
            workflowId: workflow.id,
            executionId: crypto.randomUUID(),
            variables: { input },
            startedAt: new Date(),
        };

        const results: NodeResult[] = [];

        // When a specific trigger node fired, use it as the sole entry point;
        // otherwise fall back to the workflow's configured entry nodes.
        const entryIds = (triggerNodeId
            ? [triggerNodeId]
            : (workflow.entryNodeIds?.length
                ? workflow.entryNodeIds
                : [workflow.entryNodeId])
        ).filter(Boolean);

        // Pre-compute in-degree for fan-in (join) logic.
        // Condition/switch targets live in config (not next[]) and are handled
        // separately via skipBranch so join nodes still get proper counts.
        const pendingCounts = this.buildPendingCounts(workflow, entryIds);

        // Cycle guard — a node only executes once even if multiple paths reach it
        const visited = new Set<string>();

        // Tracks nodes that have received at least one successful upstream
        // result. Used by skipBranch to decide whether a join node should
        // actually run (some upstream produced data) or be skipped (every
        // upstream was itself skipped, so there's no real input).
        const hasSuccessfulUpstream = new Set<string>();

        await Promise.all(
            entryIds.map(id =>
                this.executeNode(workflow, id, context, results, pendingCounts, visited, hasSuccessfulUpstream, onNodeResult)
            )
        );

        return { executionId: context.executionId, results };
    }

    /**
     * Walk the graph from entry points and return every node reachable
     * through any branch (both sides of condition/switch are considered
     * reachable for fan-in accounting, even though only one fires at runtime).
     */
    private buildReachableSet(
        workflow: WorkflowDefinition,
        entryIds: string[]
    ): Set<string> {
        const reachable = new Set<string>();
        const queue = entryIds.filter(Boolean);

        while (queue.length > 0) {
            const id = queue.shift()!;
            if (reachable.has(id)) continue;
            reachable.add(id);

            const node = workflow.nodes.find(n => n.id === id);
            if (!node) continue;

            for (const nextId of this.getAllNextIds(node)) {
                if (nextId && !reachable.has(nextId)) queue.push(nextId);
            }
        }

        return reachable;
    }

    /**
     * Build a Map<nodeId, pendingUpstreamCount> for every reachable node.
     * Only edges from nodes that are actually reachable from the entry points
     * are counted — orphan nodes (no predecessor, not entry) that happen to
     * point at a reachable node are ignored so they don't block execution.
     *
     * A join node (in-degree > 1 among reachable predecessors) will block
     * until all its expected upstream branches complete.
     * Entry nodes are pinned to 0 so they always start immediately.
     */
    private buildPendingCounts(
        workflow: WorkflowDefinition,
        entryIds: string[]
    ): Map<string, number> {
        const reachable = this.buildReachableSet(workflow, entryIds);
        const counts = new Map<string, number>();

        for (const node of workflow.nodes) {
            if (!reachable.has(node.id)) continue; // skip unreachable nodes

            if (!counts.has(node.id)) counts.set(node.id, 0);

            // Only count outgoing edges to other reachable nodes
            for (const nextId of this.getAllNextIds(node)) {
                if (nextId && reachable.has(nextId)) {
                    counts.set(nextId, (counts.get(nextId) ?? 0) + 1);
                }
            }
        }

        // Entry nodes always start regardless of computed in-degree
        for (const id of entryIds) {
            if (id) counts.set(id, 0);
        }

        return counts;
    }

    private async executeNode(
        workflow: WorkflowDefinition,
        nodeId: string,
        context: ExecutionContext,
        results: NodeResult[],
        pendingCounts: Map<string, number>,
        visited: Set<string>,
        hasSuccessfulUpstream: Set<string>,
        onNodeResult?: (result: NodeResult) => void,
    ): Promise<void> {
        // Fan-in gate: decrement the pending count for this node.
        // A join node (in-degree N) only proceeds when all N upstream branches have arrived.
        const remaining = (pendingCounts.get(nodeId) ?? 0) - 1;
        pendingCounts.set(nodeId, remaining);
        if (remaining > 0) return; // Still waiting for other branches

        // Cycle guard
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const pushResult = (result: NodeResult) => {
            results.push(result);
            onNodeResult?.(result);
        };

        // Gracefully handle missing nodes instead of throwing
        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) {
            pushResult({
                nodeId,
                status: 'failure',
                output: null,
                error: `Node "${nodeId}" not found in workflow — it may have been deleted after saving.`,
                durationMs: 0,
            });
            return;
        }

        // Disabled node: record as skipped, place a sentinel in context so any
        // downstream expression that references its output gets a clear error,
        // then continue execution through all outgoing edges.
        if (node.disabled) {
            context.variables[nodeId] = { __disabled: true };
            pushResult({ nodeId, status: 'skipped', output: null, durationMs: 0 });

            // A disabled node produced no real output — every outgoing branch
            // is a skip, regardless of node type.
            for (const nextId of this.getAllNextIds(node)) {
                await this.skipBranch(workflow, nextId, context, results, pendingCounts, visited, hasSuccessfulUpstream, onNodeResult);
            }
            return;
        }

        const start = Date.now();

        // Gracefully handle missing executor instead of throwing
        let executor: { execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> };
        try {
            executor = this.registry.get(node.type);
        } catch {
            pushResult({
                nodeId,
                status: 'failure',
                output: null,
                error: `No executor registered for node type "${node.type}".`,
                durationMs: Date.now() - start,
            });
            return;
        }

        // Execute the node — errors are caught and recorded, never thrown upward
        let output: unknown;
        try {
            output = await this.executeWithRetryAndTimeout(node, context, executor);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            pushResult({
                nodeId,
                status: 'failure',
                output: null,
                error: message,
                durationMs: Date.now() - start,
            });
            return; // Do not execute downstream nodes on failure
        }

        context.variables[nodeId] = output;
        pushResult({
            nodeId,
            status: 'success',
            output,
            durationMs: Date.now() - start,
        });

        const takenIds = this.resolveNextNodes(node.type, output, node.next);

        // Mark every taken successor as having at least one successful upstream
        // before recursing, so that a sibling branch's later skipBranch call
        // can correctly decide to execute (rather than skip) a join node.
        for (const tid of takenIds) {
            if (tid) hasSuccessfulUpstream.add(tid);
        }

        // Execute taken branches first
        await Promise.all(
            takenIds.map(nextId =>
                this.executeNode(workflow, nextId, context, results, pendingCounts, visited, hasSuccessfulUpstream, onNodeResult)
            )
        );

        // Skip branches that were NOT taken (condition/switch), so that any downstream
        // join nodes can correctly receive their pending count decrements.
        const skippedIds = this.getAllNextIds(node).filter(id => !takenIds.includes(id));
        for (const skippedId of skippedIds) {
            await this.skipBranch(workflow, skippedId, context, results, pendingCounts, visited, hasSuccessfulUpstream, onNodeResult);
        }
    }

    /**
     * Mark a branch as skipped and propagate the skip so join nodes
     * downstream can still fire when their other branches complete.
     */
    private async skipBranch(
        workflow: WorkflowDefinition,
        nodeId: string,
        context: ExecutionContext,
        results: NodeResult[],
        pendingCounts: Map<string, number>,
        visited: Set<string>,
        hasSuccessfulUpstream: Set<string>,
        onNodeResult?: (result: NodeResult) => void,
    ): Promise<void> {
        if (!nodeId || visited.has(nodeId)) return;
        visited.add(nodeId);

        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const skippedResult: NodeResult = { nodeId, status: 'skipped', output: null, durationMs: 0 };
        results.push(skippedResult);
        onNodeResult?.(skippedResult);

        const nextIds = this.getAllNextIds(node);

        for (const nextId of nextIds) {
            if (!nextId) continue;
            const current = pendingCounts.get(nextId) ?? 0;
            const newCount = current - 1;
            pendingCounts.set(nextId, newCount);

            // Only act once the LAST predecessor of nextId has arrived.
            // While newCount > 0, other (possibly successful) predecessors may
            // still be coming, so we must NOT pre-emptively mark nextId as
            // skipped here — doing that would put it in `visited` and cause
            // a later successful predecessor's executeNode call to no-op.
            if (newCount <= 0 && !visited.has(nextId)) {
                if (hasSuccessfulUpstream.has(nextId)) {
                    // At least one upstream branch produced real output;
                    // run the join node so it consumes that data.
                    await this.executeNode(workflow, nextId, context, results, pendingCounts, visited, hasSuccessfulUpstream, onNodeResult);
                } else {
                    // Every upstream branch was itself skipped — there is no
                    // input for this node, so propagate the skip downstream.
                    await this.skipBranch(workflow, nextId, context, results, pendingCounts, visited, hasSuccessfulUpstream, onNodeResult);
                }
            }
        }
    }

    /** Returns all possible outgoing node IDs for a node (regardless of runtime output). */
    private getAllNextIds(node: WorkflowNode): string[] {
        if (node.type === 'condition') {
            const cfg = node.config as { trueNext?: string; falseNext?: string };
            return [cfg.trueNext, cfg.falseNext].filter((id): id is string => !!id);
        }
        if (node.type === 'switch') {
            const cfg = node.config as {
                cases?: Array<{ next?: string }>;
                defaultNext?: string;
            };
            const ids: string[] = (cfg.cases ?? []).map(c => c.next ?? '').filter(Boolean);
            if (cfg.defaultNext) ids.push(cfg.defaultNext);
            return ids;
        }
        return node.next.filter(Boolean);
    }

    private async executeWithRetryAndTimeout(
        node: WorkflowNode,
        context: ExecutionContext,
        executor: { execute(node: WorkflowNode, context: ExecutionContext): Promise<unknown> }
    ): Promise<unknown> {
        const maxAttempts = (node.retries ?? 0) + 1;
        const retryDelayMs = node.retryDelayMs ?? 0;
        const timeoutMs = node.timeoutMs;

        let lastError: Error = new Error('Unknown error');

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.executeWithTimeout(
                    executor.execute(node, context),
                    timeoutMs,
                    node.id
                );
            } catch (err: unknown) {
                lastError = err instanceof Error ? err : new Error(String(err));
                if (attempt < maxAttempts && retryDelayMs > 0) {
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                }
            }
        }

        throw lastError;
    }

    private executeWithTimeout(
        promise: Promise<unknown>,
        timeoutMs: number | undefined,
        nodeId: string
    ): Promise<unknown> {
        if (!timeoutMs) return promise;

        const timeout = new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Node "${nodeId}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            promise.finally(() => clearTimeout(timer));
        });

        return Promise.race([promise, timeout]);
    }

    /**
     * Returns the IDs of nodes that should execute next, based on the node's
     * runtime output. Only the "taken" branches are returned here.
     */
    private resolveNextNodes(
        nodeType: string,
        output: unknown,
        staticNext: string[]
    ): string[] {
        if (nodeType === 'condition') {
            const condOutput = output as ConditionNodeOutput;
            return condOutput.nextNodeId ? [condOutput.nextNodeId] : [];
        }

        if (nodeType === 'switch') {
            const switchOutput = output as SwitchNodeOutput;
            return switchOutput.nextNodeId ? [switchOutput.nextNodeId] : [];
        }

        return staticNext.filter(Boolean);
    }
}