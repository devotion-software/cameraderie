import Foundation

/// Central app configuration.
///
/// To point the app at a different backend (e.g. a staging server, or a
/// physical device reaching your dev machine over LAN), change `apiBaseURL`
/// below. See the README for details.
enum AppConfig {
    /// Base URL of the Cameraderie API server.
    ///
    /// Defaults to `http://localhost:3000` for use with the iOS Simulator,
    /// which shares the host machine's loopback interface. If you are
    /// running on a physical device, replace this with your Mac's LAN IP,
    /// e.g. `http://192.168.1.23:3000`.
    static let apiBaseURL = URL(string: "http://localhost:3000")!

    /// Keychain service identifier used to namespace stored credentials.
    static let keychainService = "dev.joeherbert.cameraderie"
}
