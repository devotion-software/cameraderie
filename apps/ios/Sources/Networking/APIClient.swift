import Foundation

/// Thin HTTP client for the Cameraderie API.
///
/// Every request (other than the auth sign-up/sign-in endpoints themselves)
/// is sent with an `Authorization: Bearer <token>` header, where the token
/// comes straight from the Keychain. There is deliberately no in-memory
/// caching of the token here: `AuthSession` owns the "am I signed in" state,
/// this type just needs *a* token to attach to outgoing requests.
final class APIClient {
    static let shared = APIClient()

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: URL = AppConfig.apiBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .useDefaultKeys
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .useDefaultKeys
        self.encoder = encoder
    }

    enum Method: String {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case delete = "DELETE"
    }

    /// Performs a request against the API and decodes a JSON response body.
    func send<Response: Decodable>(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws -> Response {
        let data = try await sendRaw(method, path, query: query, body: body, requiresAuth: requiresAuth)
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    /// Performs a request with no expected response body (e.g. a bare 204).
    func sendNoContent(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Encodable? = nil,
        requiresAuth: Bool = true
    ) async throws {
        _ = try await sendRaw(method, path, query: query, body: body, requiresAuth: requiresAuth)
    }

    @discardableResult
    private func sendRaw(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem],
        body: Encodable?,
        requiresAuth: Bool
    ) async throws -> Data {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.invalidURL
        }
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if requiresAuth {
            guard let token = KeychainStore.loadToken() else {
                throw APIError.notAuthenticated
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                request.httpBody = try encoder.encode(AnyEncodable(body))
            } catch {
                throw APIError.decoding(error)
            }
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw APIError.cancelled
        } catch {
            throw APIError.transport(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(URLError(.badServerResponse))
        }

        guard (200..<300).contains(http.statusCode) else {
            let message = Self.extractErrorMessage(from: data)
            throw APIError.server(statusCode: http.statusCode, message: message)
        }

        return data
    }

    private static func extractErrorMessage(from data: Data) -> String? {
        struct ErrorBody: Decodable {
            let error: String?
            let message: String?
        }
        guard let body = try? JSONDecoder().decode(ErrorBody.self, from: data) else {
            return String(data: data, encoding: .utf8)
        }
        return body.error ?? body.message
    }
}

/// Type-erasing wrapper so `Encodable` can be stored/passed as an
/// existential and still be encoded.
private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        encodeClosure = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
