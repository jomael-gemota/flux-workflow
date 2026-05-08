import type { NodeType } from './workflow';

/** Tracks whether the user has acted on a proposal attached to a message. */
export type ProposalStatus = 'applied' | 'declined';

/** One step in Fluxelle's reasoning trace (returned by the backend). */
export interface FluxelleTraceStep {
  tool:    string;
  label:   string;
  detail?: string;
  status:  'ok' | 'error';
}

export interface FluxelleMessage {
  /** Stable id for keying the React list. */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Optional proposal attached to an assistant turn. */
  proposal?: WorkflowProposal;
  /** User's decision on the attached proposal — undefined while still pending. */
  proposalStatus?: ProposalStatus;
  /** Optional structured `ask_user` question attached to an assistant turn. */
  question?: FluxelleQuestion;
  /** The user's resolution of the attached question (set after they pick an option). */
  questionAnswer?: QuestionAnswer;
  /** Ordered trace of tool calls Fluxelle made to produce this message. */
  trace?: FluxelleTraceStep[];
  /** ISO timestamp; rendered as the message timestamp. */
  createdAt: string;
}

/** Compact snapshot of the current canvas sent to the backend each turn. */
export interface WorkflowSnapshot {
  id: string;
  name: string;
  entryNodeId: string;
  nodes: Array<{
    id: string;
    type: NodeType;
    name: string;
    configPreview: string;
    next: string[];
  }>;
}

export interface ProposedNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface ProposedEdge {
  from: string;
  to: string;
  sourceHandle?: string;
  label?: string;
}

export interface WorkflowProposal {
  adds?: ProposedNode[];
  updates?: Array<{
    id: string;
    name?: string;
    config?: Record<string, unknown>;
  }>;
  deletes?: string[];
  edges?: ProposedEdge[];
  explanation?: string;
}

/** A clarifying question rendered as selectable options in the chat UI. */
export interface FluxelleQuestion {
  prompt: string;
  helperText?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  /** When true, render checkboxes + a Confirm button. */
  allowMultiple?: boolean;
  /** When true, also show a free-text input alongside the options. */
  allowFreeText?: boolean;
}

/** The user's resolution of a `FluxelleQuestion`. */
export interface QuestionAnswer {
  selectedOptionIds: string[];
  freeText?: string;
}

export interface FluxelleStatus {
  configured: boolean;
  model: string;
}

export interface FluxelleChatResponse {
  content: string;
  proposal?: WorkflowProposal;
  question?: FluxelleQuestion;
  skillsUsed: string[];
  trace: FluxelleTraceStep[];
}

export interface SkillSummary {
  name: string;
  title: string;
  summary: string;
  whenToUse: string;
  category: 'integration' | 'ai' | 'logic' | 'data' | 'trigger' | 'pattern';
  nodeType?: NodeType;
  requiresCredential?: 'google' | 'slack' | 'teams' | 'basecamp' | 'openai';
}

export interface SkillDetail extends SkillSummary {
  body: string;
}

// ── Conversation history ──────────────────────────────────────────────────────

/** A single persisted message inside a saved conversation. */
export interface PersistedMessage {
  role:           'user' | 'assistant';
  content:        string;
  proposal?:      WorkflowProposal | null;
  proposalStatus?: ProposalStatus | null;
  question?:      FluxelleQuestion | null;
  questionAnswer?: QuestionAnswer | null;
  trace?:         FluxelleTraceStep[] | null;
  createdAt:      string;
}

/** Summary row used in the history list. */
export interface ConversationSummary {
  conversationId: string;
  title:          string;
  workflowId?:    string;
  workflowName?:  string;
  messageCount:   number;
  createdAt:      string;
  updatedAt:      string;
}

/** Full conversation with all messages. */
export interface ConversationDetail extends ConversationSummary {
  messages: PersistedMessage[];
}
