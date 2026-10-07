import Foundation

enum MediaKind: String, Codable, Equatable {
    case image
    case raw
    case video
}

enum MediaState: String, Codable, Equatable {
    case pending
    case uploading
    case processing
    case ready
    case failed
}

struct MediaDto: Codable, Identifiable, Hashable {
    let id: String
    let groupId: String
    let uploaderId: String
    let kind: MediaKind
    let state: MediaState
    let filename: String
    let mimeType: String?
    let sizeBytes: Int
    let width: Int?
    let height: Int?
    let durationMs: Int?
    let capturedAt: String?
    let createdAt: String
    let thumbnailUrl: String?
    let previewUrl: String?
    let favouriteCount: Int
    let favourited: Bool
}

struct MediaListResponse: Codable {
    let media: [MediaDto]
    let nextCursor: String?
}

struct MediaResponse: Codable {
    let media: MediaDto
}

struct MediaDownloadResponse: Codable {
    let url: String
    let filename: String
    let sizeBytes: Int
}

struct MediaPreviewResponse: Codable {
    let url: String
}

struct ReportMediaRequest: Codable {
    let reason: String
}

// MARK: - Upload

struct CreateUploadRequest: Codable {
    let groupId: String
    let filename: String
    let sizeBytes: Int
    let mimeType: String?
    let checksumSha256: String
    let capturedAt: String?
}

struct UploadPart: Codable {
    let partNumber: Int
    let url: String
}

struct CreateUploadResponse: Codable {
    let mediaId: String
    let r2UploadId: String
    let key: String
    let partSizeBytes: Int
    let parts: [UploadPart]
}

struct CompletedPart: Codable {
    let partNumber: Int
    let etag: String
}

struct CompleteUploadRequest: Codable {
    let parts: [CompletedPart]
}

struct CompleteUploadResponse: Codable {
    let mediaId: String
    let state: String
}
