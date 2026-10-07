import { z } from 'zod';
import { GROUP_ROLES } from './media.js';

/**
 * Request/response contracts. The web client and the API both import these,
 * so the wire format is validated from one definition.
 */

// ── Groups & membership ────────────────────────────────────────────────────────

export const createGroupBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});
export type CreateGroupBody = z.infer<typeof createGroupBody>;

export const createInviteBody = z.object({
  /** Optional cap on how many people may accept this invite. */
  maxUses: z.number().int().positive().max(1000).optional(),
  /** Optional expiry, ISO 8601. */
  expiresAt: z.string().datetime().optional(),
});
export type CreateInviteBody = z.infer<typeof createInviteBody>;

export const roleSchema = z.enum(GROUP_ROLES);

// ── Upload (three-step, direct to R2) ──────────────────────────────────────────

/** SHA-256 as 64 lowercase hex chars, computed on-device. */
export const sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'checksum must be a 64-char lowercase hex SHA-256');

export const beginUploadBody = z.object({
  groupId: z.string().min(1),
  filename: z.string().trim().min(1).max(255),
  /** Declared size in bytes; validated server-side and against quota. */
  sizeBytes: z.number().int().positive(),
  /** Client-declared mime; used only as a classification hint. */
  mimeType: z.string().trim().max(255).optional(),
  /** On-device SHA-256 of the full original, verified after upload. */
  checksumSha256: sha256Hex,
  /** Optional capture time from EXIF, ISO 8601, for feed ordering. */
  capturedAt: z.string().datetime().optional(),
});
export type BeginUploadBody = z.infer<typeof beginUploadBody>;

/** One presigned part URL in a multipart upload. */
export interface PresignedPart {
  partNumber: number;
  url: string;
}

/** Returned by begin: everything the client needs to upload straight to R2. */
export interface BeginUploadResponse {
  mediaId: string;
  /** R2 multipart upload id. */
  r2UploadId: string;
  key: string;
  /** Recommended part size in bytes for the client to chunk with. */
  partSizeBytes: number;
  /** Presigned URLs, one per part, in order. */
  parts: PresignedPart[];
}

/** One completed part the client reports back (ETag from R2's response). */
export const completedPart = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1),
});

export const completeUploadBody = z.object({
  parts: z.array(completedPart).min(1),
});
export type CompleteUploadBody = z.infer<typeof completeUploadBody>;

// ── Responses ──────────────────────────────────────────────────────────────────

export interface UsageResponse {
  usedBytes: number;
  quotaBytes: number;
  plan: string;
  /** True when over quota: viewing/download/delete allowed, new uploads blocked. */
  readOnly: boolean;
}
