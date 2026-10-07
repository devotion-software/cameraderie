import Photos
import SwiftUI

struct GroupFeedView: View {
    @State private var viewModel: GroupFeedViewModel
    @State private var isShowingPicker = false
    @State private var pendingRetries: [UUID: PHAsset] = [:]

    private let columns = [
        GridItem(.adaptive(minimum: 110), spacing: 2),
    ]

    init(group: PhotoGroup) {
        _viewModel = State(initialValue: GroupFeedViewModel(group: group))
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(Array(viewModel.activeUploads.keys), id: \.self) { id in
                    if let progress = viewModel.activeUploads[id] {
                        UploadProgressTile(progress: progress)
                            .onTapGesture {
                                if case .failed = progress.status, let asset = pendingRetries[id] {
                                    retry(id: id, asset: asset)
                                }
                            }
                    }
                }

                ForEach(viewModel.items) { media in
                    NavigationLink(value: media) {
                        MediaThumbnailView(media: media)
                    }
                    .buttonStyle(.plain)
                    .task {
                        await viewModel.loadMoreIfNeeded(currentItem: media)
                    }
                }
            }
        }
        .navigationTitle(viewModel.group.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: MediaDto.self) { media in
            MediaDetailView(media: media, onChanged: { updated in
                // no-op: detail view mutates its own local copy; list will
                // reflect changes next refresh.
            }, onDeleted: { deletedId in
                viewModel.removeLocally(mediaId: deletedId)
            })
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isShowingPicker = true
                } label: {
                    Label("Upload", systemImage: "plus.circle.fill")
                }
            }
        }
        .sheet(isPresented: $isShowingPicker) {
            PhotoPicker(selectionLimit: 0) { assets in
                for asset in assets {
                    startUpload(asset: asset)
                }
            }
            .ignoresSafeArea()
        }
        .refreshable { await viewModel.refresh() }
        .task { await viewModel.loadInitial() }
        .overlay {
            if viewModel.isLoading && viewModel.items.isEmpty {
                ProgressView()
            } else if viewModel.items.isEmpty && viewModel.activeUploads.isEmpty {
                ContentUnavailableView(
                    "No Media Yet",
                    systemImage: "photo.on.rectangle.angled",
                    description: Text("Tap the upload button to share your first photo or video.")
                )
            }
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
    }

    private func startUpload(asset: PHAsset) {
        let id = viewModel.beginUpload()
        pendingRetries[id] = asset
        runUpload(id: id, asset: asset)
    }

    private func retry(id: UUID, asset: PHAsset) {
        viewModel.updateUpload(id, progress: UploadProgress(fractionCompleted: 0, status: .preparing))
        runUpload(id: id, asset: asset)
    }

    private func runUpload(id: UUID, asset: PHAsset) {
        let groupId = viewModel.group.id
        Task { @MainActor in
            do {
                viewModel.updateUpload(id, progress: UploadProgress(fractionCompleted: 0, status: .hashing))

                let original = try await OriginalAssetLoader.load(asset: asset) { fraction in
                    Task { @MainActor in
                        viewModel.updateUpload(id, progress: UploadProgress(fractionCompleted: fraction * 0.3, status: .hashing))
                    }
                }

                viewModel.updateUpload(id, progress: UploadProgress(fractionCompleted: 0.3, status: .uploading))
                let mediaId = try await UploadManager.upload(original: original, groupId: groupId) { fraction in
                    Task { @MainActor in
                        viewModel.updateUpload(id, progress: UploadProgress(fractionCompleted: 0.3 + fraction * 0.65, status: .uploading))
                    }
                }
                original.cleanup()

                viewModel.updateUpload(id, progress: UploadProgress(fractionCompleted: 0.98, status: .completing))
                await viewModel.finishUpload(id, mediaId: mediaId)
                pendingRetries.removeValue(forKey: id)
            } catch {
                viewModel.updateUpload(id, progress: UploadProgress(fractionCompleted: 0, status: .failed(error.localizedDescription)))
            }
        }
    }
}
