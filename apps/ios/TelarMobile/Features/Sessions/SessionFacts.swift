import SwiftUI

struct SessionFact: Equatable {
    let label: String
    let value: String
    var mono = false
}

func sessionFacts(_ session: Session, project: String?, host: String?) -> [SessionFact] {
    var facts: [SessionFact] = []
    var parts: [String] = [session.driver.capitalized]
    if let model = session.model?.model, !model.isEmpty { parts.append(model) }
    if let effort = session.model?.effort, !effort.isEmpty { parts.append(effort) }
    let agent = parts.joined(separator: " · ")
    facts.append(SessionFact(label: "Agent", value: agent))
    facts.append(SessionFact(label: "Workspace", value: session.workspace.mode == "worktree" ? "Own worktree" : "Project checkout"))
    if let branch = session.workspace.branch { facts.append(SessionFact(label: "Branch", value: branch, mono: true)) }
    if let project, !project.isEmpty { facts.append(SessionFact(label: "Project", value: project)) }
    if let host, !host.isEmpty { facts.append(SessionFact(label: "Computer", value: host)) }
    facts.append(SessionFact(label: "Started", value: relativeTime(session.createdAt)))
    if let usage = session.usage { facts.append(SessionFact(label: "Usage", value: SessionActionsMenu.usageLine(usage))) }
    return facts
}

struct SessionFactsCard: View {
    let session: Session
    let project: String?
    let host: String?
    @ScaledMetric(relativeTo: .footnote) private var labelColumn: CGFloat = 84

    var body: some View {
        let facts = sessionFacts(session, project: project, host: host)
        AgentSection(label: "About", count: nil) {
            ForEach(Array(facts.enumerated()), id: \.offset) { index, fact in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(fact.label)
                        .font(.system(Theme.footnote))
                        .foregroundStyle(Theme.textMuted)
                        .frame(width: labelColumn, alignment: .leading)
                    Text(fact.value)
                        .font(fact.mono ? .system(Theme.footnote, design: .monospaced) : .system(Theme.footnote, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .overlay(alignment: .bottom) {
                    if index < facts.count - 1 { Rectangle().fill(Theme.borderSubtle).frame(height: 1).padding(.leading, 14) }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}
