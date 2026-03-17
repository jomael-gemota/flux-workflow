import { WorkflowDefinition, ExecutionContext, NodeResult, WorkflowExecutionResult } from "../types/workflow.types";
import { NodeExecutorRegistry } from './NodeExecutorRegistry';

export class WorkflowRunner {
    constructor(private registry: NodeExecutorRegistry) {}

    async run(workflow: WorkflowDefinition, input: unknown): Promise<WorkflowExecutionResult> {
        const context: ExecutionContext = {
            workflowId: workflow.id,
            executionId: crypto.randomUUID(),
            variables: { input },
            startedAt: new Date(),
        };

        const results: NodeResult[] = [];
        const visited = new Set<string>();
        await this.executeNode(workflow, workflow.entryNodeId, context, results, visited);

        return { executionId: context.executionId, results };
    }

    private async executeNode(
        workflow: WorkflowDefinition,
        nodeId: string,
        context: ExecutionContext,
        results: NodeResult[],
        visited: Set<string>
    ): Promise<void> {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found`);

        const executor = this.registry.get(node.type);
        const start = Date.now();

        try {
            const output = await executor.execute(node, context);
            context.variables[nodeId] = output;

            results.push({ nodeId, status: 'success', output, durationMs: Date.now() - start });

            await Promise.all(
                node.next.map(nextId => this.executeNode(workflow, nextId, context, results, visited))
            );
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ nodeId, status: 'failure', output: null, error: message, durationMs: Date.now() - start });
        }

    }
}