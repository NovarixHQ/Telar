import Observation
import SwiftUI

@MainActor @Observable final class AgentsWatch {
    private(set) var children: [ChildAgent] = []
    var tally: AgentsTally? { agentsTally(children) }

    func follow(_ api: any AgentsAPI, sessionId: EngineID) async {
        repeat {
            do {
                let list = try await api.sessionChildren(sessionId)
                if list != children { children = list }
            } catch EngineAPIError.transport {
            } catch {
                children = []
            }
            guard tally != nil else { return }
            try? await Task.sleep(for: .seconds(5))
        } while !Task.isCancelled
    }
}

func agentsPulse(_ turns: [JournalTurn], active: Bool) -> String {
    "\(active):\(turns.count):\(turns.last?.items.count ?? 0):\(turns.last?.state.rawValue ?? "-")"
}

struct AgentsPill: View {
    let tally: AgentsTally
    let watch: AgentsWatch
    let hostId: HostID?
    @State private var shown = false

    private var title: String {
        "\(tally.working) / \(tally.total) \(tally.total == 1 ? "agent" : "agents") working"
    }

    var body: some View {
        Button { shown = true } label: {
            HStack(spacing: 8) {
                Circle().fill(Theme.statusSky).frame(width: 7, height: 7)
                Text(title).monospacedDigit().foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 8)
                Text("View").foregroundStyle(Theme.accent)
            }
            .font(.system(Theme.footnote, weight: .medium))
            .padding(.horizontal, 14)
            .scaledHeight(34, relativeTo: .footnote)
            .background(Theme.card, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityHint("Lists this conversation's agents")
        .sheet(isPresented: $shown) { AgentsSheet(watch: watch, hostId: hostId) }
    }
}
