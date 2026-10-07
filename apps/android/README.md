# Cameraderie — Android client

Native Android client for Cameraderie, a private photo/video sharing app, written in
Kotlin + Jetpack Compose (Material3).

## Stack

- Kotlin 1.9.24, Jetpack Compose (Material3), Navigation-Compose
- Coroutines/Flow, one `ViewModel` per screen (hand-rolled `ViewModelProvider.Factory`s —
  no DI framework, see `app/AppContainer.kt`)
- OkHttp + kotlinx.serialization for the REST API
- Coil for image loading
- Media3 (ExoPlayer) for video preview playback
- WorkManager for resumable background uploads
- `androidx.security` `EncryptedSharedPreferences` for the auth token
- minSdk 26, targetSdk 34

## Opening the project

1. Open `apps/android` as a project root in Android Studio (Koala/Ladybug or newer).
2. Let Gradle sync. No extra setup is required — all dependencies resolve from
   Google/Maven Central.
3. Run the `app` configuration on an emulator (API 26+) or device.

This project was authored without access to an Android SDK/Gradle locally, so it has
**not** been compiled here. It's written to be idiomatic and consistent with current
AGP/Compose APIs, but do a first sync + build in Android Studio and fix up any version
drift (AGP/Gradle/Compose BOM) before relying on it.

## Configuring the API base URL

Edit `app/src/main/java/dev/joeherbert/cameraderie/app/AppConfig.kt`:

```kotlin
object AppConfig {
    const val API_BASE_URL: String = "http://localhost:3000"
}
```

- **Android emulator** talking to a backend running on your host machine: use
  `http://10.0.2.2:3000` (the emulator's alias for the host's `localhost`).
- **Physical device** on the same Wi-Fi as your dev machine: use
  `http://<your-lan-ip>:3000`.
- **Production**: point this at your `https://` API host. Cleartext HTTP is only
  allowed for `localhost` / `127.0.0.1` / `10.0.2.2` (see below) — anything else must be
  HTTPS.

### Cleartext HTTP for local dev

Because local development usually means talking to a plain-HTTP backend, the app ships
with:

- `android:usesCleartextTraffic="true"` on the `<application>` tag in
  `AndroidManifest.xml`, and
- a network security config at `app/src/main/res/xml/network_security_config.xml` that
  scopes cleartext traffic to `localhost`, `127.0.0.1`, and `10.0.2.2` only.

Before shipping a release build against a real HTTPS backend, remove
`usesCleartextTraffic` and the network security config reference (or tighten the config
to deny cleartext entirely).

## Architecture / package layout

```
app/                   Application class, AppConfig, AppContainer (manual DI), MainActivity
data/network/          ApiService (OkHttp + kotlinx.serialization), DTOs, AuthInterceptor
data/auth/             TokenStore (EncryptedSharedPreferences), AuthRepository
data/groups/           GroupsRepository
data/media/            MediaRepository (list/detail/favourite/delete/report)
data/upload/           ContentUriSource, UploadWorker, UploadRepository, WorkerFactory
ui/theme/              Material3 theme, color, typography
ui/nav/                Navigation routes + NavHost graph
ui/auth/               Sign in / sign up screen + ViewModel
ui/groups/             Groups list, create group, join-by-invite-code, storage usage
ui/feed/               Group media grid, upload trigger, upload progress
ui/detail/             Media detail: preview (image/video), favourite, download, report, delete
```

### Auth

Better Auth is used in **bearer-token mode** for the native client (not cookies):

- Sign up: `POST /api/auth/sign-up/email` with `{name, email, password}`.
- Sign in: `POST /api/auth/sign-in/email` with `{email, password}`.
- Both return `{token, user}`; the token is persisted in `EncryptedSharedPreferences`
  (`data/auth/TokenStore.kt`) and attached as `Authorization: Bearer <token>` to every
  subsequent request by `data/network/AuthInterceptor.kt`.
- Sign out clears the stored token. A `401` response anywhere also clears it
  (`AuthRepository.handleUnauthorized()`), which flips the nav graph back to the auth
  screen on next observation of `AuthRepository.isSignedIn`.

### Upload — 3-step direct-to-R2

