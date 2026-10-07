import Foundation

struct PushRegistration: Encodable {
    struct Follow: Encodable {
        var sessionId: String
        var token: String
        var startedAt: Double
    }
    var hostId: String
    var token: String
    var topic: String
    var sandbox: Bool
    var enabled: Bool
    var completions: Bool
    var previews: Bool
    var sounds: String? = nil
    var mutedSessions: [String]
    var activities: [Follow]
    var liveActivities: Bool = false
    var pushToStartToken: String? = nil
    var hostName: String? = nil
    var relay: RelayCredential? = nil
}
struct PushStatus: Decodable {
    var configured: Bool
    var activity: ActivityReport?
}
