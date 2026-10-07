# Cameraderie — iOS Client

A native SwiftUI client for Cameraderie, a private photo/video sharing app.
Targets iOS 17+, uses `async`/`await`, `URLSession`, `Codable`, and the
`@Observable` macro (Observation framework) for state management.

## Requirements

- Xcode 15+ (iOS 17 SDK)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- A running instance of the Cameraderie API (see the repo root) — by default
  the app talks to `http://localhost:3000`.

## Generating and opening the project

This directory does not check in an `.xcodeproj`; it's generated from
`project.yml` with XcodeGen so the project file never drifts/conflicts in
source control.

```sh
cd apps/ios
xcodegen generate
open Cameraderie.xcodeproj
```

Then build and run the `Cameraderie` scheme on a simulator or device from
Xcode. (Do not run `xcodebuild` from this environment — just generate the
project and build in Xcode.)

## Setting the API base URL

All networking goes through a single configuration point:

```
Sources/App/AppConfig.swift
```

```swift
enum AppConfig {
    static let apiBaseURL = URL(string: "http://localhost:3000")!
    ...
}
```

- **iOS Simulator**: `http://localhost:3000` works as-is, since the
  Simulator shares your Mac's loopback interface.
- **Physical device**: replace `localhost` with your Mac's LAN IP (e.g.
  `http://192.168.1.23:3000`), since the device can't resolve your laptop's
  `localhost`.

### HTTP in development (App Transport Security)

The API defaults to plain `http://` for local development. `project.yml`
adds an `NSAppTransportSecurity` exception for `localhost` and `127.0.0.1` to
Info.plist so these requests aren't blocked by ATS. If you point the app at
a non-local `http://` host you'll need to extend that exception (or, better,
put TLS in front of your API) — plain HTTP to arbitrary hosts is blocked by
default on iOS.

## Architecture

```
Sources/
  App/                   App entry point, root view, AppConfig, Info.plist
  Models/                Codable DTOs shared across the app
  Networking/            APIClient (generic HTTP plumbing) + Endpoints (API)
  Auth/                  KeychainStore, AuthSession (@Observable session state)
  Features/
    Auth/                Sign in / sign up screen
    Groups/              Groups list, create-group sheet, storage usage
    Feed/                Group media grid, thumbnails, upload progress tiles
    MediaDetail/         Preview (image/video), favourite, download, report, delete
    Upload/               PHPicker wrapper, original-asset loader, R2 multipart upload
```

### Auth

Better Auth is used in "native" mode: sign up / sign in return a bearer
`token`, which is stored in the Keychain (`Auth/KeychainStore.swift`) and
attached as `Authorization: Bearer <token>` to every subsequent API request
by `Networking/APIClient.swift`. Sign out clears the Keychain entry and
best-effort calls `/api/auth/sign-out`.

### Upload pipeline (the interesting part)

Selecting photos/videos uses `PHPickerViewController`
(`Features/Upload/PhotoPicker.swift`), but instead of consuming the picker's
item provider (which can hand back a downsized/transcoded JPEG preview), the
picker's `assetIdentifier` is resolved back to a `PHAsset`. From there,
`Features/Upload/OriginalAssetLoader.swift`:

1. Picks the `PHAssetResource` that represents the real original content
   (`.photo`/`.fullSizePhoto` for images & RAW, `.video` for video) —
   skipping adjustment data, thumbnails, and paired Live Photo movies.
2. Streams it via `PHAssetResourceManager.requestData`, writing each chunk
   to a temp file **and** feeding it into an incremental `CryptoKit.SHA256`
   hasher, so a multi-GB video is never buffered in memory.
3. Returns the temp file URL, filename, MIME type, byte size, and the final
   SHA-256 hex digest.

`Features/Upload/UploadManager.swift` then drives the 3-step direct-to-R2
multipart upload:

1. `POST /media/uploads` with the filename/size/checksum to get a
   `mediaId`, an R2 upload id, and a list of presigned per-part PUT URLs
   plus the part size.
2. For each part, seek to its exact byte range in the temp file and `PUT`
   those bytes straight to R2 (no `Authorization` header — the URL itself is
   presigned), capturing the `ETag` response header.
3. `POST /media/uploads/:mediaId/complete` with the part numbers + ETags.
   If anything fails along the way, `POST /media/uploads/:mediaId/abort` is
   called before surfacing the error.

`GroupFeedViewModel` tracks in-flight uploads independently of the server
media list so the grid can show live progress tiles (preparing → hashing →
uploading % → finishing) before the server even has a record, and a tap on a
failed tile retries from scratch.

## Known limitations / things a human should double check

- **No Xcode here**: this code was written without the ability to compile
  it. It's been kept deliberately conservative (standard SDK APIs, no
  exotic syntax) but give it a build pass in Xcode before relying on it.
- **Background uploads**: uploads currently run in a foreground `URLSession`
  task per part; they will pause if the app is suspended mid-upload. For
  production use, consider moving `UploadManager`'s part PUTs to a
  background `URLSessionConfiguration` and handling
  `application(_:handleEventsForBackgroundURLSession:completionHandler:)`.
- **Resumability**: if the app is killed mid-upload, the in-progress upload
  is lost (the temp file and progress tile both disappear) — the user would
  need to re-select and re-upload. The server-side `abort` endpoint is only
  called on an in-process failure, not on a hard kill.
- **Signing**: `project.yml` uses automatic code signing with no team ID
  set. Set your `DEVELOPMENT_TEAM` either in `project.yml` or in Xcode's
  Signing & Capabilities tab after generating the project.
- **Pagination cursor**: `GroupFeedViewModel` treats the `/groups/:id/media`
  `nextCursor` as an opaque string passed back as `before`, per the API
  contract; it doesn't try to interpret it.
- **RAW/HEIC display**: `AsyncImage` can decode what `UIImage`/ImageIO
  supports on-device; very exotic RAW formats may not render in the preview
  even though the *original* bytes were uploaded/downloaded correctly.
- **Invites**: `POST /groups/:id/invites` and `POST /invites/:code/accept`
  are implemented in `Networking/Endpoints.swift` (`API.createInvite`,
  `API.acceptInvite`), but there's no dedicated invite UI yet (not in the
  requested screen list) — wire up a share sheet / "Join group" entry point
  as a follow-up.
