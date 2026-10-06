import Observation
import SwiftUI

@MainActor @Observable final class SimulatorWatch {
    private(set) var running: [SimulatorSummary] = []

    func watch(_ api: any SimulatorsAPI) async {
        while !Task.isCancelled {
            var pause = Duration.seconds(15)
            if let state = try? await api.simulators() {
                if state.viewable != running { running = state.viewable }
                if state.status == "disabled" { pause = .seconds(60) }
            }
            try? await Task.sleep(for: pause)
        }
    }
}

struct SimulatorPill: View {
    let api: any SimulatorsAPI
    let running: [SimulatorSummary]
    @State private var shown = false

    private var title: String {
        running.count == 1 ? "\(running[0].name) is running" : "\(running[0].name) and \(running.count - 1) more running"
    }

    var body: some View {
        Button { shown = true } label: {
            HStack(spacing: 6) {
                Image(systemName: "iphone").font(.system(Theme.footnote, weight: .medium))
                Text(title).font(.system(Theme.footnote, weight: .medium)).lineLimit(1)
            }
            .foregroundStyle(Theme.text)
            .padding(.horizontal, 14)
            .scaledHeight(34, relativeTo: .footnote)
            .background(Theme.card, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Watch and control the simulator")
        .fullScreenCover(isPresented: $shown) {
            SimulatorViewer(api: api, simulators: running, selectedId: running.first?.id)
        }
    }
}
