import { NotificationSettingsModel, type NotificationSettingsDocument } from '../db/models/NotificationSettingsModel';

const SINGLETON_KEY = 'global';

export class NotificationSettingsRepository {
    async get(): Promise<NotificationSettingsDocument> {
        const existing = await NotificationSettingsModel.findOne({ key: SINGLETON_KEY });
        if (existing) return existing;
        // Auto-create the singleton on first access
        return NotificationSettingsModel.create({ key: SINGLETON_KEY });
    }

    async update(patch: {
        enabled?: boolean;
        notifyOnFailure?: boolean;
        notifyOnPartial?: boolean;
        recipients?: string[];
    }): Promise<NotificationSettingsDocument> {
        const doc = await NotificationSettingsModel.findOneAndUpdate(
            { key: SINGLETON_KEY },
            { $set: patch },
            { new: true, upsert: true }
        );
        return doc!;
    }
}
