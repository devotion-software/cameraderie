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
