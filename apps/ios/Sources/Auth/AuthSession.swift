import Foundation
import Observation

/// Owns the app's signed-in/signed-out state and the current user profile.
///
/// The actual bearer token lives in the Keychain (see `KeychainStore`); this
/// type just tracks *whether* we have one and caches the `User` returned by
/// `/me` for display purposes.
@MainActor
@Observable
final class AuthSession {
    enum State: Equatable {
        case unknown
        case signedOut
        case signedIn
    }

    private(set) var state: State = .unknown
    private(set) var currentUser: User?
    var errorMessage: String?
    var isBusy = false

    /// Called once at app launch to decide whether we already have a stored
    /// token and, if so, whether it's still valid.
    func restore() async {
        guard KeychainStore.loadToken() != nil else {
            state = .signedOut
            return
        }
        await refreshCurrentUser()
    }

    func signUp(name: String, email: String, password: String) async {
        await perform {
            let response = try await API.signUp(name: name, email: email, password: password)
            KeychainStore.saveToken(response.token)
            self.currentUser = response.user
            self.state = .signedIn
        }
    }

    func signIn(email: String, password: String) async {
        await perform {
            let response = try await API.signIn(email: email, password: password)
            KeychainStore.saveToken(response.token)
            self.currentUser = response.user
            self.state = .signedIn
        }
    }

    func signOut() async {
        await API.signOutRemote()
        KeychainStore.deleteToken()
        currentUser = nil
        state = .signedOut
    }

    private func refreshCurrentUser() async {
        await perform {
            let response = try await API.me()
            self.currentUser = response.user
            self.state = .signedIn
        }
    }

    private func perform(_ work: () async throws -> Void) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            try await work()
        } catch {
            // If a stored token turned out to be invalid/expired, drop it
            // and fall back to the signed-out flow rather than getting
            // stuck on a spinner.
            if case APIError.notAuthenticated = error {
                KeychainStore.deleteToken()
                state = .signedOut
            } else if case APIError.server(let status, _) = error, status == 401 {
                KeychainStore.deleteToken()
                state = .signedOut
            } else {
                errorMessage = error.localizedDescription
                if state == .unknown {
                    state = .signedOut
                }
            }
        }
    }
}
