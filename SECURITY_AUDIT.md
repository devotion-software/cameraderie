# Cameraderie — Pre-Release Security & Readiness Audit

_Date: 2026-10-07. Produced from four parallel code reviews covering API auth,
billing/uploads/storage, worker/infra, and web/DB/release-readiness. Findings
marked "corroborated" were independently flagged by more than one reviewer._

Status legend: ☐ open · ☑ fixed (see "Fix log" at bottom)

---

## 🔴 Critical — reachable before/around auth

### C1 — DB & Redis published to the public internet in prod; Redis unauthenticated

- **Where:** `docker-compose.yml:16-17,31-32`; `docker-compose.prod.yml` (never unpublishes them)
- **What:** Base compose maps `3306:3306` (MariaDB) and `6379:6379` (Redis) to
  `0.0.0.0`. The prod overlay only _adds_ Caddy. Redis has no `requirepass`.
  Docker's published ports write their own iptables rules and **bypass UFW**, so
  OS-level firewalling silently does not protect them.
- **Impact:** Anonymous Redis (BullMQ queue tampering, `CONFIG SET` RCE primitives)
  and a directly-exposed MariaDB. MinIO (`minioadmin/minioadmin`) is also still
  live and published in prod.
- **Fix:** Bind mariadb/redis/minio to `127.0.0.1` (or drop host port mappings) in
  the prod overlay; set a Redis password; move MinIO to a dev-only profile.

### C2 — RevenueCat webhook auth is optional → free plan upgrades for anyone

- **Where:** `packages/api/src/routes/billing.ts:135`
- **What:** The bearer secret is only checked `if (env.REVENUECAT_WEBHOOK_SECRET)`
  is set. On a Stripe-only deploy that never configures RevenueCat, the check is
  skipped and the body is trusted. `app_user_id` is attacker-controlled with no
  binding to caller identity and no replay protection.
- **Impact:** `POST /billing/webhook` with
  `{"app_user_id":"<any-id>","entitlement_ids":["max"],"type":"PURCHASE"}` grants
  any user the 1 TiB Max plan for free.
- **Fix:** Fail closed when the secret is unset (reject the webhook).

---

## 🟠 High

### H3 — Signup allowlist fails open _(corroborated)_

- **Where:** `packages/api/src/auth.ts:22-27`
- **What:** Empty/unset `ALLOWED_SIGNUP_EMAILS` = fully open registration, guarded
  only by `console.warn`, even in production. One missing env var silently defeats
  the invite-only access-control safety model.
- **Fix:** Hard-fail startup in production when the allowlist is empty.

### H4 — No timeouts/resource limits on media processing

- **Where:** `packages/worker/src/ffmpeg.ts:11-24`, `packages/worker/src/libraw.ts:25-36`; no `mem_limit`/`cpus` on the `worker` compose service
- **What:** `spawn` without timeout; no ffmpeg `-timelimit`/thread cap. Adversarial
  media (hang, pathological transcode, decompression bomb) ties up a worker slot
  indefinitely and can OOM the single-box host. Main untrusted-media DoS surface.

### H5 — Containers run as root

- **Where:** all three Dockerfiles (no `USER`; `oven/bun:1` defaults to root)
- **What:** Worker decodes untrusted media via ffmpeg/dcraw/libvips; a native
  decoder memory bug becomes root-level RCE in the container.

### H6 — ffmpeg protocol whitelist unrestricted → SSRF / local-file disclosure

- **Where:** `packages/worker/src/ffmpeg.ts:33-101`
- **What:** User files passed to `-i` with no `-protocol_whitelist file,crypto` and
  no forced demuxer. An allowlisted-extension file can be an HLS/concat playlist
  referencing external URLs or `/etc/passwd`, exfiltrated into the preview.

### H7 — Legal/compliance blockers

