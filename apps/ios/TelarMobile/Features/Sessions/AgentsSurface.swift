import SwiftUI

enum AgentRelation: String, Equatable {
    case assigned, finished, started, followed
}

struct RelatedDelegate: Identifiable, Equatable {
    var session: Session
    var kind: AgentRelation

    var scope: String?

    var outcome: String?

    var at: Timestamp?

    var subscriptionIds: [EngineID]
    var id: EngineID { session.id }
}

struct RelatedCoordinator: Identifiable, Equatable {
    var session: Session?
    var sessionId: EngineID
    var scope: String?
    var outcome: String?

    var at: Timestamp?

    var outstanding: Bool
    var unresolved: Bool
    var id: String
}

private func outstandingFrom(_ assignments: [SessionAssignment]?, _ coordinatorId: EngineID) -> SessionAssignment? {
    assignments?.first { $0.fromSessionId == coordinatorId && $0.outcome == nil && $0.unresolved != true }
}

private func endedFrom(_ assignments: [SessionAssignment]?, _ coordinatorId: EngineID) -> SessionAssignment? {
    assignments?.last { $0.fromSessionId == coordinatorId && $0.outcome != nil && $0.outcome != "detached" }
}

func delegatesOf(
    _ sessions: [Session],
    assignments: [EngineID: [SessionAssignment]],
    coordinator coordinatorId: EngineID,
    following: [Subscription] = []
) -> [RelatedDelegate] {
    var assigned: [Session] = [], finished: [Session] = [], started: [Session] = []
    for session in sessions where session.id != coordinatorId {
        let mine = (assignments[session.id] ?? []).filter { $0.fromSessionId == coordinatorId }
        if mine.contains(where: { $0.outcome == nil && $0.unresolved != true }) {
            assigned.append(session)
        } else if mine.contains(where: { $0.outcome != nil && $0.outcome != "detached" }) {
            finished.append(session)
        } else if session.startedFrom?.sessionId == coordinatorId {
            started.append(session)
        }
    }

    var follows: [EngineID: [EngineID]] = [:]
    var watched: [EngineID] = []
    for subscription in following {
        guard sessions.contains(where: { $0.id == subscription.targetSessionId }) else { continue }
        if follows[subscription.targetSessionId] == nil { watched.append(subscription.targetSessionId) }
        follows[subscription.targetSessionId, default: []].append(subscription.id)
    }

    var out: [RelatedDelegate] = []
    var seen: Set<EngineID> = [coordinatorId]
    func add(_ session: Session, _ kind: AgentRelation, scope: String? = nil, outcome: String? = nil, at: Timestamp? = nil) {
        guard !seen.contains(session.id) else { return }
        seen.insert(session.id)
        out.append(RelatedDelegate(session: session, kind: kind, scope: scope, outcome: outcome, at: at,
                                   subscriptionIds: follows[session.id] ?? []))
    }

    for session in assigned {
        let errand = outstandingFrom(assignments[session.id], coordinatorId)
        add(session, .assigned, scope: errand?.scope, at: errand?.receivedAt)
    }
    for session in finished {
        let errand = endedFrom(assignments[session.id], coordinatorId)
        add(session, .finished, scope: errand?.scope, outcome: errand?.outcome, at: errand?.endedAt)
    }
    for session in started {
        add(session, .started, at: session.createdAt)
    }
    for id in watched {
        guard let session = sessions.first(where: { $0.id == id }) else { continue }
        add(session, .followed)
    }
    return out
}

func coordinatorsOf(
    _ sessions: [Session],
    assignments: [EngineID: [SessionAssignment]],
    of sessionId: EngineID
) -> [RelatedCoordinator] {
    let held = (assignments[sessionId] ?? []).filter { $0.outcome != "detached" }
    return held.enumerated().map { index, assignment in
        let at = assignment.endedAt ?? assignment.receivedAt
        return RelatedCoordinator(
            session: sessions.first { $0.id == assignment.fromSessionId },
            sessionId: assignment.fromSessionId,
            scope: assignment.scope,
            outcome: assignment.outcome,
            at: at,
            outstanding: assignment.outcome == nil && assignment.unresolved != true,
            unresolved: assignment.unresolved == true,

            id: "\(index):\(assignment.fromSessionId)"
        )
    }

    .enumerated().sorted { a, b in
        if a.element.outstanding != b.element.outstanding { return a.element.outstanding }
        let (left, right) = (a.element.at ?? 0, b.element.at ?? 0)
        return left == right ? a.offset < b.offset : left > right
    }.map(\.element)
}

enum AgentTone: Equatable {
    case live, attention, done, danger, quiet
}

func outcomeLabel(_ outcome: String) -> String {
    switch outcome {
    case "completed": "Done"
    case "failed": "Failed"
    case "stopped": "Stopped"
    case "detached": "Detached"
    default: outcome
    }
}

func outcomeTone(_ outcome: String) -> AgentTone {
    switch outcome {
    case "completed": .done
    case "failed": .danger
    default: .quiet
    }
}

