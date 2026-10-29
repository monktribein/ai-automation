/**
 * Local development database: a persistent single-node MongoDB replica set (transactions work),
 * using the MongoDB binary that mongodb-memory-server downloads. No Docker or MongoDB install needed.
 *
 *   npm run db:local        # keep this running in its own terminal
 *
 * Data is kept in ./storage/mongo-data between runs. Matches the default .env:
 *   MONGODB_URI=mongodb://127.0.0.1:27017/bizwoke_nova?replicaSet=rs0
 * Development only. Use MongoDB Atlas (or another managed replica set) in production.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function main() {
  const dbPath = resolve(process.env.LOCAL_MONGO_DIR ?? './storage/mongo-data');
  const port = Number(process.env.LOCAL_MONGO_PORT ?? 27017);
  mkdirSync(dbPath, { recursive: true });
  const rs = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port, dbPath }],
  });
  process.stdout.write(
    `Local MongoDB replica set ready\n  URI: mongodb://127.0.0.1:${port}/bizwoke_nova?replicaSet=rs0\n  Data: ${dbPath}\nPress Ctrl+C to stop.\n`,
  );
  const stop = async () => {
    await rs.stop({ doCleanup: false, force: false });
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((err) => {
  process.stderr.write(`Failed to start local MongoDB: ${(err as Error).message}\n`);
  process.exit(1);
});
