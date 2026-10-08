import Foundation

struct RunConfiguration: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var command: String
}

struct RunTerminal: Decodable, Identifiable, Equatable {
    var terminalId: String
    var origin: String
    var title: String
    var configId: String?
    var command: String
    var status: String
    var activity: String?

    var id: String { terminalId }
    var isOpen: Bool { status == "running" || status == "ready" }
}

protocol TerminalAPI: Sendable {
    func runConfigurations(_ sessionId: EngineID) async throws -> [RunConfiguration]
    func runStatus(_ sessionId: EngineID) async throws -> [RunTerminal]
    func terminals(_ sessionId: EngineID) async throws -> [EngineTerminal]
    func openTerminal(_ sessionId: EngineID, command: String) async throws -> EngineTerminal
    func restartTerminal(_ sessionId: EngineID, _ terminalId: String) async throws -> EngineTerminal
    func stopTerminal(_ sessionId: EngineID, _ terminalId: String) async throws -> EngineTerminal
    func writeTerminal(_ sessionId: EngineID, _ terminalId: String, data: String) async throws
    func terminalStatuses(_ sessionId: EngineID) -> AsyncThrowingStream<TerminalFrame, Error>
    func terminalFrames(_ sessionId: EngineID, _ terminalId: String, after: Int) -> AsyncThrowingStream<TerminalFrame, Error>
}

extension HTTPEngineAPI: TerminalAPI {
    func runConfigurations(_ sessionId: EngineID) async throws -> [RunConfiguration] {
        struct Reply: Decodable { var configurations: [Skippable<RunConfiguration>] }
        let reply: Reply = try await get("api/sessions/\(escape(sessionId))/run/configs")
        return reply.configurations.compactMap(\.value)
    }

    func runStatus(_ sessionId: EngineID) async throws -> [RunTerminal] {
        struct Reply: Decodable { var terminals: [Skippable<RunTerminal>] }
        let reply: Reply = try await get("api/sessions/\(escape(sessionId))/run/status")
        return reply.terminals.compactMap(\.value)
    }

    private func runPath(_ sessionId: EngineID, _ tail: String) -> String {
        "api/sessions/\(escape(sessionId))/run/\(tail)"
    }

    func terminals(_ sessionId: EngineID) async throws -> [EngineTerminal] {
        let list: TerminalList = try await get(runPath(sessionId, "status"))
        return list.terminals
    }

    func openTerminal(_ sessionId: EngineID, command: String) async throws -> EngineTerminal {
        try await post(runPath(sessionId, "open"), body: ["command": AnyEncodable(command)])
    }

    func restartTerminal(_ sessionId: EngineID, _ terminalId: String) async throws -> EngineTerminal {
        try await post(runPath(sessionId, "restart"), body: ["terminalId": AnyEncodable(terminalId), "closedBy": AnyEncodable("person")])
    }

    func stopTerminal(_ sessionId: EngineID, _ terminalId: String) async throws -> EngineTerminal {
        try await post(runPath(sessionId, "stop"), body: ["terminalId": AnyEncodable(terminalId), "closedBy": AnyEncodable("person")])
    }

    func writeTerminal(_ sessionId: EngineID, _ terminalId: String, data: String) async throws {
        let _: IgnoredBody = try await post(runPath(sessionId, "write"), body: ["terminalId": AnyEncodable(terminalId), "data": AnyEncodable(data)])
    }

    func terminalStatuses(_ sessionId: EngineID) -> AsyncThrowingStream<TerminalFrame, Error> {
        serverEvents(runPath(sessionId, "stream"))
    }

    func terminalFrames(_ sessionId: EngineID, _ terminalId: String, after: Int) -> AsyncThrowingStream<TerminalFrame, Error> {
        serverEvents(runPath(sessionId, "bytes/stream"), query: [
            URLQueryItem(name: "terminalId", value: terminalId),
            URLQueryItem(name: "after", value: String(after)),
        ])
    }

    private func serverEvents<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = []) -> AsyncThrowingStream<T, Error> {
        var request = makeRequest(url(path, query: query))
        request.timeoutInterval = 60
        request.setValue("text/event-stream", forHTTPHeaderField: "accept")
        let session = transport.streamSession()
        let onUnauthorized = self.onUnauthorized
        let (log, host, target) = (ConnectionLog.shared, transport.hostKey, ConnectionLog.describe(request.url))
        return AsyncThrowingStream { continuation in
            let task = Task {
                defer { session.invalidateAndCancel() }
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    log.note(host, "stream open \(target) \(status)")
                    defer { log.note(host, "stream closed \(target)") }
                    guard (200..<300).contains(status) else {
                        var body = Data()
                        for try await byte in bytes.prefix(4096) { body.append(byte) }
                        let error = EngineAPIError.failure(body, status: status)
                        if error.isUnauthorized { await onUnauthorized?() }
                        throw error
                    }
                    for try await line in bytes.lines where line.hasPrefix("data:") {
                        let payload = Data(line.dropFirst(5).drop { $0 == " " }.utf8)
                        if let value = try? JSONDecoder().decode(T.self, from: payload) { continuation.yield(value) }
                    }
                    continuation.finish()
                } catch {
                    log.note(host, "stream failed \(target) \(ConnectionLog.describe(.failure(error)))")
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