- No Terms of Service, Privacy Policy, or cookie/consent pages in web routes.
- No age gate at signup.
- GDPR: right-to-erasure done (`DELETE /me`) but no data-export/portability and no
  consent capture. Mandatory for a UK photo app with personal data + payments.

### H8 — Zero automated tests on critical paths

- Tests cover only pure helpers. Nothing guards quota enforcement, the 3-step
  upload broker, auth guards/`requireMembership`, account-deletion ownership
  transfer, moderation takedown, or billing webhook signature verification.

---

## 🟡 Medium

- **M — Quota is TOCTOU; parallel uploads bypass it** _(corroborated)_ —
  `packages/api/src/quota.ts:27-35` + `uploads.ts:56,167`. Read-only check at begin,
  charged only at complete with no re-check. N concurrent begins all pass. Reserve
  atomically at begin or re-assert in the complete transaction.
- **M — Rate limiting ineffective behind the proxy** — `server.ts:20` no
  `trustProxy`; every client collapses to one bucket. No per-account throttle +
  `requireEmailVerification:false` ⇒ login brute-force open.
- **M — Weak default credentials as compose fallbacks** — `change-me-root`,
  `cameraderie:cameraderie`, `minioadmin`, placeholder `BETTER_AUTH_SECRET`
  (only `min(16)`). No startup guard rejects placeholders.
- **M — SVG passes the upload allowlist** — `packages/shared/src/media.ts:124-130`
  accepts any `image/*` incl. scriptable `image/svg+xml`. Stored-XSS vector if
  originals are served inline via presigned GET.
- **M — PII to Sentry** — `packages/worker/src/process.ts:89-96` sends
  `uploaderId`, `objectKey`, `sha256` on quarantine (CSAM-adjacent evidence to a US
  processor). Confirm lawful basis / DPA.
- **M — Backup password on process command line** — `scripts/backup-db.sh:28-30`
  uses `-p"$PASS"` (visible in `ps`). Use `MYSQL_PWD`/`--defaults-extra-file`.
  Also: DB dumps land in the same bucket the app R2 key can read.
- **M — Worker healthcheck is liveness-only** — `/tmp` heartbeat doesn't prove
  Redis connectivity; a disconnected worker reports healthy.
- **M — `requireEmailVerification:false` + no password-reset flow** (email sender
  unconfigured).
- **M — Unpinned base images** — `minio:latest`, floating `bun:1`/`mariadb:11`/
  `redis:7`/`caddy:2`. Pin by digest for prod.

---

## 🟢 Low

- Quarantine invariant not uniform — `favourites.ts`/`moderation.ts` check
  membership but not state (no bytes served).
- `DELETE /me` not transactional — mid-way crash orphans state (reconcile converges).
- Unsanitized filename extension flows into R2 keys / worker paths — not currently
  exploitable; add `[a-z0-9]` guard as defense-in-depth.
- Stale-upload sweeper may abort a slow large upload if parts don't bump
  `updatedAt` — confirm or raise TTL.
- CI runs dependency lifecycle scripts on fork PRs; Caddy sends no HSTS/security
  headers; no Stripe `event.id` dedup (upsert makes it state-idempotent).

---

## ✅ Verified correct (common breakages that are handled)

- Core authz model solid — no media/group/invite IDOR; every path resolves the
  resource then `requireMembership` against the resource's own group. Delete
  enforces uploader-or-owner.
- Site-admin gate is real — `requireAdmin` checks `role==='admin'`; `role` is
  `input:false` (no self-promotion). Admin web pages gated server-side.
- Stripe signature verification correct — raw bytes preserved and passed to
  `constructEvent`; checkout binds plan to verified price + authenticated user.
- Multipart ETags from R2 `ListParts` (not client); declared size re-verified;
  presigned URLs caller-scoped with finite TTL.
- Zero-data-loss holds — reconcile paginates fully before marking failed, lists R2
  before DB for orphan deletion, never deletes an original in "mark failed".