This is the trickiest part of the client, implemented in
`data/upload/UploadWorker.kt` + `data/upload/ContentUriSource.kt`:

1. The feed screen launches the system Photo Picker
   (`ActivityResultContracts.PickMultipleVisualMedia`) to get one or more content
   `Uri`s — this is the only way to reliably get the *original* file without Android
   recompressing it.
2. Each selected `Uri` is handed to `UploadRepository.enqueueUpload()`, which enqueues a
   `UploadWorker` (a `CoroutineWorker`) via WorkManager so the upload survives the app
   being backgrounded or the process dying.
3. Inside the worker:
   - `ContentUriSource` opens the `Uri` via `ContentResolver` to read the exact original
     size and streams a SHA-256 digest over it in 64 KiB chunks (never buffering the
     whole file).
   - `POST /media/uploads` registers the upload and returns presigned per-part URLs.
   - For each part, `ContentUriSource.readRange(start, end)` reads exactly that byte
     range (seeking via a `ParcelFileDescriptor`/`FileChannel` when the content provider
     supports it, falling back to skip-then-read otherwise) and `PUT`s it straight to
     the presigned URL using a **separate** `OkHttpClient` with no `Authorization`
     header (the signature in the URL is the only auth those requests should carry).
     The response `ETag` header is captured per part, with a small retry loop.
   - `POST /media/uploads/:mediaId/complete` is called with the collected
     `{partNumber, etag}` list.
   - Any failure after step 1 triggers `POST /media/uploads/:mediaId/abort` before the
     worker reports failure (with limited automatic retry via `Result.retry()`).
- `UploadWorker` publishes progress (`hashing` → `registering` → `uploading` (%) →
  `finalizing` → `done`) via `setProgress`, which `FeedViewModel` observes through
  `WorkManager.getWorkInfosByTagFlow("upload:<groupId>")` to drive the progress banner
  and to trigger a feed refresh when an upload succeeds.
- WorkManager is initialized manually from `CameraderieApp` (a `Configuration.Provider`)
  with a custom `CameraderieWorkerFactory` so `UploadWorker` can receive the app's
  already-authenticated `ApiService` singleton instead of constructing its own. The
  default WorkManager `androidx.startup` initializer is disabled in the manifest to
  avoid a double-init crash — see the `<provider tools:node="remove">` block in
  `AndroidManifest.xml`.

### Media detail

- Images: Coil `AsyncImage` on `previewUrl`.
- Videos: Media3 `ExoPlayer` + `PlayerView` (via `AndroidView`) on `previewUrl`.
- Favourite: `PUT`/`DELETE /media/:id/favourite`, optimistic local toggle.
- Download original: fetches the presigned GET URL from
  `GET /media/:id/download` and hands it to the system `DownloadManager`.
- Report: simple reason dialog → `POST /media/:id/report`.
- Delete: only shown when `media.uploaderId == me.id` (compared against `GET /me`).

## Known gaps / things a human should double check

- **Not compiled.** No Android SDK/Gradle was available in the environment this was
  authored in. Do a Gradle sync + build in Android Studio first; expect to need to bump
  AGP/Gradle/Compose BOM patch versions to whatever's current.
- **Gradle wrapper not included.** Add one via `gradle wrapper --gradle-version <X>` (or
  let Android Studio generate it on first open) since wrapper jar/properties files
  weren't generated here.
- **App icon** uses a stock system drawable (`@android:drawable/sym_def_app_icon`) as a
  placeholder — swap in real launcher icons (`mipmap-*`) before shipping.
- **Invite acceptance** has a minimal "Join with code" dialog on the groups screen
  (`POST /invites/:code/accept`) but there's no dedicated screen for *generating*
  shareable invite links from the member list yet (`GroupsRepository.createInvite()` /
  `GET /groups/:id/members` are wired up and ready to use for that).
- **Pagination** on the feed screen is a simple "Load more" row driven by `nextCursor`
  rather than automatic infinite scroll.
- **No automated tests** were added; the module compiles down to `app/src/main` only
  (no `test`/`androidTest` sources beyond the stock dependency entries in
  `app/build.gradle.kts`).
