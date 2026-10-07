/** Contracts shared between the API (producer) and the worker (consumer). */

export const DERIVATIVES_QUEUE = 'derivatives';

/** Enqueued when an upload completes and its original is verified. */
export interface DerivativeJob {
  mediaId: string;
}

export const RECONCILE_QUEUE = 'reconcile';

/** Periodic reconciliation of a user's used_bytes against R2. */
export interface ReconcileJob {
  userId: string;
}

export const SWEEP_QUEUE = 'sweep';

/**
 * Periodic cleanup of uploads abandoned mid-flight: media rows stuck in
 * 'uploading' past a TTL, whose R2 multipart should be aborted and row removed.
 */
export interface SweepJob {
  /** Uploads older than this many minutes are considered abandoned. */
  olderThanMinutes: number;
}

/** Default: reap uploads that have been 'uploading' for over 24h. */
export const STALE_UPLOAD_TTL_MINUTES = 24 * 60;
