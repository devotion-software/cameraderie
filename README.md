# Cameraderie

Private groups for sharing **full-fidelity, zero-data-loss** photos and videos.
Originals are stored byte-for-byte in Cloudflare R2 and never re-encoded;
thumbnails and streamable previews are the only files the server derives.

This repo contains the **backend, web client, and native iOS + Android apps**,
with photo **and** video support. Everything shares one API.

## Architecture

```
            control plane (metadata, auth, presigned URLs)
Client ───────────────────────────────────────────────▶ API (Fastify)
  │                                                        │
  │  data plane: bytes go straight to R2, never the API    ├─▶ MariaDB (Drizzle)
  ▼                                                        ├─▶ Redis + BullMQ ──▶ Worker
Cloudflare R2  ◀─── originals + derivatives ───────────────┘        (sharp + ffmpeg)
```

- **Direct, metered storage.** Clients upload/download straight to R2 via
  presigned multipart URLs. The API only brokers metadata and permissions.
- **Originals immutable, previews derived.** The worker downloads each original,
  re-verifies its on-device SHA-256, then generates a thumbnail + preview.
- **Quota enforced before bytes move.** Upload-begin rejects if the file would
  exceed the user's plan quota (5 GB free by default).

## Packages

| Package | What it is |
| --- | --- |
| `packages/shared` | Shared TS types, zod DTOs, media classification, R2 key conventions, plans |
| `packages/db` | Drizzle schema for MariaDB (+ Better Auth tables) and migrations |
| `packages/api` | Fastify API: auth, groups/invites, 3-step upload broker, media, favourites, quota, billing webhook |
| `packages/worker` | BullMQ worker: checksum verify, content-safety scan, `sharp` thumbnails, FFmpeg video previews, libraw RAW decoding, hourly R2 reconciliation + stale-upload sweeper |
| `packages/web` | SvelteKit client (SPA): auth, group feed, direct-to-R2 upload, favourite, download, settings, admin moderation |
| `apps/ios` | Native SwiftUI client (XcodeGen). True-original fetch via `PHAssetResource`, bearer auth, R2 multipart upload |
| `apps/android` | Native Kotlin/Compose client. Original bytes via `ContentResolver`/MediaStore, WorkManager uploads, bearer auth |

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1, Docker (for MariaDB + Redis)
- A Cloudflare R2 bucket + API token (Access Key / Secret) for real uploads
- `ffmpeg` + `libraw` on the worker host (bundled in the worker Docker image)

## Quick start (local dev)

```bash
bun install

# 1. Config
cp .env.example .env          # fill in BETTER_AUTH_SECRET + R2_* (see below)
openssl rand -base64 32       # value for BETTER_AUTH_SECRET

# 2. Infra
docker compose up -d mariadb redis

# 3. Database
bun run db:generate   # (already committed; re-run after schema changes)
bun run db:migrate

# 4. Run the services (separate terminals)
bun run dev:api      # http://localhost:3000
bun run dev:worker
bun run dev:web      # http://localhost:5173
```

Set `packages/web/.env` → `PUBLIC_API_URL=http://localhost:3000` (a copy is
already provided).

## Full stack with Docker Compose

```bash
cp .env.example .env   # fill in secrets
docker compose up --build
```

Brings up MariaDB, Redis, the API (runs migrations on boot), the worker, and the
web client. The API is on `:3000`, web on `:5173`.

## Cloudflare R2 setup

1. Create a bucket (e.g. `cameraderie`) and an R2 API token; put the credentials
   in `.env` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`).
2. **Bucket CORS** — the browser PUTs parts directly to R2 and must read the
   `ETag` response header. Add a CORS rule to the bucket:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5173"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Add your production web origin alongside `localhost` when you deploy.
3. Keep the bucket **private** — all access is via short-lived presigned URLs.

## API surface (summary)

- **Auth** (Better Auth) — `POST /api/auth/sign-up/email`, `/sign-in/email`,
  `/sign-out`; bearer tokens for native clients.
- **Groups** — `POST/GET /groups`, `GET /groups/:id`, members, leave, delete.
- **Invites** — `POST /groups/:id/invites`, `GET /invites/:code`, `POST /invites/:code/accept`.
- **Upload (3-step, resumable)** — `POST /media/uploads` → `/:id/complete` →
  `/:id/abort`; `GET /media/uploads/:id` returns which parts R2 already has plus
  presigned URLs for the rest, so a dropped transfer resumes instead of
  restarting. Declared type + size are validated server-side before any bytes move.
- **Media** — `GET /groups/:id/media` (feed), `GET /media/:id`, `/download`, `/preview`, `DELETE /media/:id`.
- **Favourites** — `PUT/DELETE /media/:id/favourite`, `GET /media/:id/favourites`.
- **Account** — `GET /me`, `/me/usage`, `/me/entitlements`, `DELETE /me` (GDPR); `POST /billing/webhook`.
- **Moderation** — `POST /media/:id/report`; admin-only `GET /admin/reports`, `POST /admin/reports/:id/resolve`.

Uploads and invite creation are rate-limited per IP; a 300/min global limit
covers everything else. Make a user an admin with
`UPDATE user SET role='admin' WHERE email='you@example.com';`.

## Native apps

Both live under `apps/` and talk to the same API using **bearer tokens** (not
cookies): sign-in returns a token stored in the iOS Keychain / Android
EncryptedSharedPreferences and sent as `Authorization: Bearer …`.

- **iOS** (`apps/ios`) — SwiftUI, iOS 17+. `xcodegen generate && open
  Cameraderie.xcodeproj`, set a signing team, point `AppConfig.apiBaseURL` at
  the backend. Fetches the true original via `PHAssetResource`.
- **Android** (`apps/android`) — Kotlin + Compose. Open in Android Studio (it
  generates the Gradle wrapper on first sync), set `AppConfig.API_BASE_URL`
  (use `http://10.0.2.2:3000` from the emulator). Uploads run in a WorkManager
  worker; original bytes come from `ContentResolver`.

