# Cameraderie

Private groups for sharing **full-fidelity, zero-data-loss** photos and videos.
Originals are stored byte-for-byte in Cloudflare R2 and never re-encoded;
thumbnails and streamable previews are the only files the server derives.

This repo is the **backend + web foundation** (Phase 1 of the build plan), with
photo **and** video support. Native iOS/Android apps are planned next and will
reuse the same API.

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
| `packages/worker` | BullMQ worker: checksum verify, `sharp` thumbnails, FFmpeg video previews, RAW fallback |
| `packages/web` | SvelteKit client (SPA): auth, group feed, direct-to-R2 upload, favourite, download |

## Prerequisites

- Node ≥ 20, pnpm ≥ 10, Docker (for MariaDB + Redis)
- A Cloudflare R2 bucket + API token (Access Key / Secret) for real uploads
- `ffmpeg` on the worker host (bundled in the worker Docker image)

## Quick start (local dev)

```bash
pnpm install

# 1. Config
cp .env.example .env          # fill in BETTER_AUTH_SECRET + R2_* (see below)
openssl rand -base64 32       # value for BETTER_AUTH_SECRET

# 2. Infra
docker compose up -d mariadb redis

# 3. Database
pnpm --filter @cameraderie/db generate   # (already committed; re-run after schema changes)
pnpm --filter @cameraderie/db migrate

# 4. Run the services (separate terminals)
pnpm dev:api      # http://localhost:3000
pnpm dev:worker
pnpm dev:web      # http://localhost:5173
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
- **Upload (3-step)** — `POST /media/uploads` → `/:id/complete` → `/:id/abort`.
- **Media** — `GET /groups/:id/media` (feed), `GET /media/:id`, `/download`, `/preview`, `DELETE /media/:id`.
- **Favourites** — `PUT/DELETE /media/:id/favourite`, `GET /media/:id/favourites`.
- **Account** — `GET /me`, `/me/usage`, `/me/entitlements`; `POST /billing/webhook`.

## Verified

`pnpm -r build` and per-package typechecks pass. A local smoke test exercised:
sign-up → session → create/list group → usage → invite, plus the quota-reject
(413 before any bytes move), auth (401), and validation (400) guards. The R2
upload + worker transcode path needs real R2 credentials to run end-to-end.

## Status & what's next

Not yet wired (clean extension points exist):

- **Billing** — `POST /billing/webhook` upserts entitlements but signature
  verification is a TODO; RevenueCat/Stripe SDK wiring pending.
- **Native apps** — iOS (`PHAssetResource`) and Android (`MediaStore`) clients.
- **Reconciliation job** — periodic `used_bytes` vs R2 truth-up.
- **Moderation** — report + takedown workflow before any public launch.
- **Production auth cookies** — set `sameSite=none; secure` + a shared parent
  domain (or use bearer tokens) when web and API are on different domains.