- Quarantine prevents serving and deliberately doesn't throw; safety scan can't
  fail open; no command injection (shell-free `spawn`).
- No web XSS, no secrets in client bundle, single-origin CORS, prod cookies
  `secure`+`sameSite:none`.
- DB schema sound — deliberate cascade/set-null, right unique constraints + feed
  indexes, no destructive migrations.

---

## Fix log

- **C1** — ☑ Fixed 2026-10-07 in `docker-compose.prod.yml` + `.env.example`.
  MariaDB/Redis/MinIO host ports rebound to `127.0.0.1` in the prod overlay (so
  they bypass-UFW-expose nothing to the internet); Redis now requires
  `REDIS_PASSWORD` (`--requirepass`, mandatory `:?` guard — compose refuses to
  start without it) and api/worker connect as `redis://:$REDIS_PASSWORD@redis:6379`;
  `REDISCLI_AUTH` keeps the healthcheck working; new `REDIS_PASSWORD` in
  `.env.example`. Verified: merged `docker compose config` authenticates Redis and
  binds loopback; missing `REDIS_PASSWORD` fails config with a clear error.
- **C2** — ☑ Fixed 2026-10-07 in `packages/api/src/routes/billing.ts`.
  `handleRevenueCatWebhook` now fails closed: an unset `REVENUECAT_WEBHOOK_SECRET`
  rejects the webhook (`billing_unavailable`) instead of trusting the payload.
  Verified: api typecheck passes.
- **C2 residual** — ☑ Fixed 2026-10-07 (replay protection + identity binding).
  - New `webhook_events` idempotency table (migration `0004_lowly_omega_sentinel.sql`,
    PK `${provider}:${eventId}`) recorded in the SAME transaction that applies the
    entitlement — a replayed/duplicated Stripe or RevenueCat delivery collides on the
    PK and the whole apply rolls back. Duplicate is treated as an idempotent no-op
    (`applyOnce` + `isDuplicateKeyError`), not a 500.
  - RevenueCat webhooks now require `app_user_id` to resolve to a real `user` row
    before applying (accept-and-ignore unknown ids) — the shared secret + real-user
    check is the identity binding; forged/stale ids can't create phantom entitlements.
  - Pure helpers extracted to `packages/api/src/billing-webhook.ts` and covered by
    `packages/api/test/billing-webhook.test.ts` (8 tests).
  - ⚠️ Deploy note: run DB migration `0004` (`bun run --filter=@cameraderie/db migrate`)
    before/with this API version.
  - Verified: api typecheck + full test suite (26 tests) pass.
  - Inherent limit (by design): RevenueCat has no per-user signature, so after the
    shared-secret gate the app_user_id↔plan mapping is still vouched for by RevenueCat
    itself; this is standard for RC webhooks.
- **H3** — ☑ Fixed 2026-10-07 in `packages/api/src/auth.ts`.
  An empty `ALLOWED_SIGNUP_EMAILS` now throws at startup when
  `NODE_ENV==='production'` (open sign-up only remains possible in dev, with the
  existing warning). Verified: api typecheck passes.

- **H4** — ☑ Fixed 2026-10-07 (media-processing timeouts + resource limits).
  `packages/worker/src/ffmpeg.ts` and `libraw.ts` now spawn with a hard wall-clock
  `timeout`/`SIGKILL`; ffmpeg additionally gets `-timelimit` (CPU) and `-threads`
  cap. New knobs in `packages/worker/src/env.ts` (`FFMPEG_TIMEOUT_SECONDS`,
  `FFPROBE_TIMEOUT_SECONDS`, `DCRAW_TIMEOUT_SECONDS`, `FFMPEG_THREADS`) + `.env.example`.
  Worker container capped in `docker-compose.prod.yml` (`mem_limit`/`cpus`/`pids_limit`,
  tunable via `WORKER_MEM_LIMIT`/`WORKER_CPUS`). Verified: worker typecheck + tests pass,
  compose config shows the caps.
