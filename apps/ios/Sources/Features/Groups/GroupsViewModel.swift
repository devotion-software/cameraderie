import Foundation
import Observation

@MainActor
@Observable
final class GroupsViewModel {
    private(set) var groups: [PhotoGroup] = []
    private(set) var usage: UsageResponse?
    var errorMessage: String?
    var isLoading = false

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            async let groupsResponse = API.groups()
            async let usageResponse = API.usage()
            groups = try await groupsResponse.groups
            usage = try await usageResponse
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createGroup(name: String, description: String?) async -> Bool {
        do {
            let response = try await API.createGroup(name: name, description: description)
            groups.insert(response.group, at: 0)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}
