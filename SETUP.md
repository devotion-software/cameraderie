# Cameraderie — operator setup checklist

Everything the code can't do for itself: accounts, secrets, deploying, and
building the native apps. Work top-to-bottom. Items are marked:

- **[required]** — needed to run the app at all
- **[prod]** — needed for a public/production deployment
- **[optional]** — a feature stays disabled until you configure it
- **[todo]** — known follow-up work in the code

---

## 1. Secrets & environment — [required]

1. Copy the template and open it:
   ```bash
   cp .env.example .env
   ```
2. Generate the auth secret and paste it as `BETTER_AUTH_SECRET`:
   ```bash
   openssl rand -base64 32
   ```
3. Set the database passwords (`MARIADB_PASSWORD`, `MARIADB_ROOT_PASSWORD`) to
   your own values. For local dev the defaults work.
4. `ALLOWED_SIGNUP_EMAILS` is a bootstrap allowlist for your own first account —
   sign-up is invite-only everywhere, including local dev (see section
   "Keeping sign-up invite-only" below). Set it to your own email (comma-
   separated if more than one) so you have an account to log in with before
   anyone has invited you.
5. **Local storage (dev):** uncomment the Garage `R2_*` block in `.env.example`

## 1b. Auth methods — [required for OTP email, optional for Google/Apple]

No passwords: sign-in is email OTP, Google, Apple, or a passkey
(`packages/api/src/auth.ts`). Each is independently optional — the server
boots fine without any of them configured, and the corresponding web UI
button just errors until it is.

