import Foundation
import Observation

@MainActor
@Observable
final class GroupFeedViewModel {
    let group: PhotoGroup

    private(set) var items: [MediaDto] = []
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var hasMore = true
    var errorMessage: String?

    /// Active uploads keyed by a client-side id, so the grid can show
    /// in-flight progress tiles even before the server has a `MediaDto`.
    private(set) var activeUploads: [UUID: UploadProgress] = [:]

    private var nextCursor: String?

    init(group: PhotoGroup) {
        self.group = group
    }

    func loadInitial() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await API.media(groupId: group.id)
            items = response.media
            nextCursor = response.nextCursor
            hasMore = response.nextCursor != nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadMoreIfNeeded(currentItem: MediaDto) async {
        guard hasMore, !isLoadingMore else { return }
        guard let index = items.firstIndex(where: { $0.id == currentItem.id }) else { return }
        // Start prefetching when we're a handful of items from the end.
        guard index >= items.count - 6 else { return }
        await loadMore()
    }

    private func loadMore() async {
        guard let nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let response = try await API.media(groupId: group.id, before: nextCursor)
            items.append(contentsOf: response.media)
            self.nextCursor = response.nextCursor
            hasMore = response.nextCursor != nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        nextCursor = nil
        hasMore = true
        await loadInitial()
    }

    // MARK: - Upload tracking

    func beginUpload() -> UUID {
        let id = UUID()
        activeUploads[id] = UploadProgress(fractionCompleted: 0, status: .preparing)
        return id
    }

    func updateUpload(_ id: UUID, progress: UploadProgress) {
        activeUploads[id] = progress
    }

    func finishUpload(_ id: UUID, mediaId: String?) async {
        activeUploads.removeValue(forKey: id)
        // Pull the freshest state for the new item (it starts out
        // "processing" server-side) rather than guessing at its fields.
        if let mediaId, let response = try? await API.media(id: mediaId) {
            items.insert(response.media, at: 0)
        } else {
            await refresh()
        }
    }

    func removeLocally(mediaId: String) {
        items.removeAll { $0.id == mediaId }
    }

    func toggleFavourite(_ media: MediaDto) async {
        guard let index = items.firstIndex(where: { $0.id == media.id }) else { return }
        let original = items[index]
        let optimistic = MediaDto(
            id: original.id, groupId: original.groupId, uploaderId: original.uploaderId,
            kind: original.kind, state: original.state, filename: original.filename,
            mimeType: original.mimeType, sizeBytes: original.sizeBytes, width: original.width,
            height: original.height, durationMs: original.durationMs, capturedAt: original.capturedAt,
            createdAt: original.createdAt, thumbnailUrl: original.thumbnailUrl, previewUrl: original.previewUrl,
            favouriteCount: original.favouriteCount + (original.favourited ? -1 : 1),
            favourited: !original.favourited
        )
        items[index] = optimistic
        do {
            if original.favourited {
                try await API.unfavourite(mediaId: media.id)
            } else {
                try await API.favourite(mediaId: media.id)
            }
        } catch {
            items[index] = original
            errorMessage = error.localizedDescription
        }
    }
}

struct UploadProgress {
    enum Status {
        case preparing
        case hashing
        case uploading
        case completing
        case failed(String)
    }

    var fractionCompleted: Double
    var status: Status
}
