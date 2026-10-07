import CryptoKit
import Foundation
import Photos
import UniformTypeIdentifiers

/// Result of resolving a `PHAsset` down to its original on-disk bytes.
struct LoadedOriginal {
    /// Local temp file containing the exact original bytes (HEIC/RAW/video
    /// container, untouched).
    let fileURL: URL
    let filename: String
    let mimeType: String?
    let sizeBytes: Int
    let sha256Hex: String
    let capturedAt: Date?

    func cleanup() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}

enum OriginalAssetLoaderError: LocalizedError {
    case noResource
    case resourceManagerFailed(Error)
    case couldNotCreateTempFile

    var errorDescription: String? {
        switch self {
        case .noResource:
            return "Could not find the original file for this item."
        case .resourceManagerFailed(let error):
            return "Could not read the original file: \(error.localizedDescription)"
        case .couldNotCreateTempFile:
            return "Could not create a temporary file for the upload."
        }
    }
}

/// Fetches the *true original* bytes for a `PHAsset` — not a downsized or
/// transcoded derivative — streaming them to a temp file while computing a
/// SHA-256 checksum incrementally so we never hold a whole (potentially
/// multi-GB) video in memory.
enum OriginalAssetLoader {
    static func load(asset: PHAsset, progress: ((Double) -> Void)? = nil) async throws -> LoadedOriginal {
        let resource = try primaryResource(for: asset)

        let tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("uploads", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)

        let tempURL = tempDirectory.appendingPathComponent(UUID().uuidString)
        guard FileManager.default.createFile(atPath: tempURL.path, contents: nil) else {
            throw OriginalAssetLoaderError.couldNotCreateTempFile
        }

        let fileHandle = try FileHandle(forWritingTo: tempURL)
        var hasher = SHA256()
        var totalBytesWritten: Int = 0
        let expectedSize = resourceSizeBytes(resource)

        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHAssetResourceManager.default().requestData(
                for: resource,
                options: options,
                dataReceivedHandler: { chunk in
                    hasher.update(data: chunk)
                    fileHandle.write(chunk)
                    totalBytesWritten += chunk.count
                    if let expectedSize, expectedSize > 0 {
                        progress?(Double(totalBytesWritten) / Double(expectedSize))
                    }
                },
                completionHandler: { error in
                    if let error {
                        continuation.resume(throwing: OriginalAssetLoaderError.resourceManagerFailed(error))
                    } else {
                        continuation.resume()
                    }
                }
            )
        }

        try fileHandle.close()

        let digest = hasher.finalize()
        let sha256Hex = digest.map { String(format: "%02x", $0) }.joined()

        let attributes = try FileManager.default.attributesOfItem(atPath: tempURL.path)
        let sizeBytes = (attributes[.size] as? Int) ?? totalBytesWritten

        return LoadedOriginal(
            fileURL: tempURL,
            filename: resource.originalFilename,
            mimeType: mimeType(for: resource),
            sizeBytes: sizeBytes,
            sha256Hex: sha256Hex,
            capturedAt: asset.creationDate
        )
    }

    /// Picks the resource that represents the actual original content,
    /// preferring RAW/photo/video over adjustment data, thumbnails, or
    /// paired Live Photo videos.
    private static func primaryResource(for asset: PHAsset) throws -> PHAssetResource {
        let resources = PHAssetResource.assetResources(for: asset)

        let preferredOrder: [PHAssetResourceType] = [.photo, .video, .audio, .fullSizePhoto]
        for type in preferredOrder {
            if let match = resources.first(where: { $0.type == type }) {
                return match
            }
        }

        guard let fallback = resources.first else {
            throw OriginalAssetLoaderError.noResource
        }
        return fallback
    }

    private static func resourceSizeBytes(_ resource: PHAssetResource) -> Int? {
        // PHAssetResource exposes size via an undocumented but widely-used
        // key-value coding property on recent iOS versions.
        if let value = resource.value(forKey: "fileSize") as? Int64 {
            return Int(value)
        }
        return nil
    }

    private static func mimeType(for resource: PHAssetResource) -> String? {
        if let utType = UTType(resource.uniformTypeIdentifier) {
            return utType.preferredMIMEType
        }
        return nil
    }
}
