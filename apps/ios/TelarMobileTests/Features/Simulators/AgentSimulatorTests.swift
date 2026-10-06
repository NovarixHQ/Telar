import Foundation
import Testing
@testable import TelarMobile

@Suite struct AgentSimulatorTests {
    private func event(_ json: String) -> EngineEvent {
        try! JSONDecoder().decode(EngineEvent.self, from: Data(json.utf8))
    }

    private func opened(_ id: String) -> EngineEvent {
        event(#"{"id":1,"at":1,"sessionId":"s","type":"simulator.opened","simulator":{"id":"\#(id)","platform":"ios","name":"iPhone \#(id)","version":"iOS 18.0","booted":true,"physical":false}}"#)
    }

    private func closed(_ id: String) -> EngineEvent {
        event(#"{"id":2,"at":2,"sessionId":"s","type":"simulator.closed","simulatorId":"\#(id)"}"#)
    }

    private func running(_ id: String) -> SimulatorSummary {
        SimulatorSummary(id: id, platform: "ios", name: "iPhone \(id)", version: "iOS 18.0", booted: true, physical: false)
    }

    @Test func theLatestOpenedSimulatorIsTheAgents() {
        #expect(agentSimulator(nil, after: [opened("A"), opened("B")]) == "B")
        #expect(agentSimulator("A", after: []) == "A")
    }

    @Test func closingTheAgentsSimulatorForgetsItButClosingAnotherDoesNot() {
        #expect(agentSimulator("A", after: [closed("A")]) == nil)
        #expect(agentSimulator("A", after: [closed("B")]) == "A")
    }

    @Test func thePillPutsTheAgentsSimulatorFirstAndFallsBackToTheRunningOrder() {
        let all = [running("A"), running("B"), running("C")]
        #expect(preferringAgent(all, "C").map(\.id) == ["C", "A", "B"])
        #expect(preferringAgent(all, nil).map(\.id) == ["A", "B", "C"])
        #expect(preferringAgent(all, "gone").map(\.id) == ["A", "B", "C"])
    }
}
