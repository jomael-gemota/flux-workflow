import { Schema, model, Document } from 'mongoose';

export interface NotificationSettingsDocument extends Document {
    /** Singleton key — always "global" */
    key: string;
    enabled: boolean;
    /** Notify when the entire workflow fails (status === 'failure') */
    notifyOnFailure: boolean;
    /** Notify when at least one node fails but others succeeded (status === 'partial') */
    notifyOnPartial: boolean;
    /** Notify when a workflow completes successfully (status === 'success') */
    notifyOnSuccess: boolean;
    /** List of recipient email addresses (owner email is always included and cannot be removed) */
    recipients: string[];
    updatedAt: Date;
}

const NotificationSettingsSchema = new Schema<NotificationSettingsDocument>(
    {
        key:             { type: String, required: true, unique: true, default: 'global' },
        enabled:         { type: Boolean, required: true, default: false },
        notifyOnFailure: { type: Boolean, required: true, default: true },
        notifyOnPartial: { type: Boolean, required: true, default: true },
        notifyOnSuccess: { type: Boolean, required: true, default: false },
        recipients:      { type: [String], required: true, default: [] },
    },
    { timestamps: true }
);

export const NotificationSettingsModel = model<NotificationSettingsDocument>(
    'NotificationSettings',
    NotificationSettingsSchema
);
