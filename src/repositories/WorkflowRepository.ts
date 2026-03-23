import { getDatabase } from "../db/database";
import { WorkflowDefinition } from "../types/workflow.types";
import { PaginatedResponse } from "../types/api.types";
import crypto from 'crypto';

interface WorkflowRow {
    id: string;
    name: string;
    version: number;
    definition: string;
    webhook_secret: string;
    created_at: string;
    updated_at: string;
}

export class WorkflowRepository {
    private db = getDatabase();

    create(workflow: WorkflowDefinition): { workflow: WorkflowDefinition; webhookSecret: string } {
        const webhookSecret = crypto.randomBytes(32).toString('hex');

        this.db.prepare(`
            INSERT INTO workflows (id, name, version, definition, webhook_secret)
            VALUES (@id, @name, @version, @definition, @webhookSecret)
        `).run({
            id: workflow.id,
            name: workflow.name,
            version: workflow.version,
            definition: JSON.stringify(workflow),
            webhookSecret,
        });

        return { workflow, webhookSecret };
    }

    update(id: string, updates: Partial<WorkflowDefinition>): WorkflowDefinition | null {
        const existing = this.findById(id);
        if (!existing) return null;

        const updated: WorkflowDefinition = {
            ...existing,
            ...updates,
            id,
            version: existing.version + 1
        };

        this.db.prepare(`
            UPDATE workflows
            SET name = @name,
                version = @version,
                definition = @definition,
                updated_at = datetime('now)
            WHERE id = @id
        `).run({
            id,
            name: updated.name,
            version: updated.version,
            definition: JSON.stringify(updated),
        });

        return updated;
    }

    delete(id: string): boolean {
        const result = this.db
            .prepare('DELETE FROM workflows WHERE id = ?')
            .run(id);
        return result.changes > 0;
    }

    findById(id: string): WorkflowDefinition | null {
        const row = this.db
            .prepare('SELECT * FROM workflows WHERE id = ?')
            .get(id) as WorkflowRow | undefined;

        if (!row) return null;
        return JSON.parse(row.definition) as WorkflowDefinition;
    }

    findWebhookSecret(id: string): string | null {
        const row = this.db
            .prepare('SELECT webhook_secret FROM workflows WHERE id = ?')
            .get(id) as Pick<WorkflowRow, 'webhook_secret'> | undefined;

        return row?.webhook_secret ?? null;
    }

    findAll(limit: number, cursor?: string): PaginatedResponse<WorkflowDefinition> {
        const fetchLimit = limit + 1;

        const rows = cursor
            ? this.db.prepare(`
                SELECT * FROM workflows
                WHERE created_at < ?
                ORDER BY created_at DESC
                LIMIT ?
            `).all(cursor, fetchLimit) as WorkflowRow[]
        : this.db.prepare(`
                SELECT * FROM workflows
                ORDER BY created_at DESC
                LIMIT ?
            `).all(fetchLimit) as WorkflowRow[];

        const hasMore = rows.length > limit;
        const data = rows
            .slice(0, limit)
            .map(row => JSON.parse(row.definition) as WorkflowDefinition);

        const nextCursor = hasMore ? rows[limit - 1].created_at : null;

        return { data, pagination: { hasMore, nextCursor, limit } };
    }

    save(workflow: WorkflowDefinition): void {
        const existing = this.findById(workflow.id);
        if (existing) return;
        this.create(workflow);
    }
}