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
  SquarePen,
  Lightbulb,
  History,
  ArrowLeft,
  MessageSquare,
  Clock,
  HelpCircle,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  Zap,
  ChevronDown,
  Search,
  BookOpen,
  Database,
  Cpu,
  FileText,
  ListChecks,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useSaveWorkflow } from '../../hooks/useSaveWorkflow';
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
  FluxelleModelId,
  FluxelleQuestion,
  FluxelleTraceStep,
  QuestionAnswer,
  WorkflowProposal,
  WorkflowSnapshot,
  ConversationSummary,
  ConversationDetail,
  PersistedMessage,
} from '../../types/fluxelle';
import { FLUXELLE_MODELS } from '../../types/fluxelle';
import type { NodeType } from '../../types/workflow';
import { NodeIcon } from '../nodes/NodeIcons';
import { FluxelleMarkdown } from './FluxelleMarkdown';

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
    trace:          m.trace ?? null,
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
    trace:          m.trace ?? undefined,
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
  const { save: saveWorkflow } = useSaveWorkflow();

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
  const [selectedModel, setSelectedModel] = useState<FluxelleModelId>(() => {
    const stored = localStorage.getItem('fluxelle:model');
    return (stored === 'gpt-5.5' || stored === 'claude-sonnet-4-6') ? stored : 'gpt-5.5';
  });
  const scrollRef    = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  /** Guard to only auto-load the last conversation once on mount. */
  const hasAutoLoadedRef = useRef(false);
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

  // Persist model choice to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('fluxelle:model', selectedModel);
  }, [selectedModel]);

  // If the stored model isn't available on this server, fall back to the first that is
  useEffect(() => {
    const available = status.data?.availableModels;
    if (!available?.length) return;
    if (!available.includes(selectedModel)) {
      setSelectedModel(available[0] as FluxelleModelId);
    }
  // Only re-run when availableModels changes, not on selectedModel changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data?.availableModels]);

  // Auto-restore last conversation when panel first opens
  useEffect(() => {
    if (hasAutoLoadedRef.current) return;
    if (!convList.data || convList.data.length === 0) return;
    if (messages.length > 0 || activeConvId) return;
    hasAutoLoadedRef.current = true;
    void loadConversation(convList.data[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convList.data]);

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

  async function persistMessages(updatedMessages: FluxelleMessage[]) {
    const persisted = toPersistedMessages(updatedMessages);

    let convId = activeConvId;
    if (!convId && createConvPromiseRef.current) {
      try {
        const conv = await createConvPromiseRef.current;
        convId = conv.conversationId;
      } catch {
        return;
      }
    }
    if (!convId) return;

    updateConv.mutate({ id: convId, body: { messages: persisted } });
  }

  // ── Send a message ───────────────────────────────────────────────────────────
  async function send(
    content: string,
    extras?: {
      answersMessageId?: string;
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
        model:    selectedModel,
      });
      const assistantMsg: FluxelleMessage = {
        id:        randomId(),
        role:      'assistant',
        content:   response.content,
        proposal:  response.proposal,
        question:  response.question,
        trace:     response.trace?.length ? response.trace : undefined,
        createdAt: new Date().toISOString(),
      };
      const allMessages = [...nextMessages, assistantMsg];
      setMessages(allMessages);

      const persisted = toPersistedMessages(allMessages);
      if (!activeConvId && !createConvPromiseRef.current) {
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

  function handleApply(messageId: string, proposal: WorkflowProposal) {
    applyProposal(proposal);

    const updated = messages.map((m) =>
      m.id === messageId ? { ...m, proposalStatus: 'applied' as const } : m,
    );
    setMessages(updated);
    void persistMessages(updated);
    void saveWorkflow();
  }

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
  const activeTitle = convList.data?.find((c) => c.conversationId === activeConvId)?.title;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-black/[0.07] dark:border-white/10 flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white leading-tight">Fluxelle</div>
          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-tight truncate">
            {activeTitle ?? 'Your in-canvas workflow assistant'}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={startNewConversation}
              title="New conversation"
              className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <SquarePen className="w-3.5 h-3.5" />
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

        {chat.isPending && <ThinkingIndicator />}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-black/[0.07] dark:border-white/10 p-2.5 shrink-0"
      >
        <div className="relative bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-400/20 dark:focus-within:border-violet-500 transition-all shadow-sm">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a workflow, or ask Fluxelle to edit this one…"
            rows={2}
            disabled={chat.isPending}
            className="w-full resize-none bg-transparent text-xs text-gray-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 px-3 py-2.5 pr-10 focus:outline-none rounded-xl disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || chat.isPending}
            className="absolute right-2 bottom-2 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center"
            title="Send (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Model selector pills */}
        <div className="flex items-center gap-1.5 mt-2 px-0.5">
          {FLUXELLE_MODELS.map((m) => {
            const isAvailable = status.data?.availableModels?.includes(m.id) ?? false;
            const isActive    = selectedModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!isAvailable || chat.isPending}
                onClick={() => setSelectedModel(m.id)}
                title={isAvailable ? `Use ${m.label}` : `${m.label} is not configured`}
                className={[
                  'text-[10px] font-medium px-2 py-0.5 rounded-full border transition-all',
                  isActive && isAvailable
                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white border-transparent shadow-sm'
                    : isAvailable
                    ? 'text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400'
                    : 'text-slate-300 dark:text-slate-600 border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-50',
                ].join(' ')}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 px-0.5">
          Fluxelle never edits the canvas without your approval.
        </p>
      </form>
    </div>
  );
}

// ── Thinking indicator ────────────────────────────────────────────────────────

const THINKING_PHASES = [
  'Reading your workflow…',
  'Checking available skills…',
  'Analyzing requirements…',
  'Resolving credentials…',
  'Assembling your workflow…',
  'Putting it all together…',
];

function ThinkingIndicator() {
  const [phaseIdx, setPhaseIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPhaseIdx((i) => (i + 1) % THINKING_PHASES.length);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-start gap-2">
      <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-violet-500/20">
        <Sparkles className="w-3 h-3 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        {/* Dots */}
        <div className="flex items-center gap-1 px-3 py-2 rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-800 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" />
        </div>
        {/* Cycling status text */}
        <div
          key={phaseIdx}
          className="mt-1 text-[10px] text-slate-400 dark:text-slate-500 px-1 animate-fade-in"
        >
          {THINKING_PHASES[phaseIdx]}
        </div>
      </div>
    </div>
  );
}

// ── Trace steps (collapsible reasoning panel) ─────────────────────────────────

function traceIcon(tool: string) {
  if (tool === 'search_skills')            return <Search className="w-3 h-3" />;
  if (tool === 'load_skill')               return <BookOpen className="w-3 h-3" />;
  if (tool === 'get_node_output_schema')   return <FileText className="w-3 h-3" />;
  if (tool.startsWith('list_'))            return <Database className="w-3 h-3" />;
  if (tool === 'propose_workflow_changes') return <ListChecks className="w-3 h-3" />;
  if (tool === 'ask_user')                 return <HelpCircle className="w-3 h-3" />;
  return <Cpu className="w-3 h-3" />;
}

function TraceSteps({ steps }: { steps: FluxelleTraceStep[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl overflow-hidden border border-violet-200/60 dark:border-violet-800/40 text-[10.5px]">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-violet-50/80 dark:bg-violet-950/30 hover:bg-violet-100/70 dark:hover:bg-violet-900/30 transition-colors text-left"
      >
        <div className="w-4 h-4 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
          <Cpu className="w-2.5 h-2.5 text-white" />
        </div>
        <span className="flex-1 font-semibold text-violet-700 dark:text-violet-300">
          Reasoning steps
        </span>
        <span className="px-1.5 py-0.5 rounded-full bg-violet-200/70 dark:bg-violet-800/50 text-violet-600 dark:text-violet-300 font-bold text-[9.5px]">
          {steps.length}
        </span>
        <ChevronDown className={`w-3 h-3 text-violet-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Steps list */}
      {open && (
        <div className="divide-y divide-violet-100 dark:divide-violet-900/50 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2">
              {/* Step number + icon */}
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                step.status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-500'
                  : 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
              }`}>
                {traceIcon(step.tool)}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`font-semibold leading-snug ${
                  step.status === 'error'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-800 dark:text-slate-200'
                }`}>
                  {step.label}
                </div>
                {step.detail && (
                  <div className="text-[9.5px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    {step.detail}
                  </div>
                )}
              </div>
              {/* Status badge */}
              <div className={`shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                step.status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/40 text-red-500'
                  : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500'
              }`}>
                {step.status === 'error'
                  ? <X className="w-2 h-2" strokeWidth={3} />
                  : <Check className="w-2 h-2" strokeWidth={3} />
                }
              </div>
            </div>
          ))}
        </div>
      )}
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
      className={`group flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors ${
        isActive
          ? 'bg-violet-50 dark:bg-violet-950/30 border-l-2 border-violet-500'
          : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04] border-l-2 border-transparent'
      }`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[11.5px] font-semibold truncate leading-snug ${
          isActive ? 'text-violet-700 dark:text-violet-300' : 'text-gray-900 dark:text-slate-200'
        }`}>
          {conv.title}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {conv.workflowName && (
            <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold truncate max-w-[90px]">
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
        className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all shrink-0 mt-0.5"
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
      <div className="text-center py-4">
        <div className="relative w-14 h-14 mx-auto mb-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white dark:border-slate-900 flex items-center justify-center">
            <Zap className="w-2 h-2 text-white" />
          </div>
        </div>
        <h3 className="text-[13px] font-bold text-gray-900 dark:text-white">
          Hi, I'm Fluxelle.
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed px-3 mt-1">
          Tell me what you want to automate, and I'll wire up the nodes for you.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 px-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          <Lightbulb className="w-3 h-3" />
          Try one of these
        </div>
        {STARTER_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="group w-full text-left text-[11px] leading-snug px-3 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] hover:bg-gradient-to-r hover:from-violet-50 hover:to-fuchsia-50 dark:hover:from-violet-900/20 dark:hover:to-fuchsia-900/20 border border-transparent hover:border-violet-200 dark:hover:border-violet-800/50 text-slate-700 dark:text-slate-300 transition-all flex items-start gap-2"
          >
            <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-slate-300 dark:text-slate-600 group-hover:text-violet-500 transition-colors" />
            <span>{p}</span>
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
        <div className="max-w-[85%] text-[11.5px] leading-relaxed bg-gradient-to-br from-blue-600 to-blue-700 text-white px-3.5 py-2.5 rounded-2xl rounded-br-sm whitespace-pre-wrap shadow-sm shadow-blue-500/20">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-violet-500/20">
        <Sparkles className="w-3 h-3 text-white" />
      </div>
      <div className="flex-1 min-w-0 space-y-2.5">
        {message.trace && message.trace.length > 0 && (
          <TraceSteps steps={message.trace} />
        )}
        {message.content && (
          <div className="text-[11.5px] leading-relaxed text-gray-800 dark:text-slate-200">
            <FluxelleMarkdown content={message.content} />
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

// ── Question card ─────────────────────────────────────────────────────────────

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

  function toggle(id: string) {
    if (isAnswered) return;
    if (isMulti) {
      setPicked((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);
      return;
    }
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

  const selectedLabels = isAnswered
    ? answer!.selectedOptionIds
        .map((id) => question.options.find((o) => o.id === id)?.label ?? id)
        .filter(Boolean)
    : [];

  return (
    <div className="rounded-xl overflow-hidden border border-sky-200/80 dark:border-sky-800/50 shadow-sm shadow-sky-500/5">
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-gradient-to-r from-sky-500/10 via-blue-500/8 to-violet-500/8 dark:from-sky-900/40 dark:via-blue-900/30 dark:to-violet-900/20 border-b border-sky-200/70 dark:border-sky-800/50 flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shrink-0 shadow-sm">
          <HelpCircle className="w-3 h-3 text-white" />
        </div>
        <span className="text-[11px] font-bold text-sky-700 dark:text-sky-300 flex-1">
          {isAnswered ? 'Question answered' : 'Fluxelle needs your input'}
        </span>
        {isAnswered && (
          <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Done
          </div>
        )}
      </div>

      {/* Body */}
      <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm p-3.5 space-y-3">
        <div className="text-[12px] font-semibold text-gray-900 dark:text-white leading-snug">
          {question.prompt}
        </div>
        {question.helperText && (
          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {question.helperText}
          </div>
        )}

        {isAnswered ? (
          <div className="space-y-1.5">
            {selectedLabels.map((label, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/60 dark:border-emerald-800/40"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                <span className="text-[11.5px] font-semibold text-gray-900 dark:text-slate-200">{label}</span>
              </div>
            ))}
            {answer?.freeText && (
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-300 italic">
                "{answer.freeText}"
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {question.options.map((opt) => {
              const isPicked = picked.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggle(opt.id)}
                  className={`group w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl border-2 transition-all duration-150 ${
                    isPicked
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]'
                      : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/60 dark:hover:bg-blue-950/30 hover:shadow-sm'
                  }`}
                >
                  <span
                    className={`mt-0.5 w-4 h-4 ${isMulti ? 'rounded-md' : 'rounded-full'} border-2 flex items-center justify-center shrink-0 transition-all duration-150 ${
                      isPicked
                        ? 'border-blue-500 bg-blue-500 shadow-sm shadow-blue-500/30'
                        : 'border-slate-300 dark:border-slate-600 group-hover:border-blue-400'
                    }`}
                  >
                    {isPicked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[12px] font-semibold leading-snug transition-colors ${
                      isPicked ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-slate-200'
                    }`}>
                      {opt.label}
                    </div>
                    {opt.description && (
                      <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                        {opt.description}
                      </div>
                    )}
                  </div>
                  {!isMulti && (
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 mt-0.5 transition-all duration-150 ${
                      isPicked
                        ? 'text-blue-500 translate-x-0.5'
                        : 'text-slate-300 dark:text-slate-600 group-hover:text-blue-400 group-hover:translate-x-0.5'
                    }`} />
                  )}
                </button>
              );
            })}

            {question.allowFreeText && (
              <input
                type="text"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && freeText.trim() && confirm()}
                placeholder="Or type a custom answer…"
                className="w-full text-[11.5px] px-3 py-2.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600/80 bg-white dark:bg-slate-800/60 text-gray-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-solid focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all"
              />
            )}
          </div>
        )}
      </div>

      {/* Footer — multi/free-text confirm button */}
      {!isAnswered && (isMulti || question.allowFreeText) && (
        <div className="px-3.5 py-2.5 border-t border-sky-200/70 dark:border-sky-800/50 bg-white/40 dark:bg-black/10 flex items-center justify-between">
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            {isMulti ? `${picked.length} selected` : ''}
          </span>
          <button
            type="button"
            onClick={confirm}
            disabled={picked.length === 0 && !freeText.trim()}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 active:from-blue-700 active:to-blue-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-blue-500/20"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Confirm selection
          </button>
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
    <div className="rounded-xl overflow-hidden border border-violet-300/70 dark:border-violet-700/40 shadow-sm shadow-violet-500/5">
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-gradient-to-r from-violet-500/15 via-purple-500/10 to-fuchsia-500/10 dark:from-violet-900/50 dark:via-purple-900/30 dark:to-fuchsia-900/20 border-b border-violet-200/70 dark:border-violet-800/50 flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 shadow-sm">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="text-[11px] font-bold text-violet-700 dark:text-violet-300 flex-1">
          Proposed changes
        </span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-200/70 dark:bg-violet-800/70 text-violet-700 dark:text-violet-300">
          {totalChanges} {totalChanges === 1 ? 'edit' : 'edits'}
        </span>
      </div>

      {/* Change items */}
      <div className="bg-white/70 dark:bg-slate-900/70 p-3 space-y-1.5">
        {adds.map((n) => (
          <div key={`add-${n.id}`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-900/50">
            <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <Plus className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400 shrink-0 w-8">Add</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <NodeIcon type={n.type} size={12} />
              <span className="text-[9.5px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{n.type}</span>
            </div>
            <span className="text-[11.5px] font-semibold text-gray-900 dark:text-slate-200 truncate flex-1 min-w-0">
              {n.name}
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono shrink-0">{n.id}</span>
          </div>
        ))}

        {updates.map((u) => (
          <div key={`upd-${u.id}`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-900/50">
            <div className="w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
              <Pencil className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 shrink-0 w-8">Edit</span>
            <span className="text-[11.5px] font-semibold text-gray-900 dark:text-slate-200 truncate flex-1 min-w-0">
              {u.name ?? u.id}
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono shrink-0">{u.id}</span>
          </div>
        ))}

        {deletes.map((id) => (
          <div key={`del-${id}`} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200/70 dark:border-red-900/50">
            <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
              <Trash2 className="w-2.5 h-2.5 text-red-600 dark:text-red-400" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-red-700 dark:text-red-400 shrink-0 w-8">Del</span>
            <span className="text-[11.5px] font-mono text-gray-700 dark:text-slate-300 flex-1 truncate min-w-0">{id}</span>
          </div>
        ))}

        {edges.length > 0 && (
          <div className="pt-2 mt-1 border-t border-slate-200/60 dark:border-slate-700/40 space-y-1.5">
            <div className="flex items-center gap-1 text-[9.5px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
              <Link2 className="w-3 h-3" />
              Connections
            </div>
            {edges.map((e, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-violet-50/60 dark:bg-violet-950/30 border border-violet-200/50 dark:border-violet-900/40">
                <span className="text-[11px] font-mono font-semibold text-violet-700 dark:text-violet-400">{e.from}</span>
                <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
                <span className="text-[11px] font-mono font-semibold text-violet-700 dark:text-violet-400">{e.to}</span>
                {e.label && (
                  <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-violet-200/70 dark:bg-violet-800/60 text-violet-700 dark:text-violet-300 font-semibold">
                    {e.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 py-2.5 border-t border-violet-200/70 dark:border-violet-800/50 bg-white/40 dark:bg-black/15">
        {status === 'applied' && (
          <div className="flex items-center justify-center gap-2 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            Applied to canvas
          </div>
        )}
        {status === 'declined' && (
          <div className="flex items-center justify-center gap-2 py-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <X className="w-3.5 h-3.5" />
            </div>
            Proposal declined
          </div>
        )}
        {!status && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDecline}
              className="flex-1 text-[11px] font-semibold py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all"
              title="Dismiss this proposal without changing the canvas"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={onApply}
              className="flex-[2] inline-flex items-center justify-center gap-2 text-[11px] font-bold py-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 active:from-violet-700 active:to-fuchsia-700 text-white shadow-sm shadow-violet-500/25 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Apply to canvas
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
