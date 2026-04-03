import crypto from 'crypto';
import { WorkflowModel } from '../db/models/WorkflowModel';
import { WorkflowVersionModel } from '../db/models/WorkflowVersionModel';
import { WorkflowDefinition } from '../types/workflow.types';
import { PaginatedResponse } from '../types/api.types';

/** Build a MongoDB filter that always matches on workflowId and optionally on userId */
function workflowFilter(id: string, userId?: string): Record<string, unknown> {
    const f: Record<string, unknown> = { workflowId: id };
    if (userId) f.userId = userId;
    return f;
}

/**
 * Stable hash of the content-significant parts of a workflow definition.
 * Excludes `version` (metadata) and `viewport` (view-only pan/zoom state)
 * so that saving those fields alone does not bump the version counter.
 */
function contentHash(def: WorkflowDefinition): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { version: _v, viewport: _vp, ...content } = def;
    return JSON.stringify(content);
}

export class WorkflowRepository {

    async create(
        workflow: WorkflowDefinition,
        userId?: string,
    ): Promise<{ workflow: WorkflowDefinition; webhookSecret: string }> {
        const webhookSecret = crypto.randomBytes(32).toString('hex');

        await WorkflowModel.create({
            workflowId: workflow.id,
            name:       workflow.name,
            version:    workflow.version,
            definition: workflow,
            webhookSecret,
            ...(userId ? { userId } : {}),
        });

        return { workflow, webhookSecret };
    }

    async update(
        id: string,
        updates: Partial<WorkflowDefinition>,
        userId?: string,
    ): Promise<WorkflowDefinition | null> {
        const existing = await WorkflowModel.findOne(workflowFilter(id, userId));
        if (!existing) return null;

        // Use toObject() to get a guaranteed plain POJO from the Mongoose Mixed field,
        // avoiding any potential Mongoose document proxy quirks when spreading.
        const existingDef = existing.toObject().definition as WorkflowDefinition;

        // Compute the candidate merged definition (version unchanged for now)
        const candidate: WorkflowDefinition = {
            ...existingDef,
            ...updates,
            id,
            version: existingDef.version,
        };

        // If the update provides entryNodeId but no entryNodeIds, the stale
        // entryNodeIds from existingDef would silently survive the spread and
        // cause the runner to start from a deleted node.  Explicitly clear it
        // so the runner always falls back to the fresh entryNodeId.
        if (updates.entryNodeId && !updates.entryNodeIds) {
            delete candidate.entryNodeIds;
        }

        // Only bump the version (and record a history snapshot) when something
        // meaningful actually changed.  Viewport-only saves (pan / zoom) are
        // persisted silently without touching the version counter.
        const contentChanged = contentHash(existingDef) !== contentHash(candidate);

        if (contentChanged) {
            await WorkflowVersionModel.create({
                workflowId: id,
                version: existingDef.version,
                definition: existingDef,
            });
            candidate.version = existingDef.version + 1;
        }

        await WorkflowModel.updateOne(
            { workflowId: id },
            {
                $set: {
                    name: candidate.name,
                    version: candidate.version,
                    definition: candidate,
                },
            },
        );

        return candidate;
    }

    async delete(id: string, userId?: string): Promise<boolean> {
        const result = await WorkflowModel.deleteOne(workflowFilter(id, userId));
        return result.deletedCount > 0;
    }

    async findById(id: string, userId?: string): Promise<WorkflowDefinition | null> {
        const doc = await WorkflowModel.findOne(workflowFilter(id, userId));
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
        cursor?: string,
        userId?: string,
    ): Promise<PaginatedResponse<WorkflowDefinition>> {
        const query: Record<string, unknown> = {};
        if (userId) query.userId = userId;
        if (cursor) query.createdAt = { $lt: new Date(cursor) };

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