import CoreTransferable
import Foundation
import UniformTypeIdentifiers

final class ConnectionLog: @unchecked Sendable {
    static let shared = ConnectionLog()

    private let limit: Int
    private let lock = NSLock()
    private var rings: [String: [String]] = [:]

    init(limit: Int = 500) {
        self.limit = limit
    }

    func note(_ host: String, _ event: String, at date: Date = Date()) {
        let line = "\(date.formatted(.iso8601.time(includingFractionalSeconds: true))) \(event)"
        lock.withLock {
            var ring = rings[host, default: []]
            ring.append(line)
            if ring.count > limit { ring.removeFirst(ring.count - limit) }
            rings[host] = ring
        }
    }

    func request(_ host: String, _ request: URLRequest, outcome: Result<Int, Error>, since started: ContinuousClock.Instant) {
        let elapsed = started.duration(to: .now).components
        let ms = elapsed.seconds * 1000 + elapsed.attoseconds / 1_000_000_000_000_000
        note(host, "\(request.httpMethod ?? "GET") \(Self.describe(request.url)) \(Self.describe(outcome)) \(ms)ms")
    }

    static func describe(_ url: URL?) -> String {
        guard let url else { return "-" }
        let origin = url.port.map { "\(url.host() ?? ""):\($0)" } ?? (url.host() ?? "")
        return "\(url.scheme ?? "")://\(origin)\(url.path())"
    }

    static func describe(_ outcome: Result<Int, Error>) -> String {
        guard case .failure(var error) = outcome else { return (try? outcome.get()).map(String.init) ?? "-" }
        if case EngineAPIError.transport(let inner) = error { error = inner }
        let ns = error as NSError
        return "\(ns.domain) \(ns.code)"
    }

    func export(names: [String: String]) -> String {
        let snapshot = lock.withLock { rings }
        return snapshot.keys.sorted().map { key in
            "== \(names[key] ?? key) ==\n" + snapshot[key, default: []].joined(separator: "\n")
        }.joined(separator: "\n\n") + "\n"
    }
}

struct ConnectionLogExport: Transferable {
    var names: [String: String]

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .plainText) { export in
            Data(ConnectionLog.shared.export(names: export.names).utf8)
        }
        .suggestedFileName("telar-connection-log.txt")
    }
}
