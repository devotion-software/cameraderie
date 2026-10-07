import Photos
import PhotosUI
import SwiftUI

/// SwiftUI wrapper around `PHPickerViewController` that hands back the
/// selected `PHAsset`s (not `PHPickerResult` objects) so callers can go
/// straight to `PHAssetResourceManager` for the true original bytes.
///
/// We deliberately avoid `PHPickerResult.itemProvider.loadFileRepresentation`
/// for images/videos because that path can hand back a re-encoded /
/// downsized representation. Resolving to `PHAsset.localIdentifier` and then
/// using `PHAssetResource` guarantees we fetch the original file.
struct PhotoPicker: UIViewControllerRepresentable {
    var selectionLimit: Int = 1
    var onSelect: ([PHAsset]) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.selectionLimit = selectionLimit
        configuration.filter = .any(of: [.images, .videos])
        // Requesting the current identifier lets us resolve back to a
        // PHAsset without needing to fetch a (possibly transcoded) file
        // representation from the item provider.
        configuration.preferredAssetRepresentationMode = .current

        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onSelect: onSelect)
    }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onSelect: ([PHAsset]) -> Void

        init(onSelect: @escaping ([PHAsset]) -> Void) {
            self.onSelect = onSelect
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)

            let identifiers = results.compactMap(\.assetIdentifier)
            guard !identifiers.isEmpty else {
                onSelect([])
                return
            }

            let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: identifiers, options: nil)
            var assets: [PHAsset] = []
            fetchResult.enumerateObjects { asset, _, _ in
                assets.append(asset)
            }
            onSelect(assets)
        }
    }
}
