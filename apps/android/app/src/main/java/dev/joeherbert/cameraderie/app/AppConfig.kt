package dev.joeherbert.cameraderie.app

/**
 * Central place to configure the Cameraderie backend this client talks to.
 *
 * For local development against a backend running on your workstation:
 *  - Android emulator: use `http://10.0.2.2:3000` (10.0.2.2 is the emulator's
 *    alias for the host machine's localhost).
 *  - Physical device on the same network: use `http://<your-lan-ip>:3000`.
 *
 * Plaintext HTTP is only permitted (see network_security_config.xml and the
 * `usesCleartextTraffic` manifest flag) for localhost/10.0.2.2/127.0.0.1 — a
 * real deployment should use `https://` and can remove that dev allowance.
 */
object AppConfig {
    const val API_BASE_URL: String = "http://localhost:3000"
}
