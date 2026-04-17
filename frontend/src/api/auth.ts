import type { AuthUser, UserRole, UserStatus } from '../types/auth';
import { useAuthStore } from '../store/authStore';

const BASE = '/api';

function authHeaders(): Record<string, string> {
    const token = useAuthStore.getState().getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers: {
            ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
            ...authHeaders(),
            ...(options.headers ?? {}),
        },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

/** Fetch the current user (refreshes JWT if needed) */
export async function fetchMe(): Promise<{ user: AuthUser; token: string }> {
    return request('/auth/me');
}

/** Redirect browser to Google's OAuth consent screen */
export function redirectToGoogleSignIn(): void {
    window.location.href = '/api/auth/google';
}

// ── Admin / Platform Owner ─────────────────────────────────────────────────

export interface AdminUser extends AuthUser { createdAt: string; }

export function listUsers(): Promise<AdminUser[]> {
    return request('/admin/users');
}

export function updateUser(
    id: string,
    patch: { status?: UserStatus; role?: UserRole },
): Promise<AdminUser> {
    return request(`/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });
}

export function deleteUser(id: string): Promise<{ deleted: boolean }> {
    return request(`/admin/users/${id}`, { method: 'DELETE' });
}

export function fetchAdminStats(): Promise<{ total: number; pending: number; approved: number }> {
    return request('/admin/stats');
}

// ── Surveillance ───────────────────────────────────────────────────────────

export type VulnSeverity = 'low' | 'medium' | 'high';

export interface Vulnerability {
    code: string;
    severity: VulnSeverity;
    message: string;
}

export interface SurveillanceOwner {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
    role: string;
}

export interface SurveillanceExecStatus {
    isRunning: boolean;
    lastExecution: {
        executionId: string;
        status: string;
        startedAt: string;
        completedAt: string | null;
        triggeredBy: string;
    } | null;
    successRate: number | null;
    totalRuns: number;
    recentFailures: number;
}

export interface SurveillanceScheduleTask {
    nodeId: string;
    cronExpression: string;
    nextRun: string | null;
}

export interface SurveillanceWorkflow {
    workflowId: string;
    name: string;
    version: number;
    nodeCount: number;
    createdAt: string;
    updatedAt: string;
    owner: SurveillanceOwner | null;
    execStatus: SurveillanceExecStatus;
    schedule: { tasks: SurveillanceScheduleTask[] } | null;
    vulnerabilities: Vulnerability[];
    triggerTypes: string[];
}

export interface SurveillanceSummary {
    totalWorkflows: number;
    runningNow: number;
    scheduledActive: number;
    withIssues: number;
}

export interface SurveillanceResponse {
    workflows: SurveillanceWorkflow[];
    total: number;
    page: number;
    pages: number;
    summary: SurveillanceSummary;
}

export function fetchSurveillance(params: {
    page?: number;
    limit?: number;
    search?: string;
    filter?: 'all' | 'running' | 'scheduled' | 'issues';
}): Promise<SurveillanceResponse> {
    const qs = new URLSearchParams();
    if (params.page   != null) qs.set('page',   String(params.page));
    if (params.limit  != null) qs.set('limit',  String(params.limit));
    if (params.search)         qs.set('search', params.search);
    if (params.filter)         qs.set('filter', params.filter);
    return request(`/admin/surveillance?${qs.toString()}`);
}
