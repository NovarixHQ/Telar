import Foundation
import Testing
@testable import TelarMobile

@Suite struct SessionFactsTests {
    private func session(_ extra: [String: Any]) throws -> Session {
        var object: [String: Any] = [
            "id": "s", "projectId": "p", "title": "T", "createdAt": 1000, "updatedAt": 1000,
            "activity": "idle", "driver": "claude", "workspace": ["mode": "local", "path": "/tmp"],
        ]
        object.merge(extra) { $1 }
        return try JSONDecoder().decode(Session.self, from: JSONSerialization.data(withJSONObject: object))
    }

    @Test func aWorktreeSessionNamesItsAgentBranchProjectAndComputer() throws {
        let facts = sessionFacts(try session([
            "model": ["instanceId": "claude", "model": "opus", "effort": "high"],
            "workspace": ["mode": "worktree", "path": "/tmp/w", "branch": "telar/panel"],
        ]), project: "Telar", host: "Studio Mac")
        #expect(facts.map(\.label) == ["Agent", "Workspace", "Branch", "Project", "Computer", "Started"])
        #expect(facts[0].value == "Claude · opus · high")
        #expect(facts[1].value == "Own worktree")
        #expect(facts[2] == SessionFact(label: "Branch", value: "telar/panel", mono: true))
    }

    @Test func whatIsNotKnownIsLeftOut() throws {
        let facts = sessionFacts(try session([:]), project: nil, host: "")
        #expect(facts.map(\.label) == ["Agent", "Workspace", "Started"])
        #expect(facts[0].value == "Claude" && facts[1].value == "Project checkout")
    }
}