- **H5** — ☑ Fixed 2026-10-07 (drop root in containers). `USER bun` (uid 1000,
  ships in `oven/bun:1`) added to api/worker/web Dockerfiles after the build stage.
  Verified: `docker run oven/bun:1 id bun` → uid=1000.
- **H6** — ☑ Fixed 2026-10-07 (ffmpeg SSRF). All ffmpeg/ffprobe inputs now carry
  `-protocol_whitelist file,crypto,data`, blocking http/tcp/rtmp so a crafted
  HLS/DASH/concat file can't make ffmpeg fetch remote URLs. Verified: worker typecheck.
  Residual (lower risk): local-file read via a crafted playlist demuxer is further
  contained by the non-root container (H5); revisit with a forced demuxer if needed.

- **H7** — ☑ Largely addressed 2026-10-07/08 (decisions: 18+ gate, clearly-marked
  starter legal drafts). Remaining work is non-code (legal review + fill placeholders).
  - **Age/consent gate:** new nullable `user.accepted_terms_at` column (migration
    `0005_slippery_lady_vermin.sql`). `auth.ts` enforces it in `create.before`
    (signup rejected with `BAD_REQUEST` unless `acceptedTermsAt` is sent) — always on,
    independent of the email allowlist. Web signup (`login/+page.svelte`) adds required
    "I am 18+" and "I agree to Terms/Privacy" checkboxes; submit disabled until both
    ticked; sends the consent timestamp. Verified better-auth 1.7.7 coerces the ISO
    string → Date (core `factory.mjs:117`). Seed updated.
  - **GDPR data export (right of access):** new `GET /me/export` returns the user's
    account, memberships, owned groups, media metadata, favourites and subscription as
    a JSON download (internal R2 keys omitted). "Export my data" button in Settings.
  - **Legal pages:** `/legal/terms` and `/legal/privacy` starter drafts with a
    prominent "DRAFT — not legally reviewed" banner and bracketed placeholders; linked
    from the signup form, Settings, and a global footer.
  - ⚠️ Deploy note: run migration `0005`. ⚠️ Before public launch: have a solicitor
    review both legal pages and complete the `[bracketed]` placeholders; consider ICO
    registration.
  - Verified: db/api/web builds + typechecks + full test suite (26) pass.

- **H8** — ☑ Fixed 2026-10-08 (critical-path test coverage). Added a real-MariaDB
  integration suite (`packages/api/test/integration/**`, `vitest.integration.config.ts`,
  `bun run test:integration`) covering the paths the audit flagged:
  - **Authorization / IDOR** — `requireMembership` returns a member's row, throws 403
    for a non-member, and enforces `minRole`.
  - **Quota (413 before bytes)** — `assertCanUpload` rejects over-quota with 413,
    allows exactly-at-quota, `getUsage` readOnly flag, `adjustUsedBytes` floors at 0.
  - **Delete / takedown** — `purgeMedia` removes media + derivatives (cascade),
    refunds quota only for charged states, and preserves the report row with
    `mediaId` NULL (set-null audit trail).
  - **Account deletion** — extracted `deleteAccountData` (from the DELETE /me handler)
    and tested: ownership transfers to the longest-standing member, solely-owned groups
    are deleted, the user's media is purged, other members' content is untouched.
    Kept separate from `bun run test` (which stays DB-free, 26 tests) via an exclude glob;
    CI gains an `integration` job with a MariaDB service. R2 is stubbed in tests that
    purge. Verified: 13/13 integration tests pass against MariaDB 11; unit suite + api
    typecheck still green.

### Still open (next up)

All High items are now addressed. Remaining: the Medium/Low items above, plus two
non-code launch tasks — H7's legal review (fill placeholders, solicitor sign-off) and
running migrations `0004`/`0005` on deploy.
