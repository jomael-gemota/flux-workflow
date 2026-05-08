import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Sparkles,
  Send,
  Loader2,
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  Link2,
  Check,
  RotateCcw,
  Lightbulb,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useFluxelleChat, useFluxelleStatus } from '../../hooks/useFluxelle';
import type { FluxelleMessage, WorkflowProposal, WorkflowSnapshot } from '../../types/fluxelle';
import type { NodeType } from '../../types/workflow';
import { NodeIcon } from '../nodes/NodeIcons';

const STARTER_PROMPTS: string[] = [
  'When a webhook fires, summarize the body with AI and post the summary to Slack.',
  'Every weekday at 9am, fetch yesterday\'s sales from an API and email a summary.',
  'When an urgent support email arrives, classify it with AI and route to the right Slack channel.',
  'Log every form submission as a row in a Google Sheet.',
];

export function FluxellePanel() {
  const status   = useFluxelleStatus();
  const chat     = useFluxelleChat();

  const nodes        = useWorkflowStore((s) => s.nodes);
  const edges        = useWorkflowStore((s) => s.edges);
  const activeWf     = useWorkflowStore((s) => s.activeWorkflow);
  const applyProposal = useWorkflowStore((s) => s.applyFluxelleProposal);

  const [messages, setMessages] = useState<FluxelleMessage[]>([]);
  const [input, setInput]       = useState('');
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const scrollRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages / loading state
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, chat.isPending]);

  // ── Workflow snapshot (compact) ──────────────────────────────────────────────
  const snapshot = useMemo<WorkflowSnapshot | null>(() => {
    if (!activeWf) return null;

    const workflowNodes = nodes.filter((n) => n.type !== 'stickyNote');
    const nextMap: Record<string, string[]> = {};
    for (const n of workflowNodes) nextMap[n.id] = [];
    for (const e of edges) {
      if (e.source && e.target && nextMap[e.source]) nextMap[e.source].push(e.target);
    }

    return {
      id:          activeWf.id,
      name:        activeWf.name,
      entryNodeId: activeWf.entryNodeId,
      nodes: workflowNodes.map((n) => ({
        id:            n.id,
        type:          n.data.nodeType as NodeType,
        name:          n.data.label,
        configPreview: shortJson(n.data.config),
        next:          nextMap[n.id] ?? [],
      })),
    };
  }, [nodes, edges, activeWf]);

  // ── Send a message ───────────────────────────────────────────────────────────

  async function send(content: string) {
    const text = content.trim();
    if (!text || chat.isPending) return;

    const userMsg: FluxelleMessage = {
      id:        randomId(),
      role:      'user',
      content:   text,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');

    try {
      const response = await chat.mutateAsync({
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        workflow: snapshot,
      });
      const assistantMsg: FluxelleMessage = {
        id:        randomId(),
        role:      'assistant',
        content:   response.content,
        proposal:  response.proposal,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: FluxelleMessage = {
        id:        randomId(),
        role:      'assistant',
        content:   `❌ ${err instanceof Error ? err.message : 'Something went wrong.'}`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  function handleApply(messageId: string, proposal: WorkflowProposal) {
    applyProposal(proposal);
    setAppliedIds((prev) => new Set(prev).add(messageId));
  }

  function resetConversation() {
    setMessages([]);
    setAppliedIds(new Set());
  }

  // ── Empty / not-configured states ────────────────────────────────────────────

  if (status.isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Connecting to Fluxelle…
      </div>
    );
  }

  if (status.data && !status.data.configured) {
    return (
      <div className="p-5 space-y-3 text-xs">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="font-semibold">Fluxelle is not configured</span>
        </div>
        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
          Set <code className="px-1 py-0.5 bg-black/[0.06] dark:bg-white/10 rounded text-[10.5px]">OPENAI_API_KEY</code> in
          your server <code className="px-1 py-0.5 bg-black/[0.06] dark:bg-white/10 rounded text-[10.5px]">.env</code> and
          restart Flux to enable the AI assistant.
        </p>
      </div>
    );
  }

  // ── Main UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">

      {/* Header */}
      <div className="px-3 py-2.5 border-b border-black/[0.07] dark:border-white/10 flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white leading-tight">Fluxelle</div>
          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-tight">
            Your in-canvas workflow assistant
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={resetConversation}
            title="Clear conversation"
            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && <EmptyState onPick={(p) => void send(p)} />}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            applied={appliedIds.has(m.id)}
            onApply={(p) => handleApply(m.id, p)}
          />
        ))}

        {chat.isPending && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Thinking…</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-black/[0.07] dark:border-white/10 p-2.5 shrink-0"
      >
        <div className="relative bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a workflow, or ask Fluxelle to edit this one…"
            rows={2}
            disabled={chat.isPending}
            className="w-full resize-none bg-transparent text-xs text-gray-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 px-2.5 py-2 pr-9 focus:outline-none rounded-lg disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || chat.isPending}
            className="absolute right-1.5 bottom-1.5 p-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Send (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 px-0.5">
          Fluxelle never edits the canvas without your approval.
        </p>
      </form>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="space-y-3 pt-2">
      <div className="text-center py-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center mx-auto shadow-md mb-3">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white">
          Hi, I'm Fluxelle.
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed px-2 mt-1">
          Tell me what you want to automate, and I'll wire up the nodes for you.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          <Lightbulb className="w-3 h-3" />
          Try one of these
        </div>
        {STARTER_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="w-full text-left text-[11px] leading-snug px-2.5 py-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-transparent hover:border-blue-300 dark:hover:border-blue-700 text-slate-700 dark:text-slate-300 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Message bubbles ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  applied,
  onApply,
}: {
  message: FluxelleMessage;
  applied: boolean;
  onApply: (proposal: WorkflowProposal) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] text-[11.5px] leading-snug bg-blue-600 text-white px-2.5 py-1.5 rounded-2xl rounded-br-md whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-3 h-3 text-white" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {message.content && (
          <div className="text-[11.5px] leading-snug text-gray-900 dark:text-slate-200 whitespace-pre-wrap">
            {message.content}
          </div>
        )}
        {message.proposal && (
          <ProposalCard
            proposal={message.proposal}
            applied={applied}
            onApply={() => onApply(message.proposal!)}
          />
        )}
      </div>
    </div>
  );
}

