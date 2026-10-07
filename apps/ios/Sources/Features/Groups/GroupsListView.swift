import SwiftUI

struct GroupsListView: View {
    @Environment(AuthSession.self) private var session
    @State private var viewModel = GroupsViewModel()
    @State private var isShowingCreateGroup = false

    var body: some View {
        NavigationStack {
            List {
                if let usage = viewModel.usage {
                    Section {
                        UsageSummaryView(usage: usage)
                    }
                }

                Section {
                    ForEach(viewModel.groups) { group in
                        NavigationLink(value: group) {
                            GroupRow(group: group)
                        }
                    }
                } header: {
                    if !viewModel.groups.isEmpty {
                        Text("Groups")
                    }
                }

                if viewModel.groups.isEmpty && !viewModel.isLoading {
                    ContentUnavailableView(
                        "No Groups Yet",
                        systemImage: "person.3",
                        description: Text("Create a group to start sharing photos and videos.")
                    )
                }
            }
            .navigationTitle("Cameraderie")
            .navigationDestination(for: PhotoGroup.self) { group in
                GroupFeedView(group: group)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            isShowingCreateGroup = true
                        } label: {
                            Label("New Group", systemImage: "plus")
                        }
                        Button(role: .destructive) {
                            Task { await session.signOut() }
                        } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
            .sheet(isPresented: $isShowingCreateGroup) {
                CreateGroupView(viewModel: viewModel) {}
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
    }
}

private struct GroupRow: View {
    let group: PhotoGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(group.name)
                .font(.headline)
            if let description = group.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if let role = group.myRole {
                Text(role.capitalized)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
        }
        .padding(.vertical, 4)
    }
}

private struct UsageSummaryView: View {
    let usage: UsageResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Storage")
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(usage.plan.capitalized)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: usage.fractionUsed)
            HStack {
                Text(ByteFormatter.string(from: usage.usedBytes))
                Text("of")
                    .foregroundStyle(.secondary)
                Text(ByteFormatter.string(from: usage.quotaBytes))
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if usage.readOnly {
                Label("Storage full — uploads disabled", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 4)
    }
}

enum ByteFormatter {
    static func string(from bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

#Preview {
    GroupsListView()
        .environment(AuthSession())
}
