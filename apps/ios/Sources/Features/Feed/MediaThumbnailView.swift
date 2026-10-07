import SwiftUI

/// A single grid tile for a `MediaDto`. Shows the thumbnail when ready, and
/// a state-appropriate placeholder otherwise (processing/failed/etc).
struct MediaThumbnailView: View {
    let media: MediaDto

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.quaternary)

            switch media.state {
            case .ready:
                if let urlString = media.thumbnailUrl, let url = URL(string: urlString) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        case .failure:
                            placeholderIcon("exclamationmark.triangle")
                        case .empty:
                            ProgressView()
                        @unknown default:
                            placeholderIcon("photo")
                        }
                    }
                } else {
                    placeholderIcon("photo")
                }
            case .pending, .uploading:
                VStack(spacing: 6) {
                    ProgressView()
                    Text("Uploading")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            case .processing:
                VStack(spacing: 6) {
                    ProgressView()
                    Text("Processing")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            case .failed:
                placeholderIcon("exclamationmark.triangle.fill", tint: .red)
            }

            if media.kind == .video, media.state == .ready {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Image(systemName: "video.fill")
                            .font(.caption)
                            .foregroundStyle(.white)
                            .padding(6)
                    }
                }
            }

            if media.favourited {
                VStack {
                    HStack {
                        Spacer()
                        Image(systemName: "heart.fill")
                            .font(.caption)
                            .foregroundStyle(.pink)
                            .padding(6)
                    }
                    Spacer()
                }
            }
        }
        .aspectRatio(1, contentMode: .fill)
        .clipped()
        .contentShape(Rectangle())
    }

    private func placeholderIcon(_ systemName: String, tint: Color = .secondary) -> some View {
        Image(systemName: systemName)
            .font(.title2)
            .foregroundStyle(tint)
    }
}

/// Tile shown for an upload still in flight on-device, before the server
/// has produced a `MediaDto` for it.
struct UploadProgressTile: View {
    let progress: UploadProgress

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.quaternary)
            VStack(spacing: 8) {
                ProgressView(value: clampedFraction)
                    .progressViewStyle(.circular)
                Text(statusText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 4)
            }
        }
        .aspectRatio(1, contentMode: .fill)
        .clipped()
    }

    private var clampedFraction: Double {
        min(max(progress.fractionCompleted, 0), 1)
    }

    private var statusText: String {
        switch progress.status {
        case .preparing: return "Preparing"
        case .hashing: return "Checksum"
        case .uploading: return "Uploading \(Int(clampedFraction * 100))%"
        case .completing: return "Finishing"
        case .failed(let message): return "Failed: \(message)"
        }
    }
}
