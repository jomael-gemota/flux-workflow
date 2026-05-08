import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
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
  X,
  RotateCcw,
  Lightbulb,
  History,
  ArrowLeft,
  MessageSquare,
  Clock,
  HelpCircle,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import {
  useFluxelleChat,
  useFluxelleStatus,
  useConversations,
  useCreateConversation,
  useUpdateConversation,
  useDeleteConversation,
} from '../../hooks/useFluxelle';
import * as api from '../../api/client';
import type {
  FluxelleMessage,
  FluxelleQuestion,
  QuestionAnswer,
  WorkflowProposal,
  WorkflowSnapshot,
  ConversationSummary,
  ConversationDetail,
  PersistedMessage,
} from '../../types/fluxelle';
import type { NodeType } from '../../types/workflow';
import { NodeIcon } from '../nodes/NodeIcons';

const STARTER_PROMPTS: string[] = [
  'When a webhook fires, summarize the body with AI and post the summary to Slack.',
  'Every weekday at 9am, fetch yesterday\'s sales from an API and email a summary.',
  'When an urgent support email arrives, classify it with AI and route to the right Slack channel.',
  'Log every form submission as a row in a Google Sheet.',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function shortJson(obj: unknown, max = 240): string {
  let s: string;
  try { s = JSON.stringify(obj); } catch { return '{ … }'; }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Derive a title from the first user message. */
function titleFromMessage(content: string): string {
  return content.length > 80 ? content.slice(0, 77) + '…' : content;
}

/** Convert in-memory FluxelleMessage[] → PersistedMessage[] for the API. */
function toPersistedMessages(msgs: FluxelleMessage[]): PersistedMessage[] {
  return msgs.map((m) => ({
    role:           m.role,
    content:        m.content,
    proposal:       m.proposal ?? null,
    proposalStatus: m.proposalStatus ?? null,
    question:       m.question ?? null,
    questionAnswer: m.questionAnswer ?? null,
    createdAt:      m.createdAt,
  }));
}

/** Convert PersistedMessage[] back to in-memory FluxelleMessage[]. */
function fromPersistedMessages(msgs: PersistedMessage[]): FluxelleMessage[] {
  return msgs.map((m) => ({
    id:             randomId(),
    role:           m.role,
    content:        m.content,
    proposal:       m.proposal ?? undefined,
    proposalStatus: m.proposalStatus ?? undefined,
    question:       m.question ?? undefined,
    questionAnswer: m.questionAnswer ?? undefined,
    createdAt:      m.createdAt,
  }));
}

/** Render a human-readable summary of the user's answer to a question. */
function describeAnswer(question: FluxelleQuestion, answer: QuestionAnswer): string {
  const labels = answer.selectedOptionIds
    .map((id) => question.options.find((o) => o.id === id)?.label ?? id)
    .filter(Boolean);
  const parts = [labels.join(', ')];
  if (answer.freeText && answer.freeText.trim().length > 0) {
    parts.push(`"${answer.freeText.trim()}"`);
  }
  return parts.filter(Boolean).join(' — ');
}

// ── Main component ────────────────────────────────────────────────────────────

type PanelView = 'chat' | 'history';

export function FluxellePanel() {
  const status   = useFluxelleStatus();
  const chat     = useFluxelleChat();
  const convList = useConversations();
  const createConv  = useCreateConversation();
  const updateConv  = useUpdateConversation();
  const deleteConv  = useDeleteConversation();

  const nodes         = useWorkflowStore((s) => s.nodes);
  const edges         = useWorkflowStore((s) => s.edges);
  const activeWf      = useWorkflowStore((s) => s.activeWorkflow);
  const applyProposal = useWorkflowStore((s) => s.applyFluxelleProposal);

  // ── Local state ──────────────────────────────────────────────────────────────
  const [view, setView]         = useState<PanelView>('chat');
  const [messages, setMessages] = useState<FluxelleMessage[]>([]);
  const [input, setInput]       = useState('');
  /** conversationId of the currently active (auto-saved) conversation. */
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const scrollRef    = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  /** While a create-conversation request is in flight we have no conv id yet,
   *  so apply / decline saves must wait for it to resolve. We park the in-flight
   *  promise here and chain follow-up updates onto it. */
  const createConvPromiseRef = useRef<Promise<ConversationDetail> | null>(null);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, chat.isPending]);

  // ── Workflow snapshot ────────────────────────────────────────────────────────
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

  /** Tracks the in-flight conversation load so a fast-switching user can't
   *  have an older request overwrite a newer one's results. */
  const loadingConvIdRef = useRef<string | null>(null);
  const [isLoadingConv, setIsLoadingConv] = useState(false);

  // ── Persistence helper ───────────────────────────────────────────────────────

  /**
   * Save the given message list to the conversation.
   *  - If a conversation already exists, PATCH it.
   *  - If a create is in flight, wait for it to resolve, then PATCH.
   *  - Otherwise this is a no-op (caller must ensure a create has been started).
   */
  async function persistMessages(updatedMessages: FluxelleMessage[]) {
    const persisted = toPersistedMessages(updatedMessages);

    let convId = activeConvId;
    if (!convId && createConvPromiseRef.current) {
      try {
        const conv = await createConvPromiseRef.current;
        convId = conv.conversationId;
      } catch {
        return; // create failed, nothing to update
      }
    }
    if (!convId) return;

    updateConv.mutate({ id: convId, body: { messages: persisted } });
  }

  // ── Send a message ───────────────────────────────────────────────────────────
  /**
   * Append a user turn (free-text OR a structured question reply) and call the
   * chat endpoint. Pass `extras` when the user reply is the answer to a previous
   * question — we use it to mark that prior assistant message as answered.
   */
  async function send(
    content: string,
    extras?: {
      /** Id of the assistant message whose `question` is being answered. */
      answersMessageId?: string;
      /** The structured answer (selected option ids + optional free text). */
      answer?: QuestionAnswer;
    },
  ) {
    const text = content.trim();
    if (!text || chat.isPending) return;

    const userMsg: FluxelleMessage = {
      id:        randomId(),
      role:      'user',
      content:   text,
      createdAt: new Date().toISOString(),
    };

    // If the user is answering a previous question, stamp the answer on that
    // assistant message so the QuestionCard renders as resolved.
    const baseMessages = extras?.answersMessageId && extras.answer
      ? messages.map((m) =>
          m.id === extras.answersMessageId
            ? { ...m, questionAnswer: extras.answer }
            : m,
        )
      : messages;

    const nextMessages = [...baseMessages, userMsg];
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
        question:  response.question,
        createdAt: new Date().toISOString(),
      };
      const allMessages = [...nextMessages, assistantMsg];
      setMessages(allMessages);

      // ── Auto-save ────────────────────────────────────────────────────────────
      const persisted = toPersistedMessages(allMessages);
      if (!activeConvId && !createConvPromiseRef.current) {
        // First turn — create a new conversation record. Park the promise so
        // any apply/decline that happens before it resolves can chain a PATCH.
        const title = titleFromMessage(text);
        const promise = createConv.mutateAsync({
          title,
          workflowId:   activeWf?.id,
          workflowName: activeWf?.name,
          messages:     persisted,
        });
        createConvPromiseRef.current = promise;
        promise
          .then((conv) => { setActiveConvId(conv.conversationId); })
          .finally(() => { createConvPromiseRef.current = null; });
      } else {
        await persistMessages(allMessages);
      }
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

  /**
   * Called by the QuestionCard once the user picks one or more options.
   * Builds a friendly text representation, marks the assistant message as
   * answered, then sends the next chat turn so Fluxelle can continue.
   */
  function handleAnswerQuestion(
    messageId: string,
    question: FluxelleQuestion,
    answer: QuestionAnswer,
  ) {
    const summary = describeAnswer(question, answer);
    void send(summary, { answersMessageId: messageId, answer });
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

  /** Mark a message's proposal as applied AND apply it to the canvas. */
  function handleApply(messageId: string, proposal: WorkflowProposal) {
    applyProposal(proposal);
    const updated = messages.map((m) =>
      m.id === messageId ? { ...m, proposalStatus: 'applied' as const } : m,
    );
    setMessages(updated);
    void persistMessages(updated);
  }

  /** Mark a message's proposal as declined — no canvas changes are made. */
  function handleDecline(messageId: string) {
    const updated = messages.map((m) =>
      m.id === messageId ? { ...m, proposalStatus: 'declined' as const } : m,
    );
    setMessages(updated);
    void persistMessages(updated);
  }

  function startNewConversation() {
    loadingConvIdRef.current = null;
    createConvPromiseRef.current = null;
    setIsLoadingConv(false);
    setMessages([]);
    setActiveConvId(null);
    setView('chat');
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function loadConversation(conv: ConversationSummary) {
    setView('chat');
    setActiveConvId(conv.conversationId);
    setMessages([]);
    createConvPromiseRef.current = null;

    loadingConvIdRef.current = conv.conversationId;
    setIsLoadingConv(true);
    try {
      const detail = await api.getConversation(conv.conversationId);
      // Drop the result if the user already moved on to another conversation.
      if (loadingConvIdRef.current !== conv.conversationId) return;
      setMessages(fromPersistedMessages(detail.messages));
    } catch (err) {
      if (loadingConvIdRef.current !== conv.conversationId) return;
      setMessages([{
        id:        randomId(),
        role:      'assistant',
        content:   `❌ Couldn't load this conversation: ${err instanceof Error ? err.message : 'unknown error'}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      if (loadingConvIdRef.current === conv.conversationId) {
        setIsLoadingConv(false);
      }
    }
  }

  function handleDeleteConversation(convId: string) {
    deleteConv.mutate(convId, {
      onSuccess: () => {
        if (activeConvId === convId) {
          startNewConversation();
        }
      },
    });
  }

  // ── Not-configured states ────────────────────────────────────────────────────
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

  // ── History view ─────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-black/[0.07] dark:border-white/10 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setView('chat')}
            className="p-1 rounded-md text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Back to chat"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white leading-tight">
              Chat History
            </div>
            <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-tight">
              {convList.data?.length ?? 0} conversation{(convList.data?.length ?? 0) !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={startNewConversation}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[10.5px] font-semibold transition-colors"
            title="New conversation"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto py-1.5">
          {convList.isLoading && (
            <div className="flex items-center justify-center py-8 text-slate-400 text-xs gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading…
            </div>
          )}

          {!convList.isLoading && (convList.data?.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4 gap-2">
              <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                No saved conversations yet.
                <br />Start a chat and it will appear here.
              </p>
            </div>
          )}

          {convList.data?.map((conv) => (
            <ConversationRow
              key={conv.conversationId}
              conv={conv}
              isActive={conv.conversationId === activeConvId}
              onOpen={() => loadConversation(conv)}
              onDelete={() => handleDeleteConversation(conv.conversationId)}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Chat view ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-black/[0.07] dark:border-white/10 flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white leading-tight">Fluxelle</div>
          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-tight">
            {activeConvId
              ? (convList.data?.find((c) => c.conversationId === activeConvId)?.title ?? 'Conversation')
              : 'Your in-canvas workflow assistant'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={startNewConversation}
              title="New conversation"
              className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setView('history')}
            title="Chat history"
            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <History className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {isLoadingConv && (
          <div className="flex items-center justify-center py-8 text-slate-400 dark:text-slate-500 text-xs gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading conversation…
          </div>
        )}

        {!isLoadingConv && messages.length === 0 && <EmptyState onPick={(p) => void send(p)} />}

        {!isLoadingConv && messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onApply={(p) => handleApply(m.id, p)}
            onDecline={() => handleDecline(m.id)}
            onAnswerQuestion={(q, a) => handleAnswerQuestion(m.id, q, a)}
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

// ── History row ───────────────────────────────────────────────────────────────

function ConversationRow({
  conv,
  isActive,
  onOpen,
  onDelete,
}: {
  conv:     ConversationSummary;
  isActive: boolean;
  onOpen:   () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
        isActive
          ? 'bg-violet-50 dark:bg-violet-950/30'
          : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
      }`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-3 h-3 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11.5px] font-medium text-gray-900 dark:text-slate-200 truncate leading-snug">
          {conv.title}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {conv.workflowName && (
            <span className="text-[9.5px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium truncate max-w-[80px]">
              {conv.workflowName}
            </span>
          )}
          <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
            <Clock className="w-2.5 h-2.5" />
            {formatRelativeTime(conv.updatedAt)}
          </div>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            · {conv.messageCount} msg{conv.messageCount !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all shrink-0 mt-0.5"
        title="Delete conversation"
      >
        <Trash2 className="w-3 h-3" />
      </button>
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
  onApply,
  onDecline,
  onAnswerQuestion,
}: {
  message:          FluxelleMessage;
  onApply:          (proposal: WorkflowProposal) => void;
  onDecline:        () => void;
  onAnswerQuestion: (question: FluxelleQuestion, answer: QuestionAnswer) => void;
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
        {message.question && (
          <QuestionCard
            question={message.question}
            answer={message.questionAnswer}
            onAnswer={(a) => onAnswerQuestion(message.question!, a)}
          />
        )}
        {message.proposal && (
          <ProposalCard
            proposal={message.proposal}
            status={message.proposalStatus}
            onApply={() => onApply(message.proposal!)}
            onDecline={onDecline}
          />
        )}
      </div>
    </div>
  );
}

// ── Question card (Claude-style selectable options) ──────────────────────────

function QuestionCard({
  question,
  answer,
  onAnswer,
}: {
  question: FluxelleQuestion;
  answer?:  QuestionAnswer;
  onAnswer: (answer: QuestionAnswer) => void;
}) {
  const [picked, setPicked]     = useState<string[]>([]);
  const [freeText, setFreeText] = useState('');
  const isAnswered = !!answer;
  const isMulti    = !!question.allowMultiple;

  function pickedLabels(): string[] {
    if (!answer) return [];
    return answer.selectedOptionIds
      .map((id) => question.options.find((o) => o.id === id)?.label ?? id)
      .filter(Boolean);
  }

  function toggle(id: string) {
    if (isAnswered) return;
    if (isMulti) {
      setPicked((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);
      return;
    }
    // Single-select: clicking an option commits the answer immediately.
    onAnswer({
      selectedOptionIds: [id],
      ...(freeText.trim() ? { freeText: freeText.trim() } : {}),
    });
  }

  function confirm() {
    if (isAnswered) return;
    if (picked.length === 0 && !freeText.trim()) return;
    onAnswer({
      selectedOptionIds: picked,
      ...(freeText.trim() ? { freeText: freeText.trim() } : {}),
    });
  }

  return (
    <div className="border border-blue-300/60 dark:border-blue-700/40 bg-blue-50/40 dark:bg-blue-950/20 rounded-lg overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-blue-200/60 dark:border-blue-800/40 bg-blue-100/40 dark:bg-blue-900/20 flex items-center gap-1.5">
        <HelpCircle className="w-3 h-3 text-blue-600 dark:text-blue-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
          Fluxelle needs your input
        </span>
      </div>

      <div className="p-2.5 space-y-2">
        <div className="text-[11.5px] leading-snug font-medium text-gray-900 dark:text-slate-100">
          {question.prompt}
        </div>
        {question.helperText && (
          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">
            {question.helperText}
          </div>
        )}

        <div className="space-y-1">
          {question.options.map((opt) => {
            const isPicked = isAnswered
              ? answer!.selectedOptionIds.includes(opt.id)
              : picked.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                disabled={isAnswered}
                onClick={() => toggle(opt.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-md border transition-colors flex items-start gap-2 ${
                  isPicked
                    ? 'border-blue-400 dark:border-blue-500 bg-blue-100/70 dark:bg-blue-900/40'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                } ${isAnswered ? 'cursor-default opacity-90' : 'cursor-pointer'}`}
              >
                {isMulti && (
                  <span
                    className={`mt-0.5 w-3 h-3 rounded border flex items-center justify-center shrink-0 ${
                      isPicked
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                    }`}
                  >
                    {isPicked && <Check className="w-2.5 h-2.5 text-white" />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-medium text-gray-900 dark:text-slate-200 leading-snug">
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5 truncate">
                      {opt.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {question.allowFreeText && !isAnswered && (
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="Or type a custom answer…"
            className="w-full text-[11px] px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        )}
      </div>

      {!isAnswered && (isMulti || question.allowFreeText) && (
        <div className="px-2.5 py-1.5 border-t border-blue-200/60 dark:border-blue-800/40 bg-white/30 dark:bg-black/10 flex items-center justify-end">
          <button
            type="button"
            onClick={confirm}
            disabled={picked.length === 0 && !freeText.trim()}
            className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Check className="w-3 h-3" />
            Send answer
          </button>
        </div>
      )}

      {isAnswered && (
        <div className="px-2.5 py-1.5 border-t border-blue-200/60 dark:border-blue-800/40 bg-white/30 dark:bg-black/10 flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
          <Check className="w-3 h-3" />
          You answered: {pickedLabels().join(', ') || '—'}
          {answer?.freeText && <span className="text-slate-500 dark:text-slate-400 font-normal">— "{answer.freeText}"</span>}
        </div>
      )}
    </div>
  );
}

// ── Proposal diff card ────────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  status,
  onApply,
  onDecline,
}: {
  proposal:  WorkflowProposal;
  status?:   'applied' | 'declined';
  onApply:   () => void;
  onDecline: () => void;
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

      <div className="px-2.5 py-1.5 border-t border-violet-200/60 dark:border-violet-800/40 bg-white/30 dark:bg-black/10 flex items-center justify-end gap-2">
        {status === 'applied' && (
          <div className="flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check className="w-3 h-3" />
            Applied
          </div>
        )}
        {status === 'declined' && (
          <div className="flex items-center gap-1 text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">
            <X className="w-3 h-3" />
            Declined
          </div>
        )}
        {!status && (
          <>
            <button
              type="button"
              onClick={onDecline}
              className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              title="Dismiss this proposal without changing the canvas"
            >
              <X className="w-3 h-3" />
              Decline
            </button>
            <button
              type="button"
              onClick={onApply}
              className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              <Check className="w-3 h-3" />
              Apply to canvas
            </button>
          </>
        )}
      </div>
    </div>
  );
}