Both compute SHA-256 over the exact original bytes and perform the 3-step
direct-to-R2 multipart upload. Neither was compiled in this environment — expect
minor version-drift fixes on first build. See each app's README for details.

## Production deployment

`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
adds a **Caddy** reverse proxy with automatic HTTPS in front of the API and web
app. Set `API_DOMAIN`/`WEB_DOMAIN` (and the https `API_URL`/`WEB_URL`) in `.env`.
Schedule `scripts/backup-db.sh` from cron for MariaDB → R2 backups (needs
`rclone` with an `r2` remote).

## Verified

`bun run build`, per-package typechecks, and `bun run test` (18 unit tests) all
pass; CI (`.github/workflows/ci.yml`) runs them plus the Docker image builds. A
local smoke test against real MariaDB + Redis exercised: sign-up → session →
group CRUD → usage → invite; the quota-reject (413 before any bytes move), auth
(401), validation (400), **upload type-rejection and size-cap** guards; the full
moderation flow (report → admin list → takedown purges media while keeping an
audit record); account deletion (purge + ownership transfer + cascade); and the
billing webhooks (Stripe bad-signature → 400, RevenueCat grant/expire → plan
sync). The R2 data-plane paths — multipart upload, resume (`ListParts`), worker
transcode, sweeper, and reconciliation — need real R2 credentials to run
end-to-end; the native apps need Xcode / Android Studio to build.

### Reliability jobs (worker, hourly)

- **Reconciliation** — treats R2 as the source of truth: marks DB rows whose
  original is missing in R2 as `failed`, deletes orphaned R2 originals with no
  owning row, then recomputes every user's `used_bytes`.
- **Stale-upload sweeper** — aborts R2 multiparts and clears rows stuck in
  `uploading` past a TTL (`STALE_UPLOAD_TTL_MINUTES`, default 24h) so abandoned
  uploads stop leaking storage.

## Billing

- **Web** — `POST /billing/checkout {plan}` creates a Stripe Checkout session and
  returns a hosted URL (the Settings page redirects to it). Configure
  `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX`.
- **Mobile** — in-app purchase via RevenueCat; its webhook grants the entitlement.
- **Webhooks** — `POST /billing/webhook` handles both: Stripe events are
  signature-verified against the raw body (`STRIPE_WEBHOOK_SECRET`); RevenueCat
  events are authenticated by a shared bearer (`REVENUECAT_WEBHOOK_SECRET`). Both
  sync a single `storage_tier` entitlement → the user's plan/quota. A lapse
  downgrades to free and blocks new uploads — files are never auto-deleted.

## Observability & safety

- **Error tracking** — set `SENTRY_DSN` to capture 5xx errors in the API and
  terminal job failures in the worker (disabled when unset).
- **Content safety** — the worker checks each original's SHA-256 against a
  denylist (`BLOCKED_SHA256`) before generating derivatives; a match purges the
  upload and refunds quota. Swap the denylist for a hash-matching service (e.g.
  PhotoDNA / NCMEC) for a public launch — the interface in `worker/src/safety.ts`
  stays the same.

## Status & what's next

- **Production auth cookies** — the web client uses cookie auth; when web and API
  are on different domains, set `sameSite=none; secure` (already done for
  `NODE_ENV=production`) and a shared parent domain, or switch web to bearer.
- **Native builds** — `apps/ios` and `apps/android` need Xcode / Android Studio to
  compile (not possible in this environment); expect minor version-drift fixes.
- **TODO — iOS background uploads + invite screen** — the iOS app currently
  uploads on a foreground `URLSession` and has no invite-accept screen. Switch to
  a background `URLSession` (plan: "background transfers") and add the invite
  screen. Android already uses WorkManager + has the invite flow. Not done because
  it can't be compiled/verified here.

See **[SETUP.md](./SETUP.md)** for the full operator checklist (accounts, keys,
deployment, native builds).
