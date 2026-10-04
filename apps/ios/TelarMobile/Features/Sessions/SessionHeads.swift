import SwiftUI

struct SessionHead {
    var snapshot: SessionSnapshot
    var events: [EngineEvent]
    var cursor: Int
    var page: SnapshotPage?
    var folded: Folded
    var snapshotData: Data?
    var savedAt: Timestamp
}

@MainActor final class SessionHeads {
    static let shared = SessionHeads()

    static let held = 16
    static let headBytes = SnapshotCache.sessionBytes
    static let warming = 2
    static let queued = 8

    private var heads: [ScopedSessionID: SessionHead] = [:]
    private var order: [ScopedSessionID] = []
    private var inFlight = Set<ScopedSessionID>()
    private var queue: [(key: ScopedSessionID, api: any EngineAPI)] = []
    private var tasks: [ScopedSessionID: Task<Void, Never>] = [:]

    var keys: [ScopedSessionID] { order }

    func head(_ key: ScopedSessionID) -> SessionHead? {
        guard let head = heads[key] else { return nil }
        touch(key)
        return head
    }

    func put(_ key: ScopedSessionID, _ head: SessionHead) {
        guard (head.snapshotData?.count ?? 0) <= Self.headBytes else { return drop(key) }
        heads[key] = head
        touch(key)
        while order.count > Self.held { heads[order.removeFirst()] = nil }
    }

    func drop(_ key: ScopedSessionID) {
        heads[key] = nil
        order.removeAll { $0 == key }
    }

    func forget(host: HostID) {
        for key in order where key.hostId == host { heads[key] = nil }
        order.removeAll { $0.hostId == host }
        queue.removeAll { $0.key.hostId == host }
        inFlight = inFlight.filter { $0.hostId != host }
    }

    func warm(_ key: ScopedSessionID, api: () -> (any EngineAPI)?) {
        guard heads[key] == nil, !inFlight.contains(key), let api = api() else { return }
        queue.removeAll { $0.key == key }
        queue.append((key, api))
        if queue.count > Self.queued { queue.removeFirst() }
        pump()
    }

    func cancelWarm(_ key: ScopedSessionID) {
        queue.removeAll { $0.key == key }
    }

    func awaitWarming() async {
        while let task = tasks.values.first { await task.value }
    }

    private func pump() {
        while inFlight.count < Self.warming, let next = queue.popLast() {
            inFlight.insert(next.key)
            let api = next.api
            let sessionId = next.key.sessionId
            tasks[next.key] = Task.detached(priority: .utility) { [weak self] in
                let head = try? await loadHead(api, sessionId)
                await self?.landed(next.key, head)
            }
        }
    }

    private func landed(_ key: ScopedSessionID, _ head: SessionHead?) {
        tasks[key] = nil
        if inFlight.remove(key) != nil, let head, heads[key] == nil { put(key, head) }
        pump()
    }

    private func touch(_ key: ScopedSessionID) {
        order.removeAll { $0 == key }
        order.append(key)
    }
}

func loadHead(_ api: some EngineAPI, _ sessionId: EngineID) async throws -> SessionHead {
    let hydrated = try await hydrateSession(api, sessionId, window: SnapshotWindow(turns: initialTurns))
    return SessionHead(
        snapshot: hydrated.snapshot, events: hydrated.events, cursor: hydrated.cursor,
        page: hydrated.snapshot.page, folded: fold(hydrated.snapshot, events: hydrated.events),
        snapshotData: hydrated.snapshotData, savedAt: Timestamp(Date().timeIntervalSince1970 * 1000)
    )
}

extension View {
    func warmsHead(_ key: ScopedSessionID, api: @escaping () -> (any EngineAPI)?) -> some View {
        task(id: key) {
            try? await Task.sleep(for: .milliseconds(300))
            if !Task.isCancelled { SessionHeads.shared.warm(key, api: api) }
        }
        .onDisappear { SessionHeads.shared.cancelWarm(key) }
    }
}
