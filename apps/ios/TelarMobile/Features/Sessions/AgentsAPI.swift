import Foundation

protocol AgentsAPI: Sendable {
    func sessionChildren(_ id: EngineID) async throws -> [ChildAgent]
}

extension HTTPEngineAPI: AgentsAPI {
    func sessionChildren(_ id: EngineID) async throws -> [ChildAgent] {
        let list: ChildList = try await get("api/sessions/\(escape(id))/children")
        return (list.children ?? []).compactMap(\.agent)
    }
}

enum ChildState: String, Equatable {
    case working, waiting, done, failed, stopped, ended
}

struct ChildAgent: Decodable, Identifiable, Equatable {
    var sessionId: EngineID
    var parentRunId: EngineID?
    var title: String?
    var progress: String?
    var summary: String?
    var state: ChildState
    var startedAt: Timestamp?
    var endedAt: Timestamp?
    var id: EngineID { sessionId }
    var isOut: Bool { state == .working || state == .waiting }

    private enum Keys: String, CodingKey {
        case sessionId, parentRunId, title, progress, summary, state, startedAt, endedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        sessionId = try c.decode(EngineID.self, forKey: .sessionId)
        state = ChildState(rawValue: try c.decode(String.self, forKey: .state)) ?? .ended
        parentRunId = try? c.decodeIfPresent(EngineID.self, forKey: .parentRunId)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
        progress = try? c.decodeIfPresent(String.self, forKey: .progress)
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        startedAt = (try? c.decodeIfPresent(Double.self, forKey: .startedAt)).map { Timestamp($0) }
        endedAt = (try? c.decodeIfPresent(Double.self, forKey: .endedAt)).map { Timestamp($0) }
    }
}

private struct ChildList: Decodable {
    struct Entry: Decodable {
        var agent: ChildAgent?
        init(from decoder: Decoder) throws { agent = try? ChildAgent(from: decoder) }
    }
    var children: [Entry]?
}

struct AgentsTally: Equatable {
    var working: Int
    var total: Int
}

func agentsTally(_ children: [ChildAgent]) -> AgentsTally? {
    let live = Set(children.filter(\.isOut).map { $0.parentRunId ?? "" })
    guard !live.isEmpty else { return nil }
    let batch = children.filter { live.contains($0.parentRunId ?? "") }
    return AgentsTally(working: batch.filter(\.isOut).count, total: batch.count)
}
