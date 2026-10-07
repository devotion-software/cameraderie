import Foundation

struct User: Codable, Identifiable, Equatable {
    let id: String
    let email: String
    let name: String
    let plan: String?
}

struct MeResponse: Codable {
    let user: User
}

struct UsageResponse: Codable {
    let usedBytes: Int
    let quotaBytes: Int
    let plan: String
    let readOnly: Bool

    var fractionUsed: Double {
        guard quotaBytes > 0 else { return 0 }
        return min(1, Double(usedBytes) / Double(quotaBytes))
    }
}
