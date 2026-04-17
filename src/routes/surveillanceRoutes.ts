import type { FastifyInstance } from 'fastify';
import { CronExpressionParser } from 'cron-parser';
import { WorkflowModel } from '../db/models/WorkflowModel';
import { ExecutionModel } from '../db/models/ExecutionModel';
import { UserModel } from '../db/models/UserModel';
import type { JwtPayload } from '../types/auth.types';
import type { WorkflowScheduler } from '../scheduler/WorkflowScheduler';
import type { WorkflowNode } from '../types/workflow.types';

export interface SurveillanceRouteOptions {
    scheduler: WorkflowScheduler;
}

// ── Vulnerability analysis ─────────────────────────────────────────────────

type VulnSeverity = 'low' | 'medium' | 'high';

interface Vulnerability {
    code: string;
    severity: VulnSeverity;
    message: string;
}

function analyzeVulnerabilities(
    nodes: WorkflowNode[],
    recentExecs: Array<{ status: string; startedAt: Date; completedAt?: Date }>,
): Vulnerability[] {
    const vulns: Vulnerability[] = [];

    if (!nodes || nodes.length === 0) {
        vulns.push({ code: 'NO_NODES', severity: 'high', message: 'Workflow has no nodes defined.' });
        return vulns;
    }

    const hasTrigger = nodes.some((n) => n.type === 'trigger');
    if (!hasTrigger) {
        vulns.push({ code: 'NO_TRIGGER', severity: 'medium', message: 'No trigger node found — workflow cannot be auto-started.' });
    }

    // HTTP nodes without auth method
    const httpNoAuth = nodes.filter(
        (n) => n.type === 'http' &&
            !n.disabled &&
            !(n.config as Record<string, unknown>).authType &&
            !(n.config as Record<string, unknown>).authMethod,
    );
    if (httpNoAuth.length > 0) {
        vulns.push({
            code: 'HTTP_NO_AUTH',
            severity: 'medium',
            message: `${httpNoAuth.length} HTTP node(s) have no authentication configured.`,
        });
    }

    // Execution health
    if (recentExecs.length === 0) {
        vulns.push({ code: 'NEVER_RUN', severity: 'low', message: 'This workflow has never been executed.' });
    } else {
        const finished = recentExecs.filter((e) => e.status === 'success' || e.status === 'failure' || e.status === 'partial');
        if (finished.length > 0) {
            const failures = finished.filter((e) => e.status === 'failure').length;
            const rate = (failures / finished.length) * 100;
            if (rate >= 75) {
                vulns.push({ code: 'HIGH_FAILURE_RATE', severity: 'high', message: `${Math.round(rate)}% failure rate in the last ${finished.length} completed run(s).` });
            } else if (rate >= 40) {
                vulns.push({ code: 'ELEVATED_FAILURE_RATE', severity: 'medium', message: `${Math.round(rate)}% failure rate in the last ${finished.length} completed run(s).` });
            }
        }

        // Stalled executions (running for > 30 minutes)
        const now = Date.now();
        const stalled = recentExecs.filter(
            (e) => e.status === 'running' && now - new Date(e.startedAt).getTime() > 30 * 60 * 1000,
        );
        if (stalled.length > 0) {
            vulns.push({ code: 'STALLED_EXECUTION', severity: 'high', message: `${stalled.length} execution(s) have been running for over 30 minutes.` });
        }

        // Stale — no execution in 30+ days
        const last = recentExecs[0];
        const daysSince = (now - new Date(last.startedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince > 30) {
            vulns.push({ code: 'STALE_WORKFLOW', severity: 'low', message: `Last execution was ${Math.round(daysSince)} days ago.` });
        }
    }

    return vulns;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getNextCronRun(expr: string): string | null {
    try {
        const interval = CronExpressionParser.parse(expr);
        return interval.next().toISOString();
    } catch {
        return null;
    }
}

async function ownerOnly(req: any, reply: any) {
    await req.jwtVerify();
    const user = req.user as JwtPayload;
    if (user.role !== 'owner') {
        reply.code(403).send({ message: 'Platform Owner access required' });
    }
}

// ── Routes ─────────────────────────────────────────────────────────────────

export async function surveillanceRoutes(
    fastify: FastifyInstance,
    opts: SurveillanceRouteOptions,
) {
    const { scheduler } = opts;

    /**
     * GET /api/admin/surveillance
     * Returns paginated workflow surveillance data for the platform owner.
     * Query params: page (1-based), limit, search, filter (all|running|scheduled|issues)
     */
    fastify.get<{
        Querystring: {
            page?: string;
            limit?: string;
            search?: string;
            filter?: 'all' | 'running' | 'scheduled' | 'issues';
        };
    }>(
        '/admin/surveillance',
        { preHandler: [ownerOnly] },
        async (req) => {
            const page   = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1);
            const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
            const search = (req.query.search ?? '').trim().toLowerCase();
            const filter = req.query.filter ?? 'all';

            // --- Load all workflows (we filter in-memory for vulnerability counts; pagination after) ---
            const allWorkflows = await WorkflowModel.find().sort({ updatedAt: -1 }).lean();

            // --- Scheduled task map: workflowId → tasks[] ---
            const scheduledTasks = scheduler.getScheduledTasks();
            const scheduleMap = new Map<string, Array<{ nodeId: string; cronExpression: string; nextRun: string | null }>>();
            for (const task of scheduledTasks) {
                if (!scheduleMap.has(task.workflowId)) scheduleMap.set(task.workflowId, []);
                scheduleMap.get(task.workflowId)!.push({
                    nodeId: task.nodeId,
                    cronExpression: task.cronExpression,
                    nextRun: getNextCronRun(task.cronExpression),
                });
            }

            // --- Currently running executions set ---
            const runningExecs = await ExecutionModel.find({ status: 'running' }, { workflowId: 1 }).lean();
            const runningSet = new Set(runningExecs.map((e) => e.workflowId));

            // --- Bulk-fetch last 20 executions per workflow (aggregate) ---
            const workflowIds = allWorkflows.map((w) => w.workflowId);
            const recentExecsDocs = await ExecutionModel.aggregate([
                { $match: { workflowId: { $in: workflowIds } } },
                { $sort: { startedAt: -1 } },
                {
                    $group: {
                        _id: '$workflowId',
                        executions: { $push: { status: '$status', startedAt: '$startedAt', completedAt: '$completedAt', triggeredBy: '$triggeredBy', executionId: '$executionId' } },
                    },
                },
                { $project: { executions: { $slice: ['$executions', 20] } } },
            ]);
            const execMap = new Map<string, Array<{ status: string; startedAt: Date; completedAt?: Date; triggeredBy: string; executionId: string }>>();
            for (const doc of recentExecsDocs) {
                execMap.set(doc._id as string, doc.executions);
            }

            // --- User map: userId → user info ---
            const userIds = [...new Set(allWorkflows.map((w) => w.userId).filter(Boolean))] as string[];
            const users = await UserModel.find({ _id: { $in: userIds } }, { name: 1, email: 1, avatar: 1, role: 1 }).lean();
            const userMap = new Map(users.map((u) => [u._id.toString(), u]));

            // --- Build enriched entries ---
            const entries = allWorkflows.map((wf) => {
                const nodes = (wf.definition?.nodes ?? []) as WorkflowNode[];
                const recentExecs = execMap.get(wf.workflowId) ?? [];
                const tasks = scheduleMap.get(wf.workflowId) ?? [];
                const isRunning = runningSet.has(wf.workflowId);
                const isScheduled = tasks.length > 0;

                // Owner info
                const owner = wf.userId ? userMap.get(wf.userId) ?? null : null;

                // Execution stats
                const lastExec = recentExecs[0] ?? null;
                const finished = recentExecs.filter((e) => e.status === 'success' || e.status === 'failure' || e.status === 'partial');
                const successRate = finished.length > 0
                    ? Math.round((finished.filter((e) => e.status === 'success').length / finished.length) * 100)
                    : null;

                // Vulnerabilities
                const vulnerabilities = analyzeVulnerabilities(nodes, recentExecs);

                // Trigger types
                const triggerNodes = nodes.filter((n) => n.type === 'trigger');
                const triggerTypes = [...new Set(triggerNodes.map((n) => (n.config as Record<string, unknown>).triggerType as string).filter(Boolean))];

                return {
                    workflowId:  wf.workflowId,
                    name:        wf.name,
                    version:     wf.version,
                    nodeCount:   nodes.length,
                    createdAt:   wf.createdAt,
                    updatedAt:   wf.updatedAt,
                    owner: owner ? {
                        id:     wf.userId!,
                        name:   owner.name ?? '—',
                        email:  owner.email,
                        avatar: owner.avatar ?? null,
                        role:   owner.role,
                    } : null,
                    execStatus: {
                        isRunning,
                        lastExecution: lastExec ? {
                            executionId: lastExec.executionId,
                            status:      lastExec.status,
                            startedAt:   lastExec.startedAt,
                            completedAt: lastExec.completedAt ?? null,
                            triggeredBy: lastExec.triggeredBy,
                        } : null,
                        successRate,
                        totalRuns: recentExecs.length,
                        recentFailures: recentExecs.filter((e) => e.status === 'failure').length,
                    },
                    schedule: isScheduled ? { tasks } : null,
                    vulnerabilities,
                    triggerTypes,
                };
            });

            // --- Filter ---
            const filtered = entries.filter((e) => {
                if (search && !e.name.toLowerCase().includes(search) &&
                    !e.owner?.email.toLowerCase().includes(search) &&
                    !e.owner?.name.toLowerCase().includes(search) &&
                    !e.workflowId.toLowerCase().includes(search)
                ) return false;

                if (filter === 'running')   return e.execStatus.isRunning;
                if (filter === 'scheduled') return e.schedule !== null;
                if (filter === 'issues')    return e.vulnerabilities.length > 0;
                return true;
            });

            // --- Summary counts (always across all workflows, ignoring active filter) ---
            const summary = {
                totalWorkflows: allWorkflows.length,
                runningNow:     entries.filter((e) => e.execStatus.isRunning).length,
                scheduledActive: entries.filter((e) => e.schedule !== null).length,
                withIssues:     entries.filter((e) => e.vulnerabilities.length > 0).length,
            };

            // --- Paginate ---
            const total = filtered.length;
            const pages = Math.max(1, Math.ceil(total / limit));
            const paginated = filtered.slice((page - 1) * limit, page * limit);

            return { workflows: paginated, total, page, pages, summary };
        },
    );
}