// ── Proposal diff card ────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  applied,
  onApply,
}: {
  proposal: WorkflowProposal;
  applied: boolean;
  onApply: () => void;
}) {
  const adds    = proposal.adds    ?? [];
  const updates = proposal.updates ?? [];
  const deletes = proposal.deletes ?? [];
  const edges   = proposal.edges   ?? [];

  const totalChanges = adds.length + updates.length + deletes.length;

  return (
    <div className="border border-violet-300/60 dark:border-violet-700/40 bg-violet-50/40 dark:bg-violet-950/20 rounded-lg overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-violet-200/60 dark:border-violet-800/40 bg-violet-100/40 dark:bg-violet-900/20 flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-violet-600 dark:text-violet-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
          Proposed changes · {totalChanges} {totalChanges === 1 ? 'edit' : 'edits'}
        </span>
      </div>

      <div className="p-2.5 space-y-1.5">
        {adds.map((n) => (
          <div key={`add-${n.id}`} className="flex items-start gap-2 text-[11px]">
            <Plus className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <NodeIcon type={n.type} size={11} />
                <span className="font-medium text-gray-900 dark:text-slate-200 truncate">
                  {n.name}
                </span>
                <span className="text-[9.5px] text-slate-500 dark:text-slate-400 font-mono">
                  {n.id}
                </span>
              </div>
            </div>
          </div>
        ))}

        {updates.map((u) => (
          <div key={`upd-${u.id}`} className="flex items-start gap-2 text-[11px]">
            <Pencil className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-gray-900 dark:text-slate-200">
                {u.name ?? `Update ${u.id}`}
              </span>
              <span className="ml-1.5 text-[9.5px] text-slate-500 dark:text-slate-400 font-mono">
                {u.id}
              </span>
            </div>
          </div>
        ))}

        {deletes.map((id) => (
          <div key={`del-${id}`} className="flex items-start gap-2 text-[11px]">
            <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <span className="font-mono text-[10.5px] text-slate-700 dark:text-slate-300">{id}</span>
          </div>
        ))}

        {edges.length > 0 && (
          <div className="pt-1 mt-1 border-t border-violet-200/40 dark:border-violet-800/30">
            <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Connections
            </div>
            {edges.map((e, i) => (
              <div key={i} className="flex items-center gap-1 text-[10.5px] text-slate-600 dark:text-slate-300">
                <Link2 className="w-2.5 h-2.5 text-violet-600 dark:text-violet-400" />
                <span className="font-mono">{e.from}</span>
                <span className="text-slate-400">→</span>
                <span className="font-mono">{e.to}</span>
                {e.label && (
                  <span className="ml-1 px-1 rounded bg-violet-200/50 dark:bg-violet-900/40 text-[9.5px] text-violet-700 dark:text-violet-300">
                    {e.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-2.5 py-1.5 border-t border-violet-200/60 dark:border-violet-800/40 bg-white/30 dark:bg-black/10 flex items-center justify-end">
        {applied ? (
          <div className="flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check className="w-3 h-3" />
            Applied
          </div>
        ) : (
          <button
            type="button"
            onClick={onApply}
            className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            <Check className="w-3 h-3" />
            Apply to canvas
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function shortJson(obj: unknown, max = 240): string {
  let s: string;
  try { s = JSON.stringify(obj); } catch { return '{ … }'; }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
