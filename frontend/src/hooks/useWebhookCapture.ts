import { useCallback, useEffect, useRef, useState } from 'react';
import { startWebhookCapture } from '../api/client';

function getAuthParam(): string {
  const jwt = localStorage.getItem('flux_auth_token');
  if (jwt) return `token=${encodeURIComponent(jwt)}`;
  const key = localStorage.getItem('wap_api_key');
  if (key) return `apiKey=${encodeURIComponent(key)}`;
  return '';
}

/** Full webhook-shaped payload captured from a real inbound hit. */
export interface CapturedWebhook {
  method: string;
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  receivedAt: string;
}

export type WebhookCaptureStatus = 'idle' | 'listening' | 'error';

interface UseWebhookCaptureOptions {
  onCaptured: (payload: CapturedWebhook) => void;
  onTimeout?: () => void;
}

/**
 * Arms a short-lived webhook capture session and streams the first real inbound
 * hit back over SSE — mirrors the EventSource pattern in `useExecutionStream`.
 * Always closes the EventSource on capture, timeout, cancel, and unmount.
 */
export function useWebhookCapture({ onCaptured, onTimeout }: UseWebhookCaptureOptions) {
  const [status, setStatus] = useState<WebhookCaptureStatus>('idle');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const teardown = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    teardown();
    setStatus('idle');
    setSecondsLeft(0);
  }, [teardown]);

  const start = useCallback(
    async (workflowId: string, nodeId: string) => {
      teardown();
      setError(null);

      const authParam = getAuthParam();
      if (!authParam) {
        setStatus('error');
        setError('Not authenticated');
        return;
      }

      let captureId: string;
      let expiresAt: number;
      try {
        const session = await startWebhookCapture(workflowId, nodeId);
        captureId = session.captureId;
        expiresAt = session.expiresAt;
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Failed to start capture');
        return;
      }

      setStatus('listening');
      setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));

      countdownRef.current = setInterval(() => {
        setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
      }, 1000);

      const es = new EventSource(
        `/api/workflows/${workflowId}/nodes/${nodeId}/webhook-capture/${captureId}/events?${authParam}`,
      );
      esRef.current = es;

      es.addEventListener('captured', (e: MessageEvent) => {
        let payload: CapturedWebhook | null = null;
        try {
          payload = JSON.parse(e.data) as CapturedWebhook;
        } catch {
          payload = null;
        }
        teardown();
        setStatus('idle');
        setSecondsLeft(0);
        if (payload) onCaptured(payload);
      });

      es.addEventListener('timeout', () => {
        teardown();
        setStatus('idle');
        setSecondsLeft(0);
        onTimeout?.();
      });

      es.onerror = () => {
        // The browser auto-reconnects on error; close to prevent loops. A clean
        // capture/timeout has already torn down, so this only fires on real drops.
        teardown();
        setStatus('idle');
        setSecondsLeft(0);
      };
    },
    [teardown, onCaptured, onTimeout],
  );

  useEffect(() => teardown, [teardown]);

  return { status, secondsLeft, error, start, cancel };
}