func delegateState(_ entry: RelatedDelegate) -> (label: String, tone: AgentTone) {
    if entry.kind == .finished, let outcome = entry.outcome {
        return (outcomeLabel(outcome), outcomeTone(outcome))
    }
    switch entry.session.activity {
    case .blocked: return ("Needs you", .attention)
    case .working: return ("Working", .live)
    case .queued: return ("Queued", .live)
    case .monitoring: return ("Monitoring", .live)

    case .idle: return (entry.kind == .assigned ? "Working" : "Idle", .quiet)
    }
}

func delegateDetail(_ entry: RelatedDelegate, now: Timestamp) -> String? {
    var parts: [String] = []
    if let scope = entry.scope, !scope.isEmpty { parts.append(scope) }
    else if entry.kind == .started { parts.append("started from here") }
    else if entry.kind == .followed { parts.append("following") }
    if let at = entry.at { parts.append(relativeTime(at)) }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

func coordinatorState(_ entry: RelatedCoordinator) -> (label: String, tone: AgentTone) {
    if let outcome = entry.outcome { return (outcomeLabel(outcome), outcomeTone(outcome)) }
    if entry.unresolved { return ("Unknown", .quiet) }
    return ("Assigned", entry.outstanding ? .live : .quiet)
}

func coordinatorDetail(_ entry: RelatedCoordinator) -> String? {
    var parts: [String] = []
    if let scope = entry.scope, !scope.isEmpty { parts.append(scope) }
    if entry.unresolved { parts.append("state unknown") }
    if let at = entry.at { parts.append(relativeTime(at)) }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

struct AgentsSurface: View {
    let api: any EngineAPI
    let sessionId: EngineID

    let hostId: HostID?

    let active: Bool

    @State private var sessions: [Session] = []
    @State private var assignments: [EngineID: [SessionAssignment]] = [:]
    @State private var following: [Subscription] = []
    @State private var loaded = false
    @State private var failed = false

    @State private var etag: String?

    @Environment(\.scenePhase) private var scenePhase

    private static let poll = Duration.seconds(10)

    private var delegates: [RelatedDelegate] {
        delegatesOf(sessions, assignments: assignments, coordinator: sessionId, following: following)
    }
    private var employers: [RelatedCoordinator] {
        coordinatorsOf(sessions, assignments: assignments, of: sessionId)
    }

    var body: some View {
        ScrollView {
            let delegates = delegates, employers = employers
            if delegates.isEmpty && employers.isEmpty {
                if loaded { AgentsEmpty(failed: failed) }
            } else {
                VStack(alignment: .leading, spacing: 20) {
                    if !delegates.isEmpty {
                        AgentSection(label: "Working for this conversation", count: delegates.count) {
                            ForEach(delegates) { entry in delegateRow(entry, last: entry.id == delegates.last?.id) }
                        }
                    }
                    if !employers.isEmpty {
                        AgentSection(label: "Working for", count: employers.count) {
                            ForEach(employers) { entry in employerRow(entry, last: entry.id == employers.last?.id) }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
            }
        }
        .refreshable { await read() }

        .task(id: "\(sessionId):\(active):\(scenePhase == .active)") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await read()
                try? await Task.sleep(for: Self.poll)
            }
        }
    }

    private func delegateRow(_ entry: RelatedDelegate, last: Bool) -> AgentRow {
        AgentRow(
            title: entry.session.title.isEmpty ? "Untitled session" : entry.session.title,
            detail: delegateDetail(entry, now: now),
            state: delegateState(entry),
            activity: entry.kind == .finished && entry.outcome != nil ? nil : entry.session.activity,
            open: destination(entry.session.id),
            last: last
        )
    }

    private func employerRow(_ entry: RelatedCoordinator, last: Bool) -> AgentRow {
        let title = entry.session?.title.isEmpty == false
            ? entry.session!.title
            : "Conversation \(entry.sessionId.prefix(8))"

        let detail = [coordinatorDetail(entry), entry.session == nil ? "no longer listed" : nil]
            .compactMap { $0 }.joined(separator: " · ")
        return AgentRow(
            title: title,
            detail: detail.isEmpty ? nil : detail,
            state: coordinatorState(entry),
            activity: entry.session?.activity,
            open: entry.session.flatMap { destination($0.id) },
            last: last
        )
    }

    private func destination(_ id: EngineID) -> URL? {
        hostId.map { ScopedSessionID(hostId: $0, sessionId: id).url }
    }

    private var now: Timestamp { Timestamp(Date().timeIntervalSince1970 * 1000) }

    private func read() async {
        let answer = try? await api.liveSessions(matching: etag, since: nil, all: true)
        let subscriptions = try? await api.sessionSubscriptions(sessionId)
        if let answer {
            etag = answer.etag
            if let list = answer.live {
                sessions = list.sessions
                assignments = list.assignments
            }
        }
        if let subscriptions { following = subscriptions }
        failed = answer == nil
        loaded = true
    }
}
