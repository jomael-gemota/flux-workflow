import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth';
import { toJsonSchema } from '../validation/toJsonSchema';
import { FluxelleService } from '../services/FluxelleService';
import type { FluxelleChatRequest, FluxelleChatResponse } from '../services/FluxelleService';
import { SkillRegistry } from '../skills/SkillRegistry';
import { BadRequestError, NotFoundError } from '../errors/ApiError';
import { FluxelleConversationRepository } from '../repositories/FluxelleConversationRepository';
import type { CreditService, CreditSnapshot } from '../services/CreditService';

/** Extracts the authenticated user's MongoDB id from a JWT-authenticated request. */
function getRequestUserId(request: FastifyRequest): string | undefined {
    return (request as any).user?.sub ?? undefined;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * A `question` block on an assistant message — a structured prompt with
 * selectable options that the UI renders as buttons. Mirrors `FluxelleQuestion`
 * in the service. Open shape so frontend can evolve without forcing schema bumps.
 */
const QuestionSchema = z.object({
    prompt:        z.string(),
    helperText:    z.string().optional(),
    options:       z.array(z.object({
        id:          z.string(),
        label:       z.string(),
        description: z.string().optional(),
    })).min(1),
    allowMultiple: z.boolean().optional(),
    allowFreeText: z.boolean().optional(),
});

/** The user's resolution of an earlier `question`. */
const QuestionAnswerSchema = z.object({
    selectedOptionIds: z.array(z.string()),
    freeText:          z.string().optional(),
});

const ChatMessageSchema = z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string(),
    /** Open record so the schema accepts forward-compatible proposal/question shapes. */
    proposal:       z.record(z.string(), z.unknown()).optional(),
    question:       QuestionSchema.optional(),
    questionAnswer: QuestionAnswerSchema.optional(),
});

const WorkflowSnapshotSchema = z.object({
    id:          z.string(),
    name:        z.string(),
    entryNodeId: z.string(),
    nodes: z.array(
        z.object({
            id:             z.string(),
            type:           z.string(),
            name:           z.string(),
            configPreview:  z.string(),
            next:           z.array(z.string()),
        }),
    ),
});

const ChatRequestSchema = z.object({
    messages: z.array(ChatMessageSchema).min(1),
    workflow: WorkflowSnapshotSchema.nullable().optional(),
    model:    z.string().optional(),
});

const ConversationMessageSchema = z.object({
    role:           z.enum(['user', 'assistant']),
    content:        z.string(),
    proposal:       z.record(z.string(), z.unknown()).nullable().optional(),
    proposalStatus: z.enum(['applied', 'declined']).nullable().optional(),
    question:       QuestionSchema.nullable().optional(),
    questionAnswer: QuestionAnswerSchema.nullable().optional(),
    createdAt:      z.string(),
});

const CreateConversationSchema = z.object({
    title:        z.string().min(1).max(200),
    workflowId:   z.string().optional(),
    workflowName: z.string().optional(),
    messages:     z.array(ConversationMessageSchema).optional(),
});

