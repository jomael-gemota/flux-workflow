import { EventEmitter } from 'events';
import { NodeResult } from '../types/workflow.types';

export interface ExecutionCompleteEvent {
    executionId: string;
    workflowId: string;
    status: 'success' | 'partial' | 'failure';
}

class ExecutionEventBus extends EventEmitter {
    emitNodeResult(executionId: string, result: NodeResult): void {
        this.emit(`node:${executionId}`, result);
    }

    emitComplete(event: ExecutionCompleteEvent): void {
        this.emit(`complete:${event.executionId}`, event);
    }

    onNodeResult(executionId: string, listener: (result: NodeResult) => void): () => void {
        this.on(`node:${executionId}`, listener);
        return () => this.off(`node:${executionId}`, listener);
    }

    onComplete(executionId: string, listener: (event: ExecutionCompleteEvent) => void): () => void {
        this.on(`complete:${executionId}`, listener);
        return () => this.off(`complete:${executionId}`, listener);
    }

    emitWebhookCaptured(workflowId: string, nodeId: string, payload: unknown): void {
        this.emit(`webhook-capture:${workflowId}:${nodeId}`, payload);
    }

    onWebhookCaptured(workflowId: string, nodeId: string, listener: (payload: unknown) => void): () => void {
        const event = `webhook-capture:${workflowId}:${nodeId}`;
        this.on(event, listener);
        return () => this.off(event, listener);
    }
}

export const executionEventBus = new ExecutionEventBus();
executionEventBus.setMaxListeners(500);
