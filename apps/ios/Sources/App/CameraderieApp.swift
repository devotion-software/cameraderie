import SwiftUI

@main
struct CameraderieApp: App {
    @State private var session = AuthSession()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
        }
    }
}
