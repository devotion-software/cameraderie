import Foundation
import Photos

enum UploadManagerError: LocalizedError {
    case missingETag(partNumber: Int)
    case partUploadFailed(partNumber: Int, statusCode: Int)
    case fileReadFailed(Error)

    var errorDescription: String? {
        switch self {
        case .missingETag(let partNumber):
            return "Upload part \(partNumber) did not return an ETag."
        case .partUploadFailed(let partNumber, let statusCode):
            return "Upload part \(partNumber) failed with status \(statusCode)."
        case .fileReadFailed(let error):
            return "Could not read file for upload: \(error.localizedDescription)"
        }
    }
}

/// Drives the 3-step direct-to-R2 multipart upload: create -> PUT each part
/// to its presigned URL -> complete (or abort on failure).
///
/// Part PUTs intentionally do **not** carry the app's bearer token — the
/// per-part URLs are presigned and talk directly to R2.
enum UploadManager {
    static func upload(
        original: LoadedOriginal,
        groupId: String,
        session: URLSession = .shared,
        onProgress: @escaping (Double) -> Void
    ) async throws -> String {
        let createResponse = try await API.createUpload(
            CreateUploadRequest(
                groupId: groupId,
                filename: original.filename,
                sizeBytes: original.sizeBytes,
                mimeType: original.mimeType,
                checksumSha256: original.sha256Hex,
                capturedAt: original.capturedAt.map(ISO8601DateFormatter().string(from:))
            )
        )

        do {
            let completedParts = try await uploadParts(
                createResponse,
                fileURL: original.fileURL,
                totalSize: original.sizeBytes,
                session: session,
                onProgress: onProgress
            )

            _ = try await API.completeUpload(mediaId: createResponse.mediaId, parts: completedParts)
            return createResponse.mediaId
        } catch {
            await API.abortUpload(mediaId: createResponse.mediaId)
            throw error
        }
    }

    private static func uploadParts(
        _ createResponse: CreateUploadResponse,
        fileURL: URL,
        totalSize: Int,
        session: URLSession,
        onProgress: @escaping (Double) -> Void
    ) async throws -> [CompletedPart] {
        let fileHandle: FileHandle
        do {
            fileHandle = try FileHandle(forReadingFrom: fileURL)
        } catch {
            throw UploadManagerError.fileReadFailed(error)
        }
        defer { try? fileHandle.close() }

        var completed: [CompletedPart] = []
        completed.reserveCapacity(createResponse.parts.count)

        var bytesUploaded = 0

        for part in createResponse.parts.sorted(by: { $0.partNumber < $1.partNumber }) {
            let rangeStart = (part.partNumber - 1) * createResponse.partSizeBytes
            let rangeEnd = min(part.partNumber * createResponse.partSizeBytes, totalSize)
            let length = rangeEnd - rangeStart

            guard length > 0 else { continue }

            let data: Data
            do {
                try fileHandle.seek(toOffset: UInt64(rangeStart))
                data = try fileHandle.read(upToCount: length) ?? Data()
            } catch {
                throw UploadManagerError.fileReadFailed(error)
            }

            guard let url = URL(string: part.url) else {
                throw APIError.invalidURL
            }

            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue(String(data.count), forHTTPHeaderField: "Content-Length")

            let (_, response) = try await session.upload(for: request, from: data)

            guard let http = response as? HTTPURLResponse else {
                throw UploadManagerError.partUploadFailed(partNumber: part.partNumber, statusCode: -1)
            }
            guard (200..<300).contains(http.statusCode) else {
                throw UploadManagerError.partUploadFailed(partNumber: part.partNumber, statusCode: http.statusCode)
            }

            // HTTPURLResponse.value(forHTTPHeaderField:) performs a
            // case-insensitive lookup, so this picks up "ETag", "Etag", etc.
            guard let etag = http.value(forHTTPHeaderField: "ETag") else {
                throw UploadManagerError.missingETag(partNumber: part.partNumber)
            }

            completed.append(CompletedPart(partNumber: part.partNumber, etag: etag))

            bytesUploaded += length
            onProgress(Double(bytesUploaded) / Double(max(totalSize, 1)))
        }

        return completed
    }
}