const UpdateConversationSchema = z.object({
    title:    z.string().min(1).max(200).optional(),
    messages: z.array(ConversationMessageSchema).min(1),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function fluxelleRoutes(
    fastify: FastifyInstance,
    options: {
        fluxelle:      FluxelleService;
        skills:        SkillRegistry;
        conversations: FluxelleConversationRepository;
        creditService: CreditService;
    },
): Promise<void> {
    const { fluxelle, skills, conversations, creditService } = options;

    /** Health / configuration probe — used by the UI to show a setup prompt. */
    fastify.get(
        '/fluxelle/status',
        { preHandler: apiKeyAuth },
        async () => ({
            configured:      fluxelle.isConfigured(),
            model:           process.env.FLUXELLE_MODEL ?? 'gpt-5.5',
            availableModels: fluxelle.availableModels(),
        }),
    );

    /** Main chat endpoint — JSON request/response (non-streaming v1). */
    fastify.post(
        '/fluxelle/chat',
        {
            preHandler: apiKeyAuth,
            schema:     { body: toJsonSchema(ChatRequestSchema) },
        },
        async (request, reply) => {
            const body   = ChatRequestSchema.parse(request.body);
            const userId = getRequestUserId(request);
            // Zod widens `nodes[].type` to `string`; the service narrows it to
            // NodeType internally and ignores unknowns, so this cast is safe.
            const chatRequest = { ...body, userId } as FluxelleChatRequest;

            if (!fluxelle.isConfigured()) {
                throw BadRequestError(
                    'Fluxelle is not configured on the server. Set OPENAI_API_KEY and/or VERTEX_PROJECT in your environment.',
                );
            }

            // Pre-flight credit check — short-circuit with a polite reply when
            // the user is out of credits, instead of calling the LLM provider.
            // Returns a normal 200 so the frontend renders it as a Fluxelle
            // bubble (not a red error).
            if (userId) {
                const snapshot = await creditService.getSnapshot(userId);
                if (snapshot.remaining <= 0) {
                    return reply.code(200).send(buildLimitReachedResponse(snapshot, body.model));
                }
            }

            try {
                const response = await fluxelle.chat(chatRequest);
                return reply.code(200).send(response);
            } catch (err) {
                // Surface the underlying provider error (model not found,
                // unsupported parameter, rate limit, …) rather than letting
                // it fall through to the generic 500 handler.
                const message = err instanceof Error ? err.message : 'Unknown error';
                request.log.error({ err }, '[Fluxelle] chat error');
                throw BadRequestError(`Fluxelle could not respond: ${message}`);
            }
        },
    );

    // ── Conversation history ──────────────────────────────────────────────────

    /** List conversations for the authenticated user (most-recent first). */
    fastify.get(
        '/fluxelle/conversations',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            if (!userId) return reply.code(200).send({ conversations: [] });
            const list = await conversations.list(userId);
            return reply.code(200).send({ conversations: list });
        },
    );

    /** Create a new conversation (called on the first message of a new chat). */
    fastify.post(
        '/fluxelle/conversations',
        {
            preHandler: apiKeyAuth,
            schema:     { body: toJsonSchema(CreateConversationSchema) },
        },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            if (!userId) throw BadRequestError('Authentication required to save conversations.');

            const body = CreateConversationSchema.parse(request.body);
            const messages = (body.messages ?? []).map((m) => ({
                ...m,
                createdAt: new Date(m.createdAt),
            }));

            const conv = await conversations.create({
                userId,
                title:        body.title,
                workflowId:   body.workflowId,
                workflowName: body.workflowName,
                messages,
            });
            return reply.code(201).send(conv);
        },
    );

    /** Fetch a single conversation with full messages. */
    fastify.get<{ Params: { id: string } }>(
        '/fluxelle/conversations/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            if (!userId) throw BadRequestError('Authentication required.');

            const conv = await conversations.get(request.params.id, userId);
            if (!conv) throw NotFoundError(`Conversation ${request.params.id}`);
            return reply.code(200).send(conv);
        },
    );

    /** Update a conversation's messages (and optionally its title). */
    fastify.patch<{ Params: { id: string } }>(
        '/fluxelle/conversations/:id',
        {
            preHandler: apiKeyAuth,
            schema:     { body: toJsonSchema(UpdateConversationSchema) },
        },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            if (!userId) throw BadRequestError('Authentication required.');

            const body = UpdateConversationSchema.parse(request.body);
            const messages = body.messages.map((m) => ({
                ...m,
                createdAt: new Date(m.createdAt),
            }));

            const conv = await conversations.updateMessages(
                request.params.id,
                userId,
                messages,
                body.title,
            );
            if (!conv) throw NotFoundError(`Conversation ${request.params.id}`);
            return reply.code(200).send(conv);
        },
    );

    /** Delete a conversation. */
    fastify.delete<{ Params: { id: string } }>(
        '/fluxelle/conversations/:id',
        { preHandler: apiKeyAuth },
        async (request, reply) => {
            const userId = getRequestUserId(request);
            if (!userId) throw BadRequestError('Authentication required.');

            const deleted = await conversations.delete(request.params.id, userId);
            if (!deleted) throw NotFoundError(`Conversation ${request.params.id}`);
            return reply.code(200).send({ deleted: true });
        },
    );

    // ── Skills catalogue ──────────────────────────────────────────────────────

    /** Skills catalogue — summary list. */
    fastify.get(
        '/skills',
        { preHandler: apiKeyAuth },
        async () => ({ skills: skills.listSummaries() }),
    );

    /** Single skill — full markdown body. */
    fastify.get<{ Params: { name: string } }>(
        '/skills/:name',
        { preHandler: apiKeyAuth },
        async (request) => {
            const skill = skills.get(request.params.name);
            if (!skill) throw NotFoundError(`Skill ${request.params.name}`);
            return skill;
        },
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a Fluxelle-shaped response that politely tells the user they've
 * exhausted their daily credit allowance, including a human-readable
 * "resets in Xh Ym" hint based on the snapshot's `resetAt`.
 *
 * Returned with HTTP 200 so the frontend renders it as a normal assistant
 * bubble (not the red `❌` error bubble) — no LLM call is made.
 */
function buildLimitReachedResponse(
    snap: CreditSnapshot,
    requestedModel: string | undefined,
): FluxelleChatResponse {
    const msLeft     = Math.max(0, new Date(snap.resetAt).getTime() - Date.now());
    const totalMins  = Math.floor(msLeft / 60_000);
    const hours      = Math.floor(totalMins / 60);
    const mins       = totalMins % 60;
    const resetLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    return {
        content:
            `You've used all ${snap.dailyLimit.toLocaleString()} of your Fluxelle credits ` +
            `for today. Your allowance resets in ${resetLabel} — I'll be ready to help ` +
            `again then. In the meantime, anything you've already built is safe on the canvas.`,
        skillsUsed: [],
        trace:      [],
        usage: {
            promptTokens:     0,
            completionTokens: 0,
            totalTokens:      0,
            creditsConsumed:  0,
            model:            requestedModel ?? 'system',
        },
    };
}
