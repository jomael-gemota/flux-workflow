import crypto from 'crypto';
import { WorkflowModel } from '../db/models/WorkflowModel';
import { WorkflowVersionModel } from '../db/models/WorkflowVersionModel';
import { WorkflowDefinition } from '../types/workflow.types';
import { PaginatedResponse } from '../types/api.types';

export class WorkflowRepository {

    async create(
        workflow: WorkflowDefinition
    ): Promise<{ workflow: WorkflowDefinition; webhookSecret: string }> {
        const webhookSecret = crypto.randomBytes(32).toString('hex');

        await WorkflowModel.create({
            workflowId: workflow.id,
            name: workflow.name,
            version: workflow.version,
            definition: workflow,
            webhookSecret,
        });

        return { workflow, webhookSecret };
    }

    async update(
        id: string,
        updates: Partial<WorkflowDefinition>
    ): Promise<WorkflowDefinition | null> {
        const existing = await WorkflowModel.findOne({ workflowId: id });
        if (!existing) return null;

        // Use toObject() to get a guaranteed plain POJO from the Mongoose Mixed field,
        // avoiding any potential Mongoose document proxy quirks when spreading.
        const existingDef = existing.toObject().definition as WorkflowDefinition;

        await WorkflowVersionModel.create({
            workflowId: id,
            version: existing.version,
            definition: existingDef,
        });

        const merged: WorkflowDefinition = {
            ...existingDef,
            ...updates,
            id,
            version: existing.version + 1,
        };

        // If the update provides entryNodeId but no entryNodeIds, the stale
        // entryNodeIds from existingDef would silently survive the spread and
        // cause the runner to start from a deleted node.  Explicitly clear it
        // so the runner always falls back to the fresh entryNodeId.
        if (updates.entryNodeId && !updates.entryNodeIds) {
            delete merged.entryNodeIds;
        }

        const updated = merged;

        await WorkflowModel.updateOne(
            { workflowId: id },
            {
                $set: {
                name: updated.name,
                version: updated.version,
                definition: updated,
                },
            }
        );

        return updated;
    }

    async delete(id: string): Promise<boolean> {
        const result = await WorkflowModel.deleteOne({ workflowId: id });
        return result.deletedCount > 0;
    }

    async findById(id: string): Promise<WorkflowDefinition | null> {
        const doc = await WorkflowModel.findOne({ workflowId: id });
        return doc ? (doc.definition as WorkflowDefinition) : null;
    }

    async findWebhookSecret(id: string): Promise<string | null> {
        const doc = await WorkflowModel.findOne({ workflowId: id }).select('webhookSecret');
        return doc?.webhookSecret ?? null;
    }

    async findVersionHistory(id: string): Promise<WorkflowDefinition[]> {
        const versions = await WorkflowVersionModel
        .find({ workflowId: id })
        .sort({ version: -1 });
        return versions.map(v => v.definition as WorkflowDefinition);
    }

    async findAll(
        limit: number,
        cursor?: string
    ): Promise<PaginatedResponse<WorkflowDefinition>> {
        const query = cursor
            ? { createdAt: { $lt: new Date(cursor) } }
            : {};

        const docs = await WorkflowModel
            .find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1);

        const hasMore = docs.length > limit;
        const data = docs
            .slice(0, limit)
            .map(doc => doc.definition as WorkflowDefinition);

        const nextCursor = hasMore
            ? docs[limit - 1].createdAt.toISOString()
            : null;

        return { data, pagination: { hasMore, nextCursor, limit } };
    }

    async save(workflow: WorkflowDefinition): Promise<void> {
        const existing = await this.findById(workflow.id);
        if (existing) return;
        await this.create(workflow);
    }
}