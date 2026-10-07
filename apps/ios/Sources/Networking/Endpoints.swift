import Foundation

/// Domain-level API calls, grouped by resource. This is the single place
/// that knows the Cameraderie route shapes; view models and services should
/// go through here rather than calling `APIClient` directly.
enum API {
    private static var client: APIClient { .shared }

    // MARK: - Auth

    struct SignUpRequest: Encodable {
        let name: String
        let email: String
        let password: String
    }

    struct SignInRequest: Encodable {
        let email: String
        let password: String
    }

    struct AuthResponse: Decodable {
        let token: String
        let user: User
    }

    static func signUp(name: String, email: String, password: String) async throws -> AuthResponse {
        try await client.send(
            .post, "/api/auth/sign-up/email",
            body: SignUpRequest(name: name, email: email, password: password),
            requiresAuth: false
        )
    }

    static func signIn(email: String, password: String) async throws -> AuthResponse {
        try await client.send(
            .post, "/api/auth/sign-in/email",
            body: SignInRequest(email: email, password: password),
            requiresAuth: false
        )
    }

    static func signOutRemote() async {
        // Best-effort: the server-side session is informational once the
        // client has forgotten its bearer token, so we swallow any error.
        try? await client.sendNoContent(.post, "/api/auth/sign-out")
    }

    // MARK: - Me

    static func me() async throws -> MeResponse {
        try await client.send(.get, "/me")
    }

    static func usage() async throws -> UsageResponse {
        try await client.send(.get, "/me/usage")
    }

    // MARK: - Groups

    static func groups() async throws -> GroupsResponse {
        try await client.send(.get, "/groups")
    }

    static func createGroup(name: String, description: String?) async throws -> GroupResponse {
        try await client.send(.post, "/groups", body: CreateGroupRequest(name: name, description: description))
    }

    static func group(id: String) async throws -> GroupResponse {
        try await client.send(.get, "/groups/\(id)")
    }

    static func groupMembers(groupId: String) async throws -> GroupMembersResponse {
        try await client.send(.get, "/groups/\(groupId)/members")
    }

    static func createInvite(groupId: String) async throws -> InviteResponse {
        try await client.send(.post, "/groups/\(groupId)/invites", body: EmptyBody())
    }

    static func acceptInvite(code: String) async throws -> AcceptInviteResponse {
        try await client.send(.post, "/invites/\(code)/accept", body: EmptyBody())
    }

    // MARK: - Media

    static func media(groupId: String, limit: Int = 30, before: String? = nil) async throws -> MediaListResponse {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let before {
            query.append(URLQueryItem(name: "before", value: before))
        }
        return try await client.send(.get, "/groups/\(groupId)/media", query: query)
    }

    static func media(id: String) async throws -> MediaResponse {
        try await client.send(.get, "/media/\(id)")
    }

    static func downloadURL(mediaId: String) async throws -> MediaDownloadResponse {
        try await client.send(.get, "/media/\(mediaId)/download")
    }

    static func previewURL(mediaId: String) async throws -> MediaPreviewResponse {
        try await client.send(.get, "/media/\(mediaId)/preview")
    }

    static func favourite(mediaId: String) async throws {
        try await client.sendNoContent(.put, "/media/\(mediaId)/favourite", body: EmptyBody())
    }

    static func unfavourite(mediaId: String) async throws {
        try await client.sendNoContent(.delete, "/media/\(mediaId)/favourite")
    }

    static func deleteMedia(mediaId: String) async throws {
        try await client.sendNoContent(.delete, "/media/\(mediaId)")
    }

    static func reportMedia(mediaId: String, reason: String) async throws {
        try await client.sendNoContent(.post, "/media/\(mediaId)/report", body: ReportMediaRequest(reason: reason))
    }

    // MARK: - Upload

    static func createUpload(_ request: CreateUploadRequest) async throws -> CreateUploadResponse {
        try await client.send(.post, "/media/uploads", body: request)
    }

    static func completeUpload(mediaId: String, parts: [CompletedPart]) async throws -> CompleteUploadResponse {
        try await client.send(.post, "/media/uploads/\(mediaId)/complete", body: CompleteUploadRequest(parts: parts))
    }

    static func abortUpload(mediaId: String) async {
        try? await client.sendNoContent(.post, "/media/uploads/\(mediaId)/abort")
    }
}

/// Used for POST/PUT endpoints that take no JSON payload but still need a
/// `Content-Type: application/json` request with an (empty) body.
struct EmptyBody: Encodable {}
