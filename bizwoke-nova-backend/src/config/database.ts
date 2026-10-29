import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../common/logging/logger';

// Unknown filter paths are dropped. NoSQL-injection protection comes from Zod schemas (typed
// primitives only) plus the rejectOperatorKeys middleware, so trusted $in/$gte queries still work.
mongoose.set('strictQuery', true);

export async function connectDatabase(uri = env().MONGODB_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: env().NODE_ENV !== 'production',
  });
  logger.info({ db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}
