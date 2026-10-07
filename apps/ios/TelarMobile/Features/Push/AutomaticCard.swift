import Foundation

enum AutomaticCard {
    static let sessionId = "__card__"
    static let maxRows = 5
    private static let ranks: [SessionActivity: Int] = [.blocked: 0, .working: 1, .queued: 2, .monitoring: 4]
    private static let statuses: [SessionActivity: String] = [.blocked: "Needs you", .working: "Working", .queued: "Queued", .monitoring: "Background"]

    private static func rank(_ session: Session) -> Int? { session.waitingOn != nil ? 3 : ranks[session.activity] }
    private static func status(_ session: Session) -> String {
        session.waitingOn.map { $0 > 1 ? "Waiting on \($0) sessions" : "Waiting on a session" } ?? statuses[session.activity]!
    }
    static func isActive(_ session: Session) -> Bool { rank(session) != nil }

    static func families(_ sessions: [Session]) -> [(root: Session, active: [Session])] {
        let byId = Dictionary(sessions.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        func root(_ session: Session) -> Session {
            var seen: Set<String> = [session.id]
            var current = session
            while let parent = current.startedFrom.flatMap({ byId[$0.sessionId] }) {
                guard seen.insert(parent.id).inserted else { return session }
                current = parent
            }
            return current
        }
        var order: [String] = []
        var active: [String: [Session]] = [:]
        for session in sessions {
            let top = root(session).id
            if active[top] == nil { order.append(top); active[top] = [] }
            if isActive(session) { active[top]!.append(session) }
        }
        return order.compactMap { id in active[id]!.isEmpty ? nil : (byId[id]!, active[id]!) }
    }

    static func initialState(_ sessions: [HostedSession], names: [HostID: String], previews: Bool, projects: [String: String] = [:], now: Date) -> SessionActivityAttributes.ContentState {
        let hosts = Dictionary(grouping: sessions, by: \.hostId).mapValues { families($0.map(\.session)) }.filter { !$0.value.isEmpty }
        let ranked = hosts.flatMap { host, families in
            families.map { family -> (row: SessionActivityRow, rank: Int, at: Timestamp) in
                let title = family.root.title.trimmingCharacters(in: .whitespacesAndNewlines)
                let workers = family.active.filter { $0.id != family.root.id }.count
                let lead = family.active.min { rank($0)! < rank($1)! }!
                let row = SessionActivityRow(id: family.root.id, status: status(lead),
                    title: previews && !title.isEmpty ? SessionActivityRow.clip(title, 60) : nil,
                    project: ([family.root] + family.active).lazy.compactMap { projects[$0.id] }.first.map { SessionActivityRow.clip($0, 40) },
                    workers: workers > 0 ? workers : nil, hostId: host.uuidString, host: hosts.count > 1 ? names[host] : nil)
                return (row, rank(lead)!, family.active.compactMap(\.activityAt).max() ?? 0)
            }
        }
        let rows = ranked.sorted { ($0.rank, -$0.at, $0.row.id) < ($1.rank, -$1.at, $1.row.id) }.prefix(maxRows).map(\.row)
        let count = ranked.count
        let title = count == 1 ? rows.first?.title ?? "Telar work" : "\(count) active sessions"
        return .init(title: title, status: rows.first?.status ?? "Working", updatedAt: now, startedAt: now, ended: false,
                     sessionId: rows.first?.id, activeCount: count, rows: Array(rows), hostId: rows.first?.hostId)
    }
}
