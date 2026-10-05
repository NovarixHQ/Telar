import SwiftUI

struct SessionCardBody<Disclosure: View>: View {
    let row: HostedSession
    let host: String?
    let project: ProjectRef?
    let api: (any EngineAPI)?
    let disclosure: Disclosure

    @ScaledMetric(relativeTo: .caption2) private var projectMark: CGFloat = 12
    @ScaledMetric(relativeTo: .subheadline) private var titleProviderMark: CGFloat = 11
    @ScaledMetric(relativeTo: .caption) private var branchProviderMark: CGFloat = 11

    init(row: HostedSession, host: String?, project: ProjectRef?, api: (any EngineAPI)?, @ViewBuilder disclosure: () -> Disclosure) {
        self.row = row
        self.host = host
        self.project = project
        self.api = api
        self.disclosure = disclosure()
    }

    private var session: Session { row.session }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                if let host { HostMark(hostId: row.hostId, name: host, size: projectMark) }
                if session.settledOverride == "active" {
                    Image(systemName: "pin.fill").font(.system(Theme.captionTiny)).foregroundStyle(Theme.textMuted.opacity(0.7))
                }
                if let project {
                    ProjectAvatar(name: project.name, projectId: project.id, hostId: row.hostId, mark: project.mark, api: api, size: projectMark)
                    Text(project.name).font(.caption2).foregroundStyle(Theme.textMuted.opacity(0.75)).lineLimit(1)
                }
                Spacer(minLength: 4)
                SessionStatusSlot(session: session)
            }
            HStack(spacing: 6) {
                UnreadDot(session: session)
                Text(session.title.isEmpty ? "Untitled session" : session.title)
                    .font(Theme.rowTitle).foregroundStyle(Theme.text).lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 0)
                if session.workspace.branch == nil {
                    disclosure
                    ProviderIconView(driver: session.driver, size: titleProviderMark).opacity(0.5)
                }
            }
            if let branch = session.workspace.branch {
                HStack(spacing: 5) {
                    Image(systemName: "arrow.triangle.branch").font(.system(Theme.captionTiny))
                    Text(branch).font(.system(Theme.caption)).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 4)
                    disclosure
                    ProviderIconView(driver: session.driver, size: branchProviderMark).opacity(0.6)
                }
                .foregroundStyle(Theme.textMuted.opacity(0.7))
            }
        }
        .padding(.vertical, 4)
    }
}

struct SessionSlimBody: View {
    let row: HostedSession
    let host: String?
    let project: ProjectRef?
    let api: (any EngineAPI)?
    let settledHint: String?

    @ScaledMetric(relativeTo: .footnote) private var projectMark: CGFloat = 13
    @ScaledMetric(relativeTo: .footnote) private var providerMark: CGFloat = 12

    private var session: Session { row.session }

    var body: some View {
        HStack(spacing: 6) {
            if let host { HostMark(hostId: row.hostId, name: host, size: projectMark) }
            if session.settledOverride == "active" {
                Image(systemName: "pin.fill").font(.system(Theme.captionTiny)).foregroundStyle(Theme.textMuted.opacity(0.7))
            }
            if let project {
                ProjectAvatar(name: project.name, projectId: project.id, hostId: row.hostId, mark: project.mark, api: api, size: projectMark)
                    .opacity(0.8)
            } else {
                ProviderIconView(driver: session.driver, size: providerMark).opacity(0.6)
            }
            UnreadDot(session: session)
            Text(session.title.isEmpty ? "Untitled session" : session.title)
                .font(Settling.showsUnreadMark(session) ? Theme.rowTitleSlim.weight(.medium) : Theme.rowTitleSlim)
                .foregroundStyle(Settling.showsUnreadMark(session) ? Theme.text : Theme.text.opacity(0.7))
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 4)
            if let settledHint, session.activity == .idle, session.snoozedUntil == nil {
                Text(settledHint).font(.caption2).foregroundStyle(Theme.textMuted.opacity(0.7))
                    .lineLimit(1).truncationMode(.tail)
                    .layoutPriority(-1)
            } else {
                SessionStatusSlot(session: session)
            }
        }
    }
}
