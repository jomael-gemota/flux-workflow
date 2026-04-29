import { NotificationSettingsModel, type NotificationSettingsDocument } from '../db/models/NotificationSettingsModel';

const RECORD_KEY = 'settings';

export class NotificationSettingsRepository {
    /**
     * Return the notification settings for a specific user, auto-creating a
     * fresh default record on first access so callers never receive null.
     */
    async get(userId: string): Promise<NotificationSettingsDocument> {
        const existing = await NotificationSettingsModel.findOne({ key: RECORD_KEY, userId });
        if (existing) return existing;
        return NotificationSettingsModel.create({ key: RECORD_KEY, userId });
    }

    async update(
        patch: {
            enabled?: boolean;
            notifyOnFailure?: boolean;
            notifyOnPartial?: boolean;
            notifyOnSuccess?: boolean;
            recipients?: string[];
        },
        userId: string,
    ): Promise<NotificationSettingsDocument> {
        const doc = await NotificationSettingsModel.findOneAndUpdate(
            { key: RECORD_KEY, userId },
            { $set: patch },
            { new: true, upsert: true },
        );
        return doc!;
    }
}
