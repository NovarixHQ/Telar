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
}
