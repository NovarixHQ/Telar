import SwiftUI

func childState(_ state: ChildState) -> (label: String, tone: AgentTone) {
    switch state {
    case .working: ("Working", .live)
    case .waiting: ("Waiting", .attention)
    case .done: ("Done", .done)
    case .failed: ("Failed", .danger)
    case .stopped: ("Stopped", .quiet)
    case .ended: ("Ended", .quiet)
    }
}

func childDetail(_ child: ChildAgent, now: Timestamp) -> String? {
    var parts: [String] = []
    if let line = (child.isOut ? child.progress ?? child.summary : child.summary ?? child.progress), !line.isEmpty {
        parts.append(line)
    }
    if let start = child.startedAt {
        let end = child.isOut ? now : child.endedAt ?? now
        let format = DateComponentsFormatter()
        format.unitsStyle = .abbreviated
        format.allowedUnits = [.hour, .minute, .second]
        format.maximumUnitCount = 2
        if let span = format.string(from: TimeInterval(max(0, end - start)) / 1000) { parts.append(span) }
    }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

struct AgentsSheet: View {
    let watch: AgentsWatch
    let hostId: HostID?
    @Environment(\.dismiss) private var dismiss

    private var ordered: [ChildAgent] {
        watch.children.enumerated().sorted { a, b in
            if a.element.isOut != b.element.isOut { return a.element.isOut }
            return (a.element.startedAt ?? 0, a.offset) > (b.element.startedAt ?? 0, b.offset)
        }.map(\.element)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                let rows = ordered, now = Timestamp(Date().timeIntervalSince1970 * 1000)
                AgentSection(label: "Agents", count: rows.count) {
                    ForEach(rows) { child in
                        AgentRow(
                            title: child.title?.isEmpty == false ? child.title! : "Untitled session",
                            detail: childDetail(child, now: now),
                            state: childState(child.state),
                            activity: nil,
                            open: hostId.map { ScopedSessionID(hostId: $0, sessionId: child.sessionId).url },
                            last: child.id == rows.last?.id
                        )
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
            }
            .navigationTitle("Agents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .environment(\.openURL, OpenURLAction { url in
            dismiss()
            return .systemAction(url)
        })
        .presentationDetents([.medium, .large])
    }
}
