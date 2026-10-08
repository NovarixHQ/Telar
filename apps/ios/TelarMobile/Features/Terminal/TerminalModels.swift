import Foundation

enum TerminalStatus: String, Decodable, Sendable {
    case running, ready, exited, failed, closed
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TerminalStatus(rawValue: raw) ?? .unknown
    }
}

struct EngineTerminal: Decodable, Equatable, Identifiable, Sendable {
    struct LastExit: Decodable, Equatable, Sendable { var exitCode: Int? }

    var terminalId: String
    var title: String
    var command: String
    var status: TerminalStatus
    var activity: String?
    var lastExit: LastExit?
    var exitCode: Int?
    var signal: String?
    var error: String?
    var warning: String?
    var startedAt: Timestamp

    var id: String { terminalId }

    var isOpen: Bool { status == .running || status == .ready }

    var busy: Bool { activity == "busy" }

    var statusLabel: String {
        switch status {
        case .running, .ready:
            if busy { return status == .ready ? "Ready" : "Running" }
            let code = lastExit?.exitCode ?? 0
            return code == 0 ? "Idle" : "Idle · exit \(code)"
        case .failed: return "Failed"
        case .closed: return "Closed"
        case .exited: return (exitCode ?? 0) == 0 ? "Exited" : "Exited (\(exitCode ?? 0))"
        case .unknown: return "Unknown"
        }
    }

    var detail: String? {
        if let error { return error }
        if let warning { return warning.prefix(1).uppercased() + warning.dropFirst() + "." }
        if status == .exited, let signal { return "Stopped by \(signal)." }
        return nil
    }
}

struct TerminalList: Decodable, Sendable {
    var terminals: [EngineTerminal]

    private enum CodingKeys: String, CodingKey { case terminals }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        terminals = try c.decode([Skippable<EngineTerminal>].self, forKey: .terminals).compactMap(\.value)
    }
}

enum TerminalFrame: Decodable, Sendable {
    case bytes(data: String, cursor: Int, dropped: Int)
    case status(EngineTerminal)
    case other

    private enum CodingKeys: String, CodingKey { case type, data, cursor, dropped, run }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "run.bytes":
            self = .bytes(
                data: try c.decode(String.self, forKey: .data),
                cursor: try c.decode(Int.self, forKey: .cursor),
                dropped: (try? c.decode(Int.self, forKey: .dropped)) ?? 0
            )
        case "run.status":
            self = (try? c.decode(EngineTerminal.self, forKey: .run)).map { .status($0) } ?? .other
        default:
            self = .other
        }
    }
}
