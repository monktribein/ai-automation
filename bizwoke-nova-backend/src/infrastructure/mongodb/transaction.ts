import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs `fn` inside a MongoDB transaction (requires a replica set or sharded cluster).
 * Transient transaction errors are retried by the driver's withTransaction helper.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

export function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: number; writeErrors?: { code?: number }[]; cause?: { code?: number } };
  return (
    e?.code === 11000 || e?.cause?.code === 11000 || Boolean(e?.writeErrors?.some((w) => w.code === 11000))
  );
}
