import Foundation

struct RelayCardReport: Decodable, Equatable {
    struct Card: Decodable, Equatable { var armedAt: Double; var ended: Bool; var sentAt: Double? }
    struct Host: Decodable, Equatable { var id: String; var rows: Int; var active: Int; var at: Double }
    struct Attempt: Decodable, Equatable { var at: Double; var event: String; var status: Int; var reason: String? }
    var card: Card?
    var hosts: [Host]
    var attempts: [Attempt]
}

enum LiveActivityDiagnosis {
    static func refusal(_ report: RelayCardReport?, now: Date = Date()) -> String? {
        guard let last = report?.attempts.last, last.status != 200 else { return nil }
        let ago = RelativeDateTimeFormatter().localizedString(for: Date(timeIntervalSince1970: last.at / 1000), relativeTo: now)
        let said = last.reason.map { "\(last.status) \($0)" } ?? "\(last.status)"
        return "The last card \(last.event) was refused \(ago) (\(said))."
    }
}
