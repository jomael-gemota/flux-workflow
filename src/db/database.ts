import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve(process.env.DB_PATH ?? './data/platform.db');

let db: Database.Database;

export function getDatabase(): Database.Database {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        runMigrations(db);
    }
    return db;
}

function runMigrations(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            definition TEXT NOT NULL,
            webhook_secret TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS executions (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            status TEXT NOT NULL,
            input TEXT,
            results TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_workflows_created_at ON workflows(created_at);
        CREATE INDEX IF NOT EXISTS idx_executions_started_at ON executions(started_at);
        CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions(workflow_id);
    `);
}