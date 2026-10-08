import SwiftUI

struct SessionFact: Equatable {
    let label: String
    let value: String
}

func sessionFacts(_ session: Session, project: String?, host: String?) -> [SessionFact] {
    var facts: [SessionFact] = []
    var parts: [String] = [session.driver.capitalized]
    if let model = session.model?.model, !model.isEmpty { parts.append(model) }
    if let effort = session.model?.effort, !effort.isEmpty { parts.append(effort) }
    let agent = parts.joined(separator: " · ")
    facts.append(SessionFact(label: "Agent", value: agent))
    if let project, !project.isEmpty { facts.append(SessionFact(label: "Project", value: project)) }
    if let host, !host.isEmpty { facts.append(SessionFact(label: "Computer", value: host)) }
    facts.append(SessionFact(label: "Started", value: relativeTime(session.createdAt)))
    if let usage = session.usage { facts.append(SessionFact(label: "Usage", value: SessionActionsMenu.usageLine(usage))) }
    return facts
}

struct FactRow<Value: View>: View {
    let label: String
    var last = false
    @ViewBuilder let value: Value
    @ScaledMetric(relativeTo: .footnote) private var labelColumn: CGFloat = 84

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(.system(Theme.footnote))
                .foregroundStyle(Theme.textMuted)
                .frame(width: labelColumn, alignment: .leading)
            value
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(Theme.borderSubtle).frame(height: 1).padding(.leading, 14) }
        }
        .accessibilityElement(children: .combine)
    }
}

struct FactValue: View {
    let text: String
    var mono = false

    var body: some View {
        Text(text)
            .font(mono ? .system(Theme.footnote, design: .monospaced) : .system(Theme.footnote, weight: .medium))
            .foregroundStyle(Theme.text)
            .lineLimit(2)
            .truncationMode(.middle)
            .textSelection(.enabled)
    }
}

struct SessionFactsCard: View {
    let session: Session
    let project: String?
    let host: String?

    var body: some View {
        let facts = sessionFacts(session, project: project, host: host)
        AgentSection(label: "About", count: nil) {
            ForEach(Array(facts.enumerated()), id: \.offset) { index, fact in
                FactRow(label: fact.label, last: index == facts.count - 1) {
                    FactValue(text: fact.value)
                }
            }
        }
    }
}
