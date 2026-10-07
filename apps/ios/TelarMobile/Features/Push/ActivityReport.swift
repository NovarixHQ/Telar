import Foundation

struct ActivityReport: Decodable, Equatable {
    struct Start: Decodable, Equatable {
        var at: Double
        var status: Int
        var reason: String?
        var relay: Bool?
        var token: String?
    }
    var card: Bool
    var blocker: String?
    var lastStart: Start?
}
