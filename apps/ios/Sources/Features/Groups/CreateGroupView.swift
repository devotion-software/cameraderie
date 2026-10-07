import SwiftUI

struct CreateGroupView: View {
    let viewModel: GroupsViewModel
    var onCreated: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Group") {
                    TextField("Name", text: $name)
                    TextField("Description (optional)", text: $description, axis: .vertical)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New Group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Create") { Task { await create() } }
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }

    private func create() async {
        isSaving = true
        errorMessage = nil
        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let success = await viewModel.createGroup(
            name: name.trimmingCharacters(in: .whitespaces),
            description: trimmedDescription.isEmpty ? nil : trimmedDescription
        )
        isSaving = false
        if success {
            onCreated()
            dismiss()
        } else {
            errorMessage = viewModel.errorMessage
        }
    }
}
