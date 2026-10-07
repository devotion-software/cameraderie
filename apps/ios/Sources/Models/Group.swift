import Foundation

struct PhotoGroup: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let ownerId: String
    let createdAt: String
    let myRole: String?
}

struct GroupsResponse: Codable {
    let groups: [PhotoGroup]
}

struct GroupResponse: Codable {
    let group: PhotoGroup
}

struct GroupMember: Codable, Identifiable, Equatable {
    let userId: String
    let role: String
    let joinedAt: String
    let name: String?
    let email: String?
    let image: String?

    var id: String { userId }
}

struct GroupMembersResponse: Codable {
    let members: [GroupMember]
}

struct CreateGroupRequest: Codable {
    let name: String
    let description: String?
}

struct Invite: Codable, Identifiable, Equatable {
    let id: String
    let code: String
    let groupId: String
}

struct InviteResponse: Codable {
    let invite: Invite
}

struct AcceptInviteResponse: Codable {
    let groupId: String
    let alreadyMember: Bool
}
