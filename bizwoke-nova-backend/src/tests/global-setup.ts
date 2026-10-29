import { MongoMemoryReplSet } from 'mongodb-memory-server';
interface TestProject {
  provide(key: 'mongoUri', value: string): void;
}

let replSet: MongoMemoryReplSet | undefined;

/** Single-node replica set: required for MongoDB multi-document transactions. Isolated, throwaway. */
export async function setup(project: TestProject) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replSet.getUri();
  project.provide('mongoUri', uri);
}

export async function teardown() {
  await replSet?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
