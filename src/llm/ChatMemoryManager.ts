import { ChatMessage, ConversationMemory } from "../types/llm.types";

export class ChatMemoryManager {
    private store = new Map<string, ConversationMemory>();

    getOrCreate(executionId: string): ConversationMemory {
        if (!this.store.has(executionId)) {
            this.store.set(executionId, { messages: [] });
        }
        return this.store.get(executionId)!;
    }

    addMessage(executionId: string, message: ChatMessage): void {
        const memory = this.getOrCreate(executionId);
        memory.messages.push(message);
    }

    getHistory(executionId: string): ChatMessage[] {
        return this.getOrCreate(executionId).messages;
    }

    clear(executionId: string): void {
        this.store.delete(executionId);
    }
}