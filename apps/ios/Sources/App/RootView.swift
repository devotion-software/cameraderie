import SwiftUI

/// Top-level view that switches between the signed-out (Auth) flow and the
/// signed-in (Groups) flow based on the current `AuthSession` state.
struct RootView: View {
    @Environment(AuthSession.self) private var session

    var body: some View {
        Group {
            switch session.state {
            case .unknown:
                ProgressView()
                    .task { await session.restore() }
            case .signedOut:
                AuthView()
            case .signedIn:
                GroupsListView()
            }
        }
        .animation(.default, value: session.state)
    }
}
