/**
 * In-memory registry of short-lived "listen for webhook" capture sessions.
 *
 * When a user arms a capture from the node test panel, the next real inbound
 * webhook hit on that trigger node's URL is captured (not executed) and streamed
 * back over SSE. Sessions are keyed by `${workflowId}:${nodeId}`, auto-expire
 * after their TTL, and buffer the first captured payload so a hit that arrives
 * before the SSE subscription is not lost.
 *
 * State is process-local and non-persistent — acceptable for a ~60s transient
 * session (same constraint as the live execution SSE stream).
 */

export interface WebhookCaptureSession {
    captureId: string;
    /** Epoch milliseconds after which the session is no longer valid. */
    expiresAt: number;
    /** The first captured payload, buffered until the SSE consumer reads it. */
    capturedPayload: unknown | null;
}

interface InternalSession extends WebhookCaptureSession {
    timer: NodeJS.Timeout;
}

const DEFAULT_TTL_MS = 60_000;

class WebhookCaptureRegistry {
    private sessions = new Map<string, InternalSession>();

    private key(workflowId: string, nodeId: string): string {
        return `${workflowId}:${nodeId}`;
    }

    /** Arm a capture session, replacing any existing one for the same node. */
    arm(
        workflowId: string,
        nodeId: string,
        captureId: string,
        ttlMs: number = DEFAULT_TTL_MS,
    ): WebhookCaptureSession {
        this.clear(workflowId, nodeId);

        const key = this.key(workflowId, nodeId);
        const expiresAt = Date.now() + ttlMs;
        const timer = setTimeout(() => {
            this.sessions.delete(key);
        }, ttlMs);
        // Don't keep the event loop alive purely for a capture timeout.
        if (typeof timer.unref === 'function') timer.unref();

        const session: InternalSession = { captureId, expiresAt, capturedPayload: null, timer };
        this.sessions.set(key, session);
        return { captureId, expiresAt, capturedPayload: null };
    }

    /** Returns the armed session if present and not expired, else undefined. */
    get(workflowId: string, nodeId: string): WebhookCaptureSession | undefined {
        const key = this.key(workflowId, nodeId);
        const session = this.sessions.get(key);
        if (!session) return undefined;
        if (Date.now() > session.expiresAt) {
            this.clear(workflowId, nodeId);
            return undefined;
        }
        return { captureId: session.captureId, expiresAt: session.expiresAt, capturedPayload: session.capturedPayload };
    }

    /**
     * Record the first captured payload for an armed session. Returns true when a
     * matching armed session existed (i.e. the hit should be treated as captured).
     */
    markCaptured(workflowId: string, nodeId: string, payload: unknown): boolean {
        const key = this.key(workflowId, nodeId);
        const session = this.sessions.get(key);
        if (!session || Date.now() > session.expiresAt) return false;
        if (session.capturedPayload === null) session.capturedPayload = payload;
        return true;
    }

    /** Remove a session and cancel its expiry timer. Idempotent. */
    clear(workflowId: string, nodeId: string): void {
        const key = this.key(workflowId, nodeId);
        const session = this.sessions.get(key);
        if (session) {
            clearTimeout(session.timer);
            this.sessions.delete(key);
        }
    }
}

export const webhookCaptureRegistry = new WebhookCaptureRegistry();