- **Email OTP** — in production, set `RESEND_API_KEY`
  (https://resend.com/api-keys) and `EMAIL_FROM`. In local dev, use Mailpit
  instead: it's started by `make up` (part of `INFRA` in the Makefile); set
  `SMTP_HOST=localhost` / `SMTP_PORT=1025` and OTP emails land at
  http://localhost:8025 instead of a real inbox. With neither Resend nor SMTP
  configured, the OTP code is logged to the API console instead — fine to
  unblock yourself, not a substitute for actually testing email delivery.
- **Google** — create an OAuth client at console.cloud.google.com (APIs &
  Services → Credentials), redirect URI `{API_URL}/api/auth/callback/google`.
  Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- **Apple** — create a Services ID + key at developer.apple.com (requires a
  paid Apple Developer account), redirect URI
  `{API_URL}/api/auth/callback/apple`. Set `APPLE_CLIENT_ID`,
  `APPLE_APP_BUNDLE_IDENTIFIER`, and `APPLE_CLIENT_SECRET` (a signed JWT you
  generate from your Apple private key — see Better Auth's Apple provider
  docs for the exact steps).
- **Passkeys** — no setup needed; registered from Settings once signed in
  another way (a WebAuthn credential has to attach to an existing session).
   (`R2_ENDPOINT=http://localhost:3900`, access key `GKdeadbeefdeadbeefdeadbeef` /
   secret `deadbeef...` — dev-only placeholder creds, see the file) so dev runs
   against the local Garage container instead of real R2 — see section 2.
6. Leave Stripe/RevenueCat/Sentry/BLOCKED_SHA256 blank for now (sections 5–8).

**Never commit `.env`.** It's git-ignored already.

---

## 2. Cloudflare R2 — [required for staging/production]

All media bytes live here; the app only brokers presigned URLs.

> **Local dev doesn't need R2.** `make up` starts a local, S3-compatible
> [Garage](https://garagehq.deuxfleurs.fr/) server (S3 API at
> http://localhost:3900) and auto-creates the bucket, access key, and CORS
> rule. Point the app at it with the Garage `R2_*` block from `.env.example`
> (section 1.5). Do the steps below only when you want real R2 for
> staging/production.

1. In the Cloudflare dashboard → **R2** → create a bucket (e.g. `cameraderie`).
2. **R2 → Manage API Tokens** → create an API token with Object Read & Write on
   that bucket. Copy the Access Key ID and Secret.
3. Fill in `.env`:
   - `R2_ACCOUNT_ID` — your Cloudflare account id
   - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — from the token
   - `R2_BUCKET` — the bucket name
   - `R2_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com` (or leave
     blank; it's derived from the account id)
4. **Bucket CORS** (required — the browser PUTs parts directly and must read the
   `ETag` header). R2 → your bucket → Settings → CORS policy:
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
   Add your production web origin (e.g. `https://app.yourdomain.com`) to
   `AllowedOrigins` when you deploy.
5. **[prod]** Set a bucket **lifecycle rule** to auto-delete the `backups/`
   prefix after N days (section 10), and consider enabling object versioning.
6. Keep the bucket **private** — never make it public.

---

## 3. Run it locally — [required]

The [Makefile](./Makefile) wraps the common tasks — `make help` lists them all.

```bash
make install          # bun install

make up               # start MariaDB + Redis + Garage (local S3), bucket auto-created
make migrate          # apply the DB schema (safe to re-run)
make seed             # optional: a demo login (demo@cameraderie.local)

make dev              # build the shared libs, then run api + worker + web (Ctrl-C stops all)
```

There are no passwords — sign-in is email OTP, Google, Apple, or a passkey
(see section 1b). Open http://localhost:5173 and sign in with the seeded
account (`demo@cameraderie.local` — it's also a site admin with full
permissions, see "Keeping sign-up invite-only" below for how to sign up any
other account). With `SMTP_HOST` set (see section 1b), the sign-in code shows
up at http://localhost:8025 (Mailpit); otherwise it's printed to the API's
console — copy it from there. Then create a group and upload a photo. If
uploads fail against
**real R2**, re-check the CORS rule (step 2.4); against local Garage it's
configured for you.

Other handy targets: `make stop` (stop infra), `make reset-db` (wipe + migrate +
seed), `make test`, `make typecheck`, `make lint` / `make format`,
`make console` (list objects in the local Garage bucket — no web console).

**Full-stack alternative** (builds images, runs migrations on boot):

```bash
docker compose up --build
```

---

## 4. Make yourself an admin — [required for moderation]

Admins see `/admin/reports` and can take media down. After signing up once (the
infra from `make up` must be running):

```bash
docker compose exec mariadb \
  mariadb -ucameraderie -p<MARIADB_PASSWORD> cameraderie \
  -e "UPDATE user SET role='admin' WHERE email='you@example.com';"
```

Sign out and back in to pick up the role.

---

## 5. Stripe (web payments) — [optional]

1. Create a Stripe account. In **test mode** first.
2. **Products** → create "Pro" and "Max" products, each with a recurring Price.
   Copy the two **Price IDs** (`price_...`).
3. **Developers → API keys** → copy the **Secret key** (`sk_...`).
4. **Developers → Webhooks** → add an endpoint:
   - URL: `https://<your-api-domain>/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_...`).
5. Fill in `.env`:
   ```
   STRIPE_SECRET_KEY=sk_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_PRO=price_...
   STRIPE_PRICE_MAX=price_...
   ```
6. Test locally with the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/billing/webhook
   ```
   Then upgrade from the web app's **Settings** page.

---

## 6. RevenueCat (mobile payments) — [optional]

1. Create a RevenueCat project; connect your App Store Connect and Google Play
   apps.
2. Create a single **entitlement** named `storage_tier`, and products/offerings
   for the Pro and Max tiers in each store.
3. **Project settings → Webhooks** → add:
   - URL: `https://<your-api-domain>/billing/webhook`
   - Set the **Authorization header** to `Bearer <a long random string>`.
4. Put that same random string in `.env` as `REVENUECAT_WEBHOOK_SECRET`.
5. Wire the RevenueCat SDK into the iOS/Android apps (purchase UI) — this is app
   code you'll add alongside the native build (section 12).

> The backend already maps the entitlement → plan → quota for both providers.

---

## 7. Sentry (error tracking) — [optional]

1. Create a Sentry (or self-hosted GlitchTip) project; copy its **DSN**.
2. Set `SENTRY_DSN=https://...` in `.env`. Applies to both API and worker; leave
   blank to disable.

---

## 8. Content-safety hash list — [optional, but do before public launch]

The worker checks each upload's SHA-256 against a denylist. A match
**quarantines** (not deletes) the upload: the original + row are preserved as
evidence in state `quarantined`, the item is never listed/served/deletable via
the app, quota is refunded, and a Sentry alert fires. Report quarantined content
to the relevant authority (UK: the IWF, and police / CEOP) and remove it
out-of-band once preserved.

- Quick start: put comma-separated SHA-256 hex digests in `BLOCKED_SHA256`.
- **[prod]** Replace the static list with a perceptual hash-matching service —
  UK: the IWF hash list; elsewhere PhotoDNA / NCMEC. Swap the body of
  `packages/worker/src/safety.ts` (`checkContentSafety`) — the interface stays
  the same, so nothing else changes.
- Ensure Sentry is configured (section 7) so quarantine alerts reach you.

### Keeping sign-up invite-only — [already on by default]

Account creation (email OTP's auto sign-up, or first Google/Apple sign-in)
only succeeds for an email that's either on the static `ALLOWED_SIGNUP_EMAILS`
allowlist, or has been
sent a group invite with that email attached (create one from a group page,
or `POST /groups/:id/invites` with `{"email": "..."}`). There is no open
registration, in dev or prod.

`ALLOWED_SIGNUP_EMAILS` exists purely to bootstrap your own first account,
since you have nobody yet to invite you — set it to your email, sign up, then
leave it blank (or remove your own address) once you're in. From there,
invite others by email from within a group, or flip a trusted user's
`canInviteMembers` permission at `/admin/users` so they can invite people
themselves. The same page controls `canCreateGroups`, i.e. who's allowed to
start new groups at all — both default to off for everyone except site
admins.

---

## 9. Email verification — [n/a]

There's nothing to configure here any more: there's no password to reset, and
email OTP sign-in inherently proves control of the inbox, so Better Auth marks
`emailVerified: true` on every OTP-created account automatically.

---

## 10. Database backups — [prod]

`scripts/backup-db.sh` dumps MariaDB and uploads a gzip to R2.

1. Install `rclone` on the host and configure a remote named `r2`:
   ```bash
   rclone config   # type: s3, provider: Cloudflare, use your R2 keys
   ```
2. Add a cron entry (daily 03:15):
   ```cron
   15 3 * * * cd /opt/cameraderie && set -a && . ./.env && set +a && ./scripts/backup-db.sh >> /var/log/cameraderie-backup.log 2>&1
   ```
3. Set an R2 lifecycle rule on the `backups/` prefix to keep ~14 days.

---

## 11. Production deployment — [prod]

1. Provision the host (plan targets a Hetzner CX23) with Docker + Compose.
2. Point two DNS A records at it, e.g. `app.yourdomain.com` and
   `api.yourdomain.com`.
3. In `.env` set:
   ```
   NODE_ENV=production
   API_DOMAIN=api.yourdomain.com
   WEB_DOMAIN=app.yourdomain.com
   API_URL=https://api.yourdomain.com
   WEB_URL=https://app.yourdomain.com
   ```
4. Add `https://app.yourdomain.com` to the R2 CORS `AllowedOrigins` (step 2.4).
5. Bring up the stack with the Caddy overlay (automatic HTTPS via Let's Encrypt):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
6. **Firewall**: expose only 80/443 (Caddy). Block public access to 3000, 5173,
   3306, 6379.
7. Update the Stripe and RevenueCat webhook URLs to the `api.yourdomain.com` host.

---

## 12. Native apps — [required for mobile, needs a Mac / Android Studio]

Neither app was compiled in this environment; expect minor version-drift fixes on
first build.

**iOS** (`apps/ios`):

1. Install XcodeGen (`brew install xcodegen`), then `make ios` (runs
   `xcodegen generate && open Cameraderie.xcodeproj`).
2. Set a **Development Team** (Signing & Capabilities) for code signing.
3. Set `apiBaseURL` in `Sources/App/AppConfig.swift` (Simulator can use
   `http://localhost:3000`).
4. Build & run on a device/simulator.

**Android** (`apps/android`):

1. Open `apps/android` in Android Studio (it generates the Gradle wrapper on
   first sync). With a local Android SDK + `gradle`, `make android-build`
   (assembles the debug APK) and `make android-install` (installs to a connected
   device/emulator) also work from the CLI.
2. Set `API_BASE_URL` in `.../app/AppConfig.kt`. From the emulator use
   `http://10.0.2.2:3000` (not `localhost`).
3. Build & run.

Both already fetch true originals, checksum them, and do the resumable 3-step R2
upload. For paid tiers, add the RevenueCat purchase UI (section 6).

---

## 13. [todo] iOS background uploads + invite screen

Follow-up coding work in `apps/ios`, deferred because it can't be compiled here:

- Switch uploads from the foreground `URLSession` to a **background
  `URLSession`** so large transfers continue when the app is backgrounded (the
  plan calls for this; Android already uses WorkManager).
- Add the **invite-accept screen** (the API — `POST /invites/:code/accept` — and
  the Android flow already exist; iOS has no UI for it yet).

---

## 14. Pre-launch validation & legal — [prod]

- **Phase 0 spikes** (from the plan): time an FFmpeg video-preview transcode on
  the actual CX23 to confirm the worker keeps up; prove a mobile multipart upload
  resumes after a dropped connection (the `GET /media/uploads/:id` endpoint
  supports it).
- **Legal**: Terms of Service, Privacy Policy (originals retain EXIF/GPS by
  design — disclose this), and decide your merchant-of-record / tax handling
  before taking payments.
- **Free-tier sizing**: 5 GB is the default; revisit once video usage is real
  (`FREE_TIER_BYTES`, and the tiers in `packages/shared/src/plans.ts`).

---

## Quick reference

| What           | Where                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| All config     | `.env` (template: `.env.example`)                                               |
| List tasks     | `make help`                                                                     |
| Install        | `make install`                                                                  |
| Start infra    | `make up` (MariaDB + Redis + Garage) / `make stop`                              |
| Run migrations | `make migrate` (`make generate` for a new one)                                  |
| Seed demo data | `make seed`                                                                     |
| Dev servers    | `make dev` (api + worker + web together)                                        |
| Reset database | `make reset-db`                                                                 |
| Full stack     | `docker compose up --build`                                                     |
| Production     | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` |
| Tests          | `make test` (type-check: `make typecheck`)                                      |
| Native apps    | `make ios` / `make android-build`                                               |
| Make admin     | SQL `UPDATE user SET role='admin' …`                                            |
