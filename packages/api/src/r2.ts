import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignedPart } from '@cameraderie/shared';
import { loadEnv } from './env.js';

const MIN_PART_SIZE = 5 * 1024 * 1024; // R2/S3 multipart minimum (except last part)
const MAX_PARTS = 10000;

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

function ttl(): number {
  return loadEnv().R2_PRESIGN_TTL_SECONDS;
}

/** Choose a part size so the whole object fits within MAX_PARTS parts. */
export function choosePartSize(sizeBytes: number): number {
  const byLimit = Math.ceil(sizeBytes / MAX_PARTS);
  return Math.max(MIN_PART_SIZE, byLimit);
}

export interface CreatedMultipart {
  uploadId: string;
  partSizeBytes: number;
  parts: PresignedPart[];
}

/**
 * Begin a direct-to-R2 multipart upload and presign one URL per part. The
 * client uploads each chunk straight to R2; bytes never pass through the API.
 */
export async function createMultipartUpload(
  key: string,
  sizeBytes: number,
  contentType?: string,
): Promise<CreatedMultipart> {
  const created = await s3().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
    }),
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error('R2 did not return an UploadId');

  const partSizeBytes = choosePartSize(sizeBytes);
  const partCount = Math.max(1, Math.ceil(sizeBytes / partSizeBytes));
  const parts = await presignParts(key, uploadId, range(1, partCount));

  return { uploadId, partSizeBytes, parts };
}

/** Presign upload URLs for a specific set of part numbers (used for resume). */
export async function presignParts(
  key: string,
  uploadId: string,
  partNumbers: number[],
): Promise<PresignedPart[]> {
  const parts: PresignedPart[] = [];
  for (const partNumber of partNumbers) {
    const url = await getSignedUrl(
      s3(),
      new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: ttl() },
    );
    parts.push({ partNumber, url });
  }
  return parts;
}

/** List the parts R2 has already received for an in-flight multipart upload. */
export async function listUploadedParts(
  key: string,
  uploadId: string,
): Promise<{ partNumber: number; size: number; etag: string }[]> {
  const received: { partNumber: number; size: number; etag: string }[] = [];
  let marker: string | undefined;
  do {
    const res = await s3().send(
      new ListPartsCommand({
        Bucket: bucket(),
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }),
    );
    for (const p of res.Parts ?? []) {
      if (p.PartNumber != null) {
        received.push({
          partNumber: p.PartNumber,
          size: p.Size ?? 0,
          etag: p.ETag ?? '',
        });
      }
    }
    marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
  } while (marker);
  return received;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  await s3().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }),
  );
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await s3().send(
    new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }),
  );
}

/** Presign a GET for an object (download of an original, or a derivative). */
export async function presignGet(
  key: string,
  opts: { downloadName?: string } = {},
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: opts.downloadName
      ? `attachment; filename="${encodeURIComponent(opts.downloadName)}"`
      : undefined,
  });
  return getSignedUrl(s3(), command, { expiresIn: ttl() });
}

export interface HeadResult {
  exists: boolean;
  sizeBytes?: number;
}

/** Confirm an object exists and read its actual byte size. */
export async function headObject(key: string): Promise<HeadResult> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { exists: true, sizeBytes: res.ContentLength };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotFound' || name === 'NoSuchKey') return { exists: false };
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** Delete several objects (an original plus its derivatives). */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await s3().send(
    new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}
