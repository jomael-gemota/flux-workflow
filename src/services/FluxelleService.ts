/**
 * Fluxelle — the in-canvas AI workflow assistant.
 *
 * Architecture:
 *   1. The user sends a message + a compact snapshot of the current workflow.
 *   2. We run an OpenAI chat-completion loop with three tools:
 *        - search_skills(query)
 *        - load_skill(name)
 *        - propose_workflow_changes({ adds, updates, deletes, edges })
 *   3. The first two are answered server-side from the SkillRegistry.
 *      The third is the *terminal* tool — when the model calls it, we capture
 *      its arguments as a "proposal" and stop the loop.
 *   4. The frontend renders the proposal as a diff card; only when the user
 *      clicks Apply does the canvas actually change. Fluxelle never mutates
 *      the workflow directly.
 */

import OpenAI from 'openai';
import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
    ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import { SkillRegistry } from '../skills/SkillRegistry';
import type { WorkflowDefinition, WorkflowNode, NodeType } from '../types/workflow.types';

// ── Public input/output types ─────────────────────────────────────────────────

export interface FluxelleChatMessage {
    role: 'user' | 'assistant';
    content: string;
    /** Optional proposal attached to an assistant turn. */
    proposal?: WorkflowProposal;
}

/** A compact snapshot of the user's current workflow, sent on every turn. */
export interface WorkflowSnapshot {
    id: string;
    name: string;
    nodes: Array<{
        id: string;
        type: NodeType;
        name: string;
        configPreview: string;   // shortened JSON for context efficiency
        next: string[];
    }>;
    entryNodeId: string;
}

/** The structured set of changes Fluxelle wants the canvas to apply. */
export interface WorkflowProposal {
    /** New nodes to add. Each id MUST be unique within the workflow. */
    adds?: ProposedNode[];
    /** Existing nodes whose config / name should be replaced. */
    updates?: Array<{ id: string; name?: string; config?: Record<string, unknown> }>;
    /** Node ids to remove. Edges referencing these are dropped automatically. */
    deletes?: string[];
    /** Directed edges to create between nodes (sourceId → targetId). */
    edges?: Array<{ from: string; to: string; sourceHandle?: string; label?: string }>;
    /** Optional human-readable summary shown above the diff card. */
    explanation?: string;
}

export interface ProposedNode {
    id: string;
    type: NodeType;
    name: string;
    config: Record<string, unknown>;
    /** Optional canvas position; otherwise the frontend auto-lays it out. */
    position?: { x: number; y: number };
}

export interface FluxelleChatRequest {
    messages: FluxelleChatMessage[];
    workflow?: WorkflowSnapshot | null;
}

export interface FluxelleChatResponse {
    /** The assistant's text reply. May be empty if a proposal carries the message. */
    content: string;
    /** Set when the model called `propose_workflow_changes`. */
    proposal?: WorkflowProposal;
    /** Exposed for debugging — names of skills the agent loaded this turn. */
    skillsUsed: string[];
}

// ── Service ──────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.FLUXELLE_MODEL ?? 'gpt-4o-mini';
const MAX_TOOL_HOPS = 6;

export class FluxelleService {
    private client: OpenAI | null;

    constructor(private skills: SkillRegistry, apiKey?: string) {
        const key = apiKey ?? process.env.OPENAI_API_KEY;
        this.client = key ? new OpenAI({ apiKey: key }) : null;
    }

    isConfigured(): boolean {
        return this.client !== null;
    }

