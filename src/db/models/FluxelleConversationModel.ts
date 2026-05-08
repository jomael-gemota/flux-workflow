import { Schema, model, Document } from 'mongoose';

export type ProposalStatus = 'applied' | 'declined';

export interface ConversationMessage {
    role:      'user' | 'assistant';
    content:   string;
    /** Serialised WorkflowProposal — stored as Mixed so the schema stays open. */
    proposal?: Record<string, unknown> | null;
    /** Whether the user already acted on the proposal attached to this message.
     *  `undefined` means the proposal is still pending the user's decision. */
    proposalStatus?: ProposalStatus | null;
    /** Optional structured `ask_user` question Fluxelle attached to this turn. */
    question?: Record<string, unknown> | null;
    /** The user's resolution of the question above (selected option ids + free text). */
    questionAnswer?: {
        selectedOptionIds: string[];
        freeText?:         string;
    } | null;
    createdAt: Date;
}

export interface FluxelleConversationDocument extends Document {
    conversationId: string;
    /** MongoDB ObjectId string of the owning user. */
    userId:         string;
    /** Derived from the first user message (truncated to 80 chars). */
    title:          string;
    /** ID of the workflow that was open when the conversation started. */
    workflowId?:    string;
    /** Display name of that workflow — denormalised for the history list. */
    workflowName?:  string;
    messages:       ConversationMessage[];
    createdAt:      Date;
    updatedAt:      Date;
}

const ConversationMessageSchema = new Schema<ConversationMessage>(
    {
        role:           { type: String, enum: ['user', 'assistant'], required: true },
        content:        { type: String, required: true },
        proposal:       { type: Schema.Types.Mixed, default: null },
        proposalStatus: { type: String, enum: ['applied', 'declined'], default: null },
        question:       { type: Schema.Types.Mixed, default: null },
        questionAnswer: { type: Schema.Types.Mixed, default: null },
        createdAt:      { type: Date, default: Date.now },
    },
    { _id: false },
);

const FluxelleConversationSchema = new Schema<FluxelleConversationDocument>(
    {
        conversationId: { type: String, required: true, unique: true, index: true },
        userId:         { type: String, required: true, index: true },
        title:          { type: String, required: true },
        workflowId:     { type: String },
        workflowName:   { type: String },
        messages:       { type: [ConversationMessageSchema], default: [] },
    },
    { timestamps: true },
);

FluxelleConversationSchema.index({ userId: 1, updatedAt: -1 });

export const FluxelleConversationModel = model<FluxelleConversationDocument>(
    'FluxelleConversation',
    FluxelleConversationSchema,
);
