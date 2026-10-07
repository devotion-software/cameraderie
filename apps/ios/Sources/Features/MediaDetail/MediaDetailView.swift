import AVKit
import SwiftUI

struct MediaDetailView: View {
    @State private var viewModel: MediaDetailViewModel
    @Environment(AuthSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    var onChanged: (MediaDto) -> Void
    var onDeleted: (String) -> Void

    @State private var isShowingReportSheet = false
    @State private var isShowingDeleteConfirm = false
    @State private var reportReason = ""
    @State private var player: AVPlayer?

    init(media: MediaDto, onChanged: @escaping (MediaDto) -> Void, onDeleted: @escaping (String) -> Void) {
        _viewModel = State(initialValue: MediaDetailViewModel(media: media))
        self.onChanged = onChanged
        self.onDeleted = onDeleted
    }

    private var media: MediaDto { viewModel.media }

    private var isOwnedByCurrentUser: Bool {
        session.currentUser?.id == media.uploaderId
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                mediaContent
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 300)
                    .background(.black.opacity(0.05))

                VStack(alignment: .leading, spacing: 8) {
                    Text(media.filename)
                        .font(.headline)
                        .lineLimit(1)

                    HStack(spacing: 16) {
                        Label(ByteFormatter.string(from: media.sizeBytes), systemImage: "externaldrive")
                        if let width = media.width, let height = media.height {
                            Label("\(width)×\(height)", systemImage: "arrow.up.left.and.arrow.down.right")
                        }
                        if let durationMs = media.durationMs {
                            Label(durationString(durationMs), systemImage: "clock")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)

                actionBar
                    .padding(.horizontal)
            }
            .padding(.bottom, 24)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        isShowingReportSheet = true
                    } label: {
                        Label("Report", systemImage: "flag")
                    }
                    if isOwnedByCurrentUser {
                        Button(role: .destructive) {
                            isShowingDeleteConfirm = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .task {
            if media.kind == .video, let urlString = media.previewUrl, let url = URL(string: urlString) {
                player = AVPlayer(url: url)
            }
        }
        .sheet(isPresented: $isShowingReportSheet) {
            ReportSheet(reason: $reportReason) {
                Task {
                    if await viewModel.report(reason: reportReason) {
                        isShowingReportSheet = false
                        reportReason = ""
                    }
                }
            }
        }
        .confirmationDialog(
            "Delete this item?",
            isPresented: $isShowingDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task {
                    if await viewModel.delete() {
                        onDeleted(media.id)
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .onChange(of: viewModel.media) { _, newValue in
            onChanged(newValue)
        }
    }

    @ViewBuilder
    private var mediaContent: some View {
        switch media.kind {
        case .video:
            if let player {
                VideoPlayer(player: player)
                    .aspectRatio(16.0 / 9.0, contentMode: .fit)
            } else {
                ProgressView()
            }
        case .image, .raw:
            if let urlString = media.previewUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: .fit)
                    case .failure:
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                    case .empty:
                        ProgressView()
                    @unknown default:
                        EmptyView()
                    }
                }
            } else {
                ProgressView()
            }
        }
    }

    private var actionBar: some View {
        HStack(spacing: 24) {
            Button {
                Task { await viewModel.toggleFavourite() }
            } label: {
                Label("\(media.favouriteCount)", systemImage: media.favourited ? "heart.fill" : "heart")
                    .foregroundStyle(media.favourited ? .pink : .primary)
            }

            Button {
                Task { await downloadOriginal() }
            } label: {
                Label("Download", systemImage: "arrow.down.circle")
            }
            .disabled(viewModel.isBusy)

            Spacer()
        }
        .buttonStyle(.bordered)
    }

    private func downloadOriginal() async {
        guard let url = await viewModel.fetchDownloadURL() else { return }
        await UIApplication.shared.open(url)
    }

    private func durationString(_ durationMs: Int) -> String {
        let totalSeconds = durationMs / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

private struct ReportSheet: View {
    @Binding var reason: String
    var onSubmit: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Why are you reporting this?") {
                    TextField("Reason", text: $reason, axis: .vertical)
                }
            }
            .navigationTitle("Report Media")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit", action: onSubmit)
                        .disabled(reason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
