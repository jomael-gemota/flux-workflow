import { Schema, model, Document } from 'mongoose';

/**
 * Single Basecamp web-session cookie, captured by the companion browser
 * extension. Mirrors the shape of `chrome.cookies.Cookie` minus fields we
 * don't need to re-serialize when sending the cookie back to Basecamp.
 *
 * These are stored only for Basecamp credentials and only when the user has
 * explicitly synced a session via the extension. Used to drive Basecamp web-UI
 * actions that aren't exposed by the public REST API (currently: removing a
 * user from Adminland).
 */
export interface BasecampWebCookie {
    name:           string;
    value:          string;
    domain:         string;
    path:           string;
    secure:         boolean;
    httpOnly:       boolean;
    sameSite?:      string | null;
    /** Unix seconds (matches `chrome.cookies.Cookie.expirationDate`); null = session cookie. */
    expirationDate?: number | null;
}

export interface BasecampWebSession {
    /** Cookies harvested from the user's browser via the extension. */
    cookies: BasecampWebCookie[];
    /** Email of the Basecamp user the cookies belong to (validated server-side). */
    identity: string;
    /** Unix ms — earliest cookie expiry, or now+14d for session cookies, used for UI freshness. */
    expiresAt: number;
    /** Unix ms — when the cookies were captured / last refreshed. */
    syncedAt: number;
}

export interface CredentialDocument extends Document {
    provider: 'google' | 'slack' | 'teams' | 'basecamp';
    label: string;
    email: string;
    accessToken: string;
    refreshToken: string;
    expiryDate: number;   // Unix ms timestamp (0 for non-expiring tokens like Slack)
    scopes: string[];
    /** MongoDB User ObjectId string — null for legacy / API-key-created credentials */
    userId?: string;
    /**
     * Optional Basecamp web-session payload. Present only on `provider: 'basecamp'`
     * credentials whose owner has run the "Sync Basecamp Session" flow. Absent
     * means the credential can still drive every public-API action (project
     * revoke, todos, messages, etc.) but cannot perform Adminland removal.
     */
    basecampWebSession?: BasecampWebSession;
}

const BasecampWebCookieSchema = new Schema<BasecampWebCookie>({
    name:           { type: String,  required: true },
    value:          { type: String,  required: true },
    domain:         { type: String,  required: true },
    path:           { type: String,  required: true },
    secure:         { type: Boolean, required: true },
    httpOnly:       { type: Boolean, required: true },
    sameSite:       { type: String,  default: null },
    expirationDate: { type: Number,  default: null },
}, { _id: false });

const BasecampWebSessionSchema = new Schema<BasecampWebSession>({
    cookies:   { type: [BasecampWebCookieSchema], required: true },
    identity:  { type: String, required: true },
    expiresAt: { type: Number, required: true },
    syncedAt:  { type: Number, required: true },
}, { _id: false });

const CredentialSchema = new Schema<CredentialDocument>(
    {
        provider: { type: String, enum: ['google', 'slack', 'teams', 'basecamp'], required: true },
        label:    { type: String, required: true },
        email:    { type: String, required: true },
        accessToken:  { type: String, required: true },
        refreshToken: { type: String, required: true },
        expiryDate:   { type: Number, required: true },
        scopes: [{ type: String }],
        userId: { type: String, index: true },  // sparse index; null for legacy credentials
        basecampWebSession: { type: BasecampWebSessionSchema, default: null },
    },
    { timestamps: true }
);

export const CredentialModel = model<CredentialDocument>('Credential', CredentialSchema);
