import { getDatabase } from "../db/database";
import { ExecutionSummary } from "../types/api.types";
import { PaginatedResponse } from "../types/api.types";

interface ExecutionRow {
    id: string;
    workflow_id: string;
    status: string;
    input: string;
    results: string;
    started_at: string;
    completed_at: string;
}

export class ExecutionRepository {
    private db = getDatabase();

    save(summary: ExecutionSummary): void {
        const stmt = this.db.prepare(`
            INSERT INTO executions (id, workflow_id, status, input, results, started_at, completed_at) VALUES (@id, @workflowId, @status, @input, @results, @startedAt, @completedAt)
        `);

        stmt.run({
            id: summary.executionId,
            workflowId: summary.workflowId,
            status: summary.status,
            input: JSON.stringify(summary.results),
            results: JSON.stringify(summary.results),
            startedAt: summary.startedAt.toISOString(),
            completedAt: summary.completedAt.toISOString(),
        });
    }

    findById(id: string): ExecutionSummary | null {
        const row = this.db
            .prepare('SELECT * FROM executions WHERE id = ?')
            .get(id) as ExecutionRow | undefined;

        if (!row) return null;
        return this.rowToSummary(row);
    }

    findByWorkflowId(workflowId: string): ExecutionSummary[] {
        const rows = this.db
        .prepare('SELECT * FROM executions WHERE workflow_id = ? ORDER BY started_at DESC')
        .all(workflowId) as ExecutionRow[];

        return rows.map(this.rowToSummary);
    }

    findByWorkflowIdPaginated(
        workflowId: string,
        limit: number,
        cursor?: string
    ): PaginatedResponse<ExecutionSummary> {
        const fetchLimit = limit + 1;

        const rows = cursor
            ? this.db.prepare(`
                SELECT * FROM executions
                WHERE workflow_id = ? AND started_at < ?
                ORDER BY started_at DESC
                LIMIT ?
              `).all(workflowId, cursor, fetchLimit) as ExecutionRow[]
            : this.db.prepare(`
                SELECT * FROM executions
                WHERE workflow_id = ?
                ORDER BY started_at DESC
                LIMIT ?
              `).all(workflowId, fetchLimit) as ExecutionRow[];

        const hasMore = rows.length > limit;
        const data = rows.slice(0, limit).map(this.rowToSummary);
        const nextCursor = hasMore ? rows[limit - 1].started_at : null;

        return { data, pagination: { hasMore, nextCursor, limit } };
    }

    private rowToSummary(row: ExecutionRow): ExecutionSummary {
        return {
        executionId: row.id,
        workflowId: row.workflow_id,
        status: row.status as ExecutionSummary['status'],
        results: JSON.parse(row.results),
        startedAt: new Date(row.started_at),
        completedAt: new Date(row.completed_at),
        };
    }
}