    async chat(req: FluxelleChatRequest): Promise<FluxelleChatResponse> {
        if (!this.client) {
            throw new Error(
                'Fluxelle is not configured. Set OPENAI_API_KEY in your environment.'
            );
        }

        const tools = this.buildTools();
        const messages = this.buildMessages(req);
        const skillsUsed: string[] = [];
        let proposal: WorkflowProposal | undefined;

        for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
            const completion = await this.client.chat.completions.create({
                model:       DEFAULT_MODEL,
                temperature: 0.3,
                messages,
                tools,
                tool_choice: 'auto',
            });

            const choice = completion.choices[0];
            const msg    = choice.message;

            messages.push(msg as ChatCompletionMessageParam);

            const toolCalls = msg.tool_calls ?? [];
            if (toolCalls.length === 0) {
                // Plain text reply — we're done.
                return {
                    content: msg.content ?? '',
                    proposal,
                    skillsUsed,
                };
            }

            for (const call of toolCalls) {
                const result = this.runTool(call, skillsUsed);
                if (result.proposal) proposal = result.proposal;

                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify(result.payload),
                });

                // If the model called the terminal proposal tool, treat its
                // accompanying text content (if any) as the assistant message.
                if (result.terminal) {
                    const fallback =
                        typeof result.payload.message === 'string' ? result.payload.message : '';
                    return {
                        content: msg.content ?? fallback,
                        proposal,
                        skillsUsed,
                    };
                }
            }
        }

        // Loop exhausted without a terminal call — return whatever we have.
        return {
            content:
                "I'm having trouble settling on a final plan. Could you give me a bit more detail about what you want to build?",
            proposal,
            skillsUsed,
        };
    }

    // ── Tool execution ────────────────────────────────────────────────────────

    private runTool(
        call: ChatCompletionMessageToolCall,
        skillsUsed: string[],
    ): { payload: Record<string, unknown>; proposal?: WorkflowProposal; terminal?: boolean } {
        let args: Record<string, unknown> = {};
        try {
            args = (call as any).function?.arguments
                ? JSON.parse((call as any).function.arguments)
                : {};
        } catch {
            return { payload: { error: 'Invalid JSON arguments' } };
        }

        const name = (call as any).function?.name as string | undefined;

        switch (name) {
            case 'search_skills': {
                const query = String(args.query ?? '');
                const results = this.skills.search(query);
                return { payload: { results } };
            }

            case 'load_skill': {
                const skillName = String(args.name ?? '');
                const skill = this.skills.get(skillName);
                if (!skill) {
                    return { payload: { error: `No skill named "${skillName}"` } };
                }
                if (!skillsUsed.includes(skill.name)) skillsUsed.push(skill.name);
                return {
                    payload: {
                        name:     skill.name,
                        title:    skill.title,
                        nodeType: skill.nodeType,
                        body:     skill.body,
                    },
                };
            }

            case 'propose_workflow_changes': {
                const proposal = sanitizeProposal(args);
                return {
                    payload: { ok: true, message: proposal.explanation ?? 'Proposal ready.' },
                    proposal,
                    terminal: true,
                };
            }

            default:
                return { payload: { error: `Unknown tool: ${name}` } };
        }
    }

    // ── Prompt + tool definitions ─────────────────────────────────────────────

    private buildMessages(req: FluxelleChatRequest): ChatCompletionMessageParam[] {
        const skillIndex = this.skills.listSummaries();

        const indexBlock = skillIndex
            .map((s) => `- ${s.name} [${s.category}] — ${s.summary}`)
            .join('\n');

        const workflowBlock = req.workflow
            ? renderWorkflowSnapshot(req.workflow)
            : '_No workflow is open. Suggest creating one if appropriate._';

        const system = [
            'You are **Fluxelle**, the in-canvas AI assistant for Flux Workflow — a',
            'visual workflow automation platform. Your job is to help the user design,',
            'build, and edit workflows by proposing concrete node-level changes.',
            '',
            '## How you work',
            '1. Read the user\'s message and the current workflow snapshot below.',
            '2. If you need detail about a node type, call `search_skills` then `load_skill`.',
            '3. When you\'re ready to suggest changes, call `propose_workflow_changes`',
            '   with `adds`, `updates`, `deletes`, and `edges` describing the EXACT diff.',
            '   This is the FINAL action — after you call it, the loop ends and the',
            '   user reviews the diff before anything is applied.',
            '4. If the request is unclear or you need a credential the user hasn\'t connected,',
            '   ASK a clarifying question instead of proposing a half-baked workflow.',
            '',
            '## Critical rules',
            '- Always reference earlier-node output via `{{ nodes.<id>.output.<field> }}`.',
            '- Use kebab-case ids that hint at the node\'s purpose: `trigger-1`, `llm-summarize`, `slack-notify`.',
            '- For condition nodes, set `trueNext` / `falseNext` in the config — DO NOT also list them in `next`.',
            '- For switch nodes, set each case\'s `next` and `defaultNext` — leave the top-level `next` empty.',
            '- For all other node types, populate the `edges` array to wire them up.',
            '- If a credential id is needed but unknown, leave `credentialId: ""` and tell the user to fill it in.',
            '- Be concise. Skip filler. Lead with the change you\'re proposing, not pleasantries.',
            '',
            '## Skills catalogue',
            indexBlock,
            '',
            '## Current workflow',
            workflowBlock,
        ].join('\n');

        const turns: ChatCompletionMessageParam[] = req.messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        return [{ role: 'system', content: system }, ...turns];
    }

    private buildTools(): ChatCompletionTool[] {
        return [
            {
                type: 'function',
                function: {
                    name: 'search_skills',
                    description:
                        'Search the Flux Skills catalogue by intent or keyword. Returns matching skills (name, title, summary, when_to_use). Use this BEFORE proposing changes if you need to confirm config shape.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description:
                                    'Plain-language description of the capability you need (e.g. "send slack message", "schedule cron").',
                            },
                        },
                        required: ['query'],
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'load_skill',
                    description:
                        'Fetch the full details (config schema, examples, tips) for a specific skill by name. Call this after search_skills when you need exact field names.',
                    parameters: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'The kebab-case skill name returned by search_skills.',
                            },
                        },
                        required: ['name'],
                    },
                },
            },
            {
                type: 'function',
                function: {
                    name: 'propose_workflow_changes',
                    description:
                        'TERMINAL TOOL. Call this once when you have a complete plan. The user will see a diff and decide whether to apply it. After this call, your loop ends.',
                    parameters: {
                        type: 'object',
                        properties: {
                            explanation: {
                                type: 'string',
                                description: 'A 1-2 sentence summary of what this change does, shown above the diff.',
                            },
                            adds: {
                                type: 'array',
                                description: 'New nodes to add to the workflow.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        id:     { type: 'string' },
                                        type:   {
                                            type: 'string',
                                            enum: [...VALID_NODE_TYPES],
                                            description: 'The exact node type. Must be one of the listed enum values — do NOT use skill names here.',
                                        },
                                        name:   { type: 'string' },
                                        config: { type: 'object', additionalProperties: true },
                                    },
                                    required: ['id', 'type', 'name', 'config'],
                                    additionalProperties: false,
                                },
                            },
                            updates: {
                                type: 'array',
                                description: 'Existing nodes to modify (by id).',
                                items: {
                                    type: 'object',
                                    properties: {
                                        id:     { type: 'string' },
                                        name:   { type: 'string' },
                                        config: { type: 'object', additionalProperties: true },
                                    },
                                    required: ['id'],
                                    additionalProperties: false,
                                },
                            },
                            deletes: {
                                type: 'array',
                                description: 'Node ids to delete.',
                                items: { type: 'string' },
                            },
                            edges: {
                                type: 'array',
                                description: 'Directed connections between nodes. For condition / switch nodes, prefer setting the routing fields in the node config and omit edges for those.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        from:         { type: 'string' },
                                        to:           { type: 'string' },
                                        sourceHandle: { type: 'string' },
                                        label:        { type: 'string' },
                                    },
                                    required: ['from', 'to'],
                                    additionalProperties: false,
                                },
                            },
                        },
                        additionalProperties: false,
                    },
                },
            },
        ];
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Canonical list of node types accepted by the backend schema. */
const VALID_NODE_TYPES = new Set<string>([
    'trigger', 'llm', 'http', 'condition', 'switch', 'transform', 'extract',
    'output', 'code', 'loop', 'formatter', 'gmail', 'gdrive', 'gdocs', 'gsheets',
    'slack', 'teams', 'basecamp',
]);

function renderWorkflowSnapshot(wf: WorkflowSnapshot): string {
    if (wf.nodes.length === 0) return '_(empty canvas — no nodes yet)_';

    const lines = [
        `**${wf.name}** (id: \`${wf.id}\`, entry: \`${wf.entryNodeId || '—'}\`)`,
        'Nodes:',
        ...wf.nodes.map(
            (n) =>
                `- \`${n.id}\` [${n.type}] "${n.name}" → next: [${n.next.join(', ')}] · config: ${n.configPreview}`,
        ),
    ];
    return lines.join('\n');
}

/** Build the compact snapshot the agent receives. */
export function buildWorkflowSnapshot(wf: WorkflowDefinition | null | undefined): WorkflowSnapshot | null {
    if (!wf) return null;
    return {
        id:    wf.id,
        name:  wf.name,
        entryNodeId: wf.entryNodeId,
        nodes: wf.nodes.map((n) => ({
            id:   n.id,
            type: n.type,
            name: n.name,
            next: n.next ?? [],
            configPreview: shortJson(n.config),
        })),
    };
}

function shortJson(obj: Record<string, unknown>, max = 240): string {
    let s: string;
    try { s = JSON.stringify(obj); } catch { return '{ … }'; }
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Type-guard the model's proposal into the shape the frontend expects. */
function sanitizeProposal(args: Record<string, unknown>): WorkflowProposal {
    const proposal: WorkflowProposal = {};

    if (typeof args.explanation === 'string') proposal.explanation = args.explanation;

    if (Array.isArray(args.adds)) {
        proposal.adds = args.adds
            .filter((n) => n && typeof n === 'object')
            .map((n: any) => ({
                id:       String(n.id ?? ''),
                type:     n.type as NodeType,
                name:     String(n.name ?? n.id ?? 'New Node'),
                config:   (n.config && typeof n.config === 'object') ? n.config : {},
                position: n.position && typeof n.position === 'object'
                    ? { x: Number(n.position.x) || 0, y: Number(n.position.y) || 0 }
                    : undefined,
            }))
            .filter((n: any) => {
                if (!n.id || !n.type) return false;
                if (!VALID_NODE_TYPES.has(n.type)) {
                    console.warn(
                        `[Fluxelle] Dropping proposed node "${n.id}" — unknown type "${n.type}". ` +
                        `Valid types: ${[...VALID_NODE_TYPES].join(', ')}`
                    );
                    return false;
                }
                return true;
            });
    }

    if (Array.isArray(args.updates)) {
        proposal.updates = args.updates
            .filter((u) => u && typeof u === 'object' && (u as any).id)
            .map((u: any) => ({
                id:     String(u.id),
                name:   typeof u.name === 'string' ? u.name : undefined,
                config: u.config && typeof u.config === 'object' ? u.config : undefined,
            }));
    }

    if (Array.isArray(args.deletes)) {
        proposal.deletes = args.deletes.filter((d) => typeof d === 'string') as string[];
    }

    if (Array.isArray(args.edges)) {
        proposal.edges = args.edges
            .filter((e) => e && typeof e === 'object' && (e as any).from && (e as any).to)
            .map((e: any) => ({
                from:         String(e.from),
                to:           String(e.to),
                sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined,
                label:        typeof e.label === 'string' ? e.label : undefined,
            }));
    }

    return proposal;
}

// Re-export for caller convenience
export type { WorkflowNode };
