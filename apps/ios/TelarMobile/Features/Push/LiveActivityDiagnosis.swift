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
    static func lines(systemAllowed: Bool, toggle: Bool, report: RelayCardReport?, macs: [(id: String, name: String)], now: Date = Date()) -> [String] {
        if !systemAllowed { return ["Live Activities are off for Telar in iOS Settings ▸ Telar."] }
        if !toggle { return ["Automatic Live Activities are off."] }
        guard let report else { return ["The push relay has not answered yet."] }
        let ago = { (ms: Double) in RelativeDateTimeFormatter().localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: now) }
        var lines = [report.card.map { $0.ended ? "The last card has ended. A new one starts when you open Telar while work is running." : "Card running since \(ago($0.armedAt))." }
            ?? "No card yet. One starts when you open Telar while a computer has active work."]
        for mac in macs {
            let host = report.hosts.first { $0.id.caseInsensitiveCompare(mac.id) == .orderedSame }
            lines.append("\(mac.name): " + (host.map { "\($0.active) active, last heard \(ago($0.at))." } ?? "nothing on the card."))
        }
        if let last = report.attempts.last {
            let said = last.reason.map { "\(last.status) \($0)" } ?? "\(last.status)"
            lines.append(last.status == 200 ? "Last \(last.event) delivered \(ago(last.at))." : "Last \(last.event) refused \(ago(last.at)) (\(said)).")
        }
        return lines
    }
}
