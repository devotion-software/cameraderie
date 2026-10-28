import { relations } from 'drizzle-orm';
import {
  type AnyMySqlColumn,
  bigint,
  boolean,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * Single Drizzle schema for the whole system.
 *
 * The first five tables (user/session/account/verification/passkey) are owned
 * by Better Auth (passkey by the `@better-auth/passkey` plugin) — the JS
 * property keys MUST match Better Auth's field names (camelCase) so its
 * drizzle adapter can map them; the DB column names are snake_case. `user`
 * carries several custom fields (usedBytes, plan, role, permissions, consent).
 *
 * The rest are our domain tables. `media` is the hub.
 */

// ── Better Auth tables ──────────────────────────────────────────────────────────

export const user = mysqlTable('user', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: varchar('image', { length: 1024 }),
  /** R2 key of a self-uploaded avatar image. Takes priority over `image` when set. */
  avatarObjectKey: varchar('avatar_object_key', { length: 512 }),
  // --- custom fields ---
  /** Running total of this user's own originals, in bytes (quota metering). */
  usedBytes: bigint('used_bytes', { mode: 'number' }).notNull().default(0),
  /** Derived from the storage_tier entitlement. One of plans in @cameraderie/shared. */
  plan: varchar('plan', { length: 32 }).notNull().default('free'),
  /** Site-wide role: 'user' or 'admin' (admins can review reports / take down media). */
  role: varchar('role', { length: 32 }).notNull().default('user'),
  /** Permission: may create a new group. Site admins bypass this check. */
  canCreateGroups: boolean('can_create_groups').notNull().default(false),
  /** Permission: may invite new members to a group they admin. Site admins bypass this check. */
  canInviteMembers: boolean('can_invite_members').notNull().default(false),
  /** Remembered upload preference: keep GPS coordinates read from EXIF. */
  defaultKeepGps: boolean('default_keep_gps').notNull().default(true),
  /** Remembered upload preference: keep camera/lens/exposure EXIF. */
  defaultKeepCameraExif: boolean('default_keep_camera_exif').notNull().default(true),
  /** Remembered preference: default download quality (one of DOWNLOAD_QUALITIES). */
  defaultDownloadQuality: varchar('default_download_quality', { length: 16 })
    .notNull()
    .default('original'),
  /** Set by an admin to block sign-in, viewing, uploading, and downloading. Null = active. */
  disabledAt: timestamp('disabled_at'),
  /**
   * When the user confirmed they are 18+ and accepted the Terms + Privacy Policy
   * at sign-up. Null for accounts created before this gate existed. Kept as a
   * record of consent (UK GDPR / Online Safety Act age assurance).
   */
  acceptedTermsAt: timestamp('accepted_terms_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

export const session = mysqlTable(
  'session',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
    ipAddress: varchar('ip_address', { length: 128 }),
    userAgent: varchar('user_agent', { length: 512 }),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = mysqlTable(
  'account',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    providerId: varchar('provider_id', { length: 128 }).notNull(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: varchar('access_token', { length: 2048 }),
    refreshToken: varchar('refresh_token', { length: 2048 }),
    idToken: varchar('id_token', { length: 2048 }),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: varchar('scope', { length: 512 }),
    password: varchar('password', { length: 512 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = mysqlTable(
  'verification',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: varchar('value', { length: 512 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** Owned by the `@better-auth/passkey` plugin — WebAuthn credentials for passkey sign-in. */
export const passkey = mysqlTable(
  'passkey',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 255 }),
    publicKey: varchar('public_key', { length: 2048 }).notNull(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: varchar('credential_id', { length: 512 }).notNull(),
    counter: int('counter').notNull(),
    deviceType: varchar('device_type', { length: 32 }).notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: varchar('transports', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    aaguid: varchar('aaguid', { length: 64 }),
  },
  (t) => [
    index('passkey_user_idx').on(t.userId),
    index('passkey_credential_idx').on(t.credentialID),
  ],
);

// ── Domain tables ────────────────────────────────────────────────────────────────

export const groups = mysqlTable(
  'groups',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 500 }),
    ownerId: varchar('owner_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Strip EXIF/GPS from derivative previews (originals keep everything). */
    stripExifFromPreviews: boolean('strip_exif_from_previews').notNull().default(true),
    // Nullable + set null so the group survives if its chosen cover photo is
    // later deleted — same pattern as reports.mediaId.
    coverMediaId: varchar('cover_media_id', { length: 64 }).references(
      (): AnyMySqlColumn => media.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('groups_owner_idx').on(t.ownerId)],
);

export const memberships = mysqlTable(
  'memberships',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    groupId: varchar('group_id', { length: 64 })
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: mysqlEnum('role', ['owner', 'admin', 'member']).notNull().default('member'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_group_user_uq').on(t.groupId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const invites = mysqlTable(
  'invites',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    groupId: varchar('group_id', { length: 64 })
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull().unique(),
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * Optional: restricts this invite to one email address. When set, it both
     * (a) gates account sign-up — that email becomes allowed to register even
     * without a static allowlist entry — and (b) restricts who can accept the
     * invite once they have an account.
     */
    inviteeEmail: varchar('invitee_email', { length: 255 }),
    maxUses: int('max_uses'),
    uses: int('uses').notNull().default(0),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('invites_group_idx').on(t.groupId),
    index('invites_invitee_email_idx').on(t.inviteeEmail),
  ],
);

export const media = mysqlTable(
  'media',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    groupId: varchar('group_id', { length: 64 })
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    uploaderId: varchar('uploader_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', ['image', 'raw', 'video']).notNull(),
    // 'quarantined' = a content-safety match: the original + row are preserved
    // (as evidence) but never published or served. Set only by the worker.
    state: mysqlEnum('state', [
      'pending',
      'uploading',
      'processing',
      'ready',
      'failed',
      'quarantined',
    ])
      .notNull()
      .default('pending'),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }),
    /** Bytes of the untouched original; counts toward the uploader's quota. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    /** R2 key of the original. */
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    /** In-flight R2 multipart upload id (null once completed/aborted). */
    r2UploadId: varchar('r2_upload_id', { length: 255 }),
    width: int('width'),
    height: int('height'),
    durationMs: int('duration_ms'),
    capturedAt: timestamp('captured_at'),
    /** GPS coordinates read from EXIF client-side at upload time, if present. */
    latitude: double('latitude'),
    longitude: double('longitude'),
    /**
     * Whether the uploader chose to keep camera/lens/exposure EXIF. When
     * false, the worker skips extraction entirely and the fields below stay
     * null, regardless of what the original file actually contains.
     */
    keepCameraExif: boolean('keep_camera_exif').notNull().default(true),
    /**
     * Richer EXIF, extracted server-side by the worker from the original file
     * (images/RAW only — videos don't carry these). All nullable: many photos
     * are missing some or all of this (screenshots, edited exports, scans).
     * Human-readable fields (flash, exposureProgram, whiteBalance, orientation)
     * are stored as the translated text exifr produces, not raw codes.
     */
    cameraMake: varchar('camera_make', { length: 128 }),
    cameraModel: varchar('camera_model', { length: 128 }),
    lensModel: varchar('lens_model', { length: 191 }),
    apertureF: double('aperture_f'),
    shutterSpeedSec: double('shutter_speed_sec'),
    iso: int('iso'),
    focalLengthMm: double('focal_length_mm'),
    flash: varchar('flash', { length: 191 }),
    orientation: varchar('orientation', { length: 64 }),
    exposureProgram: varchar('exposure_program', { length: 64 }),
    whiteBalance: varchar('white_balance', { length: 64 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    index('media_group_idx').on(t.groupId, t.createdAt),
    index('media_uploader_idx').on(t.uploaderId),
    index('media_state_idx').on(t.state),
    index('media_group_checksum_idx').on(t.groupId, t.checksumSha256),
  ],
);

export const derivatives = mysqlTable(
  'derivatives',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    mediaId: varchar('media_id', { length: 64 })
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', ['thumbnail', 'preview']).notNull(),
    state: mysqlEnum('state', ['pending', 'ready', 'failed']).notNull().default('pending'),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    width: int('width'),
    height: int('height'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex('derivatives_media_kind_uq').on(t.mediaId, t.kind)],
);

export const favourites = mysqlTable(
  'favourites',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    mediaId: varchar('media_id', { length: 64 })
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('favourites_media_user_uq').on(t.mediaId, t.userId),
    index('favourites_user_idx').on(t.userId),
  ],
);

export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    /** The single "storage_tier" entitlement value (e.g. pro, max). */
    entitlement: varchar('entitlement', { length: 64 }),
    status: varchar('status', { length: 32 }).notNull().default('inactive'),
    currentPeriodEnd: timestamp('current_period_end'),
    raw: json('raw'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex('subscriptions_user_uq').on(t.userId)],
);

/**
 * Idempotency ledger for provider billing webhooks. The primary key is
 * `${provider}:${eventId}` (Stripe `evt_…` / RevenueCat event id). An event is
 * recorded in the SAME transaction that applies its entitlement, so a replayed
 * or duplicated delivery hits the PK and the whole apply rolls back — a captured
 * webhook can't be re-fired to re-grant a plan.
 */
export const webhookEvents = mysqlTable('webhook_events', {
  id: varchar('id', { length: 160 }).primaryKey(),
  provider: varchar('provider', { length: 32 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const reports = mysqlTable(
  'reports',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    // Nullable + set null so a report survives as an audit record after the
    // media is taken down.
    mediaId: varchar('media_id', { length: 64 }).references(() => media.id, {
      onDelete: 'set null',
    }),
    reporterId: varchar('reporter_id', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 500 }).notNull(),
    status: mysqlEnum('status', ['open', 'actioned', 'dismissed']).notNull().default('open'),
    reviewedBy: varchar('reviewed_by', { length: 64 }).references(() => user.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('reports_status_idx').on(t.status, t.createdAt),
    uniqueIndex('reports_media_reporter_uq').on(t.mediaId, t.reporterId),
  ],
);

// ── Relations ───────────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many, one }) => ({
  memberships: many(memberships),
  media: many(media),
  favourites: many(favourites),
  subscription: one(subscriptions),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  owner: one(user, { fields: [groups.ownerId], references: [user.id] }),
  coverMedia: one(media, { fields: [groups.coverMediaId], references: [media.id] }),
  memberships: many(memberships),
  media: many(media),
  invites: many(invites),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  group: one(groups, { fields: [memberships.groupId], references: [groups.id] }),
  user: one(user, { fields: [memberships.userId], references: [user.id] }),
}));

export const mediaRelations = relations(media, ({ one, many }) => ({
  group: one(groups, { fields: [media.groupId], references: [groups.id] }),
  uploader: one(user, { fields: [media.uploaderId], references: [user.id] }),
  derivatives: many(derivatives),
  favourites: many(favourites),
}));

export const derivativesRelations = relations(derivatives, ({ one }) => ({
  media: one(media, { fields: [derivatives.mediaId], references: [media.id] }),
}));

export const favouritesRelations = relations(favourites, ({ one }) => ({
  media: one(media, { fields: [favourites.mediaId], references: [media.id] }),
  user: one(user, { fields: [favourites.userId], references: [user.id] }),
}));

export const schema = {
  user,
  session,
  account,
  verification,
  passkey,
  groups,
  memberships,
  invites,
  media,
  derivatives,
  favourites,
  subscriptions,
  reports,
  webhookEvents,
  userRelations,
  groupsRelations,
  membershipsRelations,
  mediaRelations,
  derivativesRelations,
  favouritesRelations,
};

export type User = typeof user.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Derivative = typeof derivatives.$inferSelect;
export type Favourite = typeof favourites.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
