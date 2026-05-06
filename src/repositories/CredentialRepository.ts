import { CredentialModel, CredentialDocument, BasecampWebSession } from '../db/models/CredentialModel';

export interface CredentialSummary {
    id: string;
    provider: 'google' | 'slack' | 'teams' | 'basecamp';
    label: string;
    email: string;
    scopes: string[];
    createdAt: Date;
    /**
     * For Basecamp credentials only: lightweight description of the
     * web-session payload (if any). Listed credentials never include the
     * cookie values themselves — those stay server-side. The shape exists so
     * the credentials UI can render "Synced as foo@bar — valid through Tue".
     */
    basecampWebSession?: {
        identity:  string;
        expiresAt: number;
        syncedAt:  number;
        /** Number of cookies stored, surfaced for diagnostic display only. */
        cookieCount: number;
    };
}

export interface CredentialTokens {
    accessToken: string;
    refreshToken: string;
    expiryDate: number;
    scopes?: string[];
}

export class CredentialRepository {

    async create(data: {
        provider: 'google' | 'slack' | 'teams' | 'basecamp';
        label: string;
        email: string;
        accessToken: string;
        refreshToken: string;
        expiryDate: number;
        scopes: string[];
        userId?: string;
    }): Promise<CredentialDocument> {
        return CredentialModel.create(data);
    }

    async findAll(userId?: string): Promise<CredentialSummary[]> {
        const filter = userId ? { userId } : {};
        const docs = await CredentialModel.find(filter).sort({ createdAt: -1 });
        return docs.map(this.toSummary);
    }

    /** Used internally by auth services for upsert checks — filtered by userId when provided */
    async findAllForUpsert(userId?: string): Promise<CredentialSummary[]> {
        return this.findAll(userId);
    }

    async findById(id: string): Promise<CredentialDocument | null> {
        return CredentialModel.findById(id);
    }

    async updateTokens(id: string, tokens: CredentialTokens): Promise<void> {
        await CredentialModel.findByIdAndUpdate(id, {
            $set: {
                accessToken:  tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiryDate:   tokens.expiryDate,
                ...(tokens.scopes ? { scopes: tokens.scopes } : {}),
            },
        });
    }

    async deleteById(id: string, userId?: string): Promise<boolean> {
        const filter: Record<string, unknown> = { _id: id };
        if (userId) filter.userId = userId;
        const result = await CredentialModel.findOneAndDelete(filter);
        return result !== null;
    }

    /**
     * Persist (or replace) a Basecamp web-session payload on the credential.
     * Scoped by `userId` when provided so users can only mutate their own
     * credentials. Returns false when no matching credential was found.
     */
    async setBasecampWebSession(
        credentialId: string,
        session: BasecampWebSession,
        userId?: string,
    ): Promise<boolean> {
        const filter: Record<string, unknown> = { _id: credentialId, provider: 'basecamp' };
        if (userId) filter.userId = userId;
        const result = await CredentialModel.findOneAndUpdate(
            filter,
            { $set: { basecampWebSession: session } },
            { new: true },
        );
        return result !== null;
    }

    /** Drop the stored Basecamp web session (e.g. on user request). */
    async clearBasecampWebSession(credentialId: string, userId?: string): Promise<boolean> {
        const filter: Record<string, unknown> = { _id: credentialId, provider: 'basecamp' };
        if (userId) filter.userId = userId;
        const result = await CredentialModel.findOneAndUpdate(
            filter,
            { $set: { basecampWebSession: null } },
            { new: true },
        );
        return result !== null;
    }

    private toSummary(doc: CredentialDocument): CredentialSummary {
        const summary: CredentialSummary = {
            id:        (doc._id as object).toString(),
            provider:  doc.provider,
            label:     doc.label,
            email:     doc.email,
            scopes:    doc.scopes,
            createdAt: (doc as unknown as { createdAt: Date }).createdAt,
        };
        if (doc.provider === 'basecamp' && doc.basecampWebSession) {
            summary.basecampWebSession = {
                identity:    doc.basecampWebSession.identity,
                expiresAt:   doc.basecampWebSession.expiresAt,
                syncedAt:    doc.basecampWebSession.syncedAt,
                cookieCount: doc.basecampWebSession.cookies.length,
            };
        }
        return summary;
    }
}
