import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case notAuthenticated
    case server(statusCode: Int, message: String?)
    case decoding(Error)
    case transport(Error)
    case cancelled

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The request URL was invalid."
        case .notAuthenticated:
            return "You are not signed in."
        case .server(let statusCode, let message):
            if let message, !message.isEmpty {
                return message
            }
            return "Server returned status \(statusCode)."
        case .decoding:
            return "Could not understand the server's response."
        case .transport(let error):
            return error.localizedDescription
        case .cancelled:
            return "The request was cancelled."
        }
    }
}
