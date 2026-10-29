import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';

/** Object storage behind a provider interface. Keys are always generated server-side. */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9/_.-]{1,300}$/;

function assertKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.startsWith('/')) throw new Error('Unsafe storage key');
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }
  private path(key: string) {
    assertKey(key);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Storage path escapes root');
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) {
    const p = this.path(key);
    await stat(p);
    return createReadStream(p);
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private client: S3Client;
  constructor(private readonly bucket: string, cfg: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  }
  async get(key: string) {
    assertKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }
  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let instance: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (instance) return instance;
  const e = env();
  instance =
    e.STORAGE_PROVIDER === 's3'
      ? new S3StorageProvider(e.STORAGE_BUCKET!, {
          endpoint: e.STORAGE_ENDPOINT,
          region: e.STORAGE_REGION,
          accessKeyId: e.STORAGE_ACCESS_KEY!,
          secretAccessKey: e.STORAGE_SECRET_KEY!,
          forcePathStyle: e.STORAGE_FORCE_PATH_STYLE,
        })
      : new LocalStorageProvider(e.STORAGE_LOCAL_DIR);
  return instance;
}

export function setStorageForTests(p: StorageProvider | undefined) {
  instance = p;
}
