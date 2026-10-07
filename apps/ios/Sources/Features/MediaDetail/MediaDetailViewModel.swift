import Foundation
import Observation

@MainActor
@Observable
final class MediaDetailViewModel {
    private(set) var media: MediaDto
    var errorMessage: String?
    var isBusy = false
    var isDeleted = false

    init(media: MediaDto) {
        self.media = media
    }

    func toggleFavourite() async {
        let wasFavourited = media.favourited
        media = media.withFavourite(!wasFavourited)
        do {
            if wasFavourited {
                try await API.unfavourite(mediaId: media.id)
            } else {
                try await API.favourite(mediaId: media.id)
            }
        } catch {
            media = media.withFavourite(wasFavourited)
            errorMessage = error.localizedDescription
        }
    }

    func fetchDownloadURL() async -> URL? {
        isBusy = true
        defer { isBusy = false }
        do {
            let response = try await API.downloadURL(mediaId: media.id)
            return URL(string: response.url)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func report(reason: String) async -> Bool {
        isBusy = true
        defer { isBusy = false }
        do {
            try await API.reportMedia(mediaId: media.id, reason: reason)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func delete() async -> Bool {
        isBusy = true
        defer { isBusy = false }
        do {
            try await API.deleteMedia(mediaId: media.id)
            isDeleted = true
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

private extension MediaDto {
    /// Returns a copy with an optimistically-updated favourite state/count.
    /// No-ops the count delta if the state isn't actually changing.
    func withFavourite(_ favourited: Bool) -> MediaDto {
        guard favourited != self.favourited else { return self }
        let delta = favourited ? 1 : -1
        return MediaDto(
            id: id, groupId: groupId, uploaderId: uploaderId, kind: kind, state: state,
            filename: filename, mimeType: mimeType, sizeBytes: sizeBytes, width: width,
            height: height, durationMs: durationMs, capturedAt: capturedAt, createdAt: createdAt,
            thumbnailUrl: thumbnailUrl, previewUrl: previewUrl,
            favouriteCount: max(0, favouriteCount + delta),
            favourited: favourited
        )
    }
}
