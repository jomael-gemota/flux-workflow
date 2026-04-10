import mongoose from 'mongoose';

let isConnected = false;

export async function connectDatabase(): Promise<void> {
    if (isConnected) return;

    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set in environment variables');

    await mongoose.connect(uri);
    isConnected = true;
    // console.log('✅ Connected to MongoDB Atlas');
}

export async function disconnectDatabase(): Promise<void> {
    if (!isConnected) return;
    await mongoose.disconnect();
    isConnected = false;
    // console.log('🔌 Disconnected from MongoDB');
}

export { mongoose };