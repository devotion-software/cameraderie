import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { loadEnv } from './env.js';

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const env = loadEnv();
  client = new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

function bucket(): string {
  return loadEnv().R2_BUCKET;
}

/** Stream an object from R2 to a local file path. */
export async function downloadToFile(key: string, destPath: string): Promise<void> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const body = res.Body;
  if (!body) throw new Error(`No body for ${key}`);
  await pipeline(body as Readable, createWriteStream(destPath));
}

/** Upload a derivative buffer to R2. */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await s3().send(
    new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}
