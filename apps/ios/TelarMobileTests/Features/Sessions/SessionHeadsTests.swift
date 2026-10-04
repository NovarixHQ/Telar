import Foundation
import Testing
@testable import TelarMobile

private actor HeadAPI: EngineAPI {
    private(set) var calls: [String] = []
    let snapshotJSON: String
    let tailJSON: String
    let deltaJSON: String

    init(snapshot: String, tail: String = #"{"events":[],"cursor":0,"more":false}"#, delta: String = #"{"reset":true}"#) {
        snapshotJSON = snapshot
        tailJSON = tail
        deltaJSON = delta
    }

    func recorded() -> [String] { calls }

    func session(_ id: EngineID, window: SnapshotWindow?) async throws -> SessionSnapshot {
        try await sessionRead(id, window: window).snapshot
    }

    func sessionRead(_ id: EngineID, window: SnapshotWindow?) async throws -> SessionRead {
        calls.append("session")
        let data = Data(snapshotJSON.utf8)
        return SessionRead(snapshot: try JSONDecoder().decode(SessionSnapshot.self, from: data), data: data)
    }

    func events(_ id: EngineID, after: Int) async throws -> EventPage {
        calls.append("events(\(after))")
        return try JSONDecoder().decode(EventPage.self, from: Data(tailJSON.utf8))
    }

    func sessionDelta(_ id: EngineID, after: Int) async throws -> SessionDelta {
        calls.append("delta(\(after))")
        return try JSONDecoder().decode(SessionDelta.self, from: Data(deltaJSON.utf8))
    }

    func health() async throws -> EngineHealth { fatalError("unused") }
    func liveSessions() async throws -> LiveSessions { fatalError("unused") }
    func projectIcon(_ projectId: EngineID, icon: String) async throws -> Data { fatalError("unused") }
    func submitTurn(_ id: EngineID, runId: String, input: String, attachments: [EngineID]?) async throws -> TurnSubmissionResult { fatalError("unused") }
    func stopSession(_ id: EngineID) async throws {}
    func stopTurn(_ id: EngineID, runId: String) async throws {}
    func resolveRequest(_ id: EngineID, requestId: EngineID, decision: RequestDecision, reason: String?, answers: [String: AnswerValue]?) async throws {}
    func patchSession(_ id: EngineID, patch: SessionPatch) async throws {}
    func markSessionRead(_ id: EngineID, runId: String) async throws -> Session { fatalError("unused") }
    func promoteTurn(_ id: EngineID, runId: String) async throws {}
    func createSession(projectId: EngineID, input: NewSessionInput) async throws -> Session { fatalError("unused") }
    func inboxPolicy() async throws -> InboxPolicy { InboxPolicy(autoSettleAfterHours: 72) }
    func uploadAttachment(_ id: EngineID, name: String, mediaType: String, data: Data) async throws -> TurnAttachment { fatalError("unused") }
    func models(driver: String) async throws -> ModelCatalogue { fatalError("unused") }
    func providerInstances() async throws -> [ProviderInstance] { [] }
    func sessionSkills(_ id: EngineID) async throws -> ProviderSkills { .empty }
    func projectSkills(_ projectId: EngineID, driver: String?) async throws -> ProviderSkills { .empty }
    func sessionDiff(_ id: EngineID) async throws -> SessionDiff { fatalError("unused") }
    func filePatch(_ id: EngineID, path: String, untracked: Bool) async throws -> FilePatch { fatalError("unused") }
    func listDirectories(path: String?) async throws -> DirectoryListing { fatalError("unused") }
    func registerProject(name: String, root: String) async throws -> ProjectRef { fatalError("unused") }
    func projectGit(_ projectId: EngineID) async throws -> GitOverview { fatalError("unused") }
    func remoteStatus() async throws -> RemoteStatus { fatalError("unused") }
    func renameDevice(_ id: String, name: String) async throws -> RemoteDevice { fatalError("unused") }
    func setDeviceRole(_ id: String, role: String) async throws -> RemoteDevice { fatalError("unused") }
    func revokeDevice(_ id: String) async throws {}
    func revokeOtherDevices() async throws -> Int { 0 }
}

private func snapshotJSON(cursor: Int, state: String, items: [String]) -> String {
    """
    {"cursor":\(cursor),"session":{"id":"s","projectId":"p","title":"Held","state":"active",
      "createdAt":1,"updatedAt":2,"driver":"claude",
      "workspace":{"mode":"local","path":"/x"},"runtimeMode":"auto","detached":false},
     "turns":[{"runId":"run_1","sessionId":"s","sequence":1,"state":"\(state)","input":"hi","acceptedAt":1,"updatedAt":1}],
     "items":[\(items.joined(separator: ","))],"requests":[],"tasks":[]}
    """
}

private func itemJSON(_ id: String) -> String {
    #"{"id":"\#(id)","runId":"run_1","sessionId":"s","status":"completed","startedAt":1,"detail":{"type":"assistant_message","text":"\#(id)"}}"#
}

private func itemEvent(_ id: Int, _ item: String) -> String {
    #"{"id":\#(id),"at":2,"sessionId":"s","runId":"run_1","type":"item.completed","item":\#(itemJSON(item))}"#
}

private let held = snapshotJSON(cursor: 7, state: "running", items: [itemJSON("a1")])

private func cache(_ host: HostID) -> HostSnapshotCache {
    HostSnapshotCache(cache: SnapshotCache(root: FileManager.default.temporaryDirectory.appending(path: "telar-heads-\(UUID().uuidString)")), hostId: host)
}

@MainActor private func heldHead(_ snapshot: String = held) async throws -> SessionHead {
    try await loadHead(HeadAPI(snapshot: snapshot), "s")
}

@MainActor private func freshLoad(_ api: HeadAPI) async -> SessionSyncEngine {
    let engine = SessionSyncEngine(api: api, sessionId: "s")
    await engine.refresh()
    await engine.awaitPendingWork()
    return engine
}

@Suite @MainActor struct SessionHeadsTests {
    @Test func aCachedHeadPaintsBeforeAnyNetworkCall() async throws {
        let host = HostID()
        let heads = SessionHeads()
        heads.put(ScopedSessionID(hostId: host, sessionId: "s"), try await heldHead())
        let api = HeadAPI(snapshot: held)

        let engine = SessionSyncEngine(api: api, sessionId: "s", cache: cache(host), heads: heads)

        #expect(engine.session?.title == "Held")
        #expect(engine.turns.first?.items.map(\.id) == ["a1"])
        #expect(await api.recorded().isEmpty)
    }

    @Test func applyingADeltaEqualsAFreshLoad() async throws {
        let host = HostID()
        let heads = SessionHeads()
        heads.put(ScopedSessionID(hostId: host, sessionId: "s"), try await heldHead())
        let tail = #"{"events":[\#(itemEvent(8, "a2")),\#(itemEvent(9, "a3"))],"cursor":9,"more":false}"#
        let delta = #"{"reset":false,"events":[\#(itemEvent(8, "a2")),\#(itemEvent(9, "a3"))],"cursor":9}"#
        let api = HeadAPI(snapshot: held, tail: tail, delta: delta)

        let engine = SessionSyncEngine(api: api, sessionId: "s", cache: cache(host), heads: heads)
        await engine.open()
        await engine.awaitPendingWork()

        #expect(await api.recorded() == ["delta(7)"])
        let fresh = await freshLoad(HeadAPI(snapshot: held, tail: tail))
        #expect(engine.turns == fresh.turns)
        #expect(engine.turns.first?.items.map(\.id) == ["a1", "a2", "a3"])
        #expect(engine.connection == .live)
        #expect(engine.recordedAt == nil)
    }

    @Test func aDeltaThatMovesTheQueueRereadsTheSnapshotAndStillEqualsAFreshLoad() async throws {
        let host = HostID()
        let heads = SessionHeads()
        heads.put(ScopedSessionID(hostId: host, sessionId: "s"), try await heldHead())
        let done = snapshotJSON(cursor: 10, state: "completed", items: [itemJSON("a1"), itemJSON("a2")])
        let completed = #"{"id":10,"at":3,"sessionId":"s","runId":"run_1","type":"turn.completed","resultText":"ok"}"#
        let delta = #"{"reset":false,"events":[\#(itemEvent(8, "a2")),\#(completed)],"cursor":10}"#
        let api = HeadAPI(snapshot: done, delta: delta)

        let engine = SessionSyncEngine(api: api, sessionId: "s", cache: cache(host), heads: heads)
        await engine.open()
        await engine.awaitPendingWork()

        #expect(await api.recorded() == ["delta(7)", "session"])
        let fresh = await freshLoad(HeadAPI(snapshot: done))
        #expect(engine.turns == fresh.turns)
        #expect(engine.turns.first?.state == .completed)
    }

    @Test func aResetLoadsAfresh() async throws {
        let host = HostID()
        let heads = SessionHeads()
        heads.put(ScopedSessionID(hostId: host, sessionId: "s"), try await heldHead())
        let moved = snapshotJSON(cursor: 400, state: "completed", items: [itemJSON("z9")])
        let api = HeadAPI(snapshot: moved)

        let engine = SessionSyncEngine(api: api, sessionId: "s", cache: cache(host), heads: heads)
        await engine.open()
        await engine.awaitPendingWork()

        #expect(await api.recorded() == ["delta(7)", "session", "events(400)"])
        let fresh = await freshLoad(HeadAPI(snapshot: moved))
        #expect(engine.turns == fresh.turns)
        #expect(engine.turns.first?.items.map(\.id) == ["z9"])
    }

    @Test func aDiskHeadReconcilesFromItsOwnCursor() async throws {
        let host = HostID()
        let disk = cache(host)
        disk.writeSession("s", Data(held.utf8))
        let delta = #"{"reset":false,"events":[\#(itemEvent(8, "a2"))],"cursor":8}"#
        let api = HeadAPI(snapshot: held, delta: delta)

        let engine = SessionSyncEngine(api: api, sessionId: "s", cache: disk, heads: SessionHeads())
        await engine.open()
        await engine.awaitPendingWork()

        #expect(await api.recorded() == ["delta(7)"])
        #expect(engine.turns.first?.items.map(\.id) == ["a1", "a2"])
    }

    @Test func leavingASessionKeepsItsHeadInMemoryAndOnDisk() async throws {
        let host = HostID()
        let heads = SessionHeads()
        let disk = cache(host)
        let engine = SessionSyncEngine(api: HeadAPI(snapshot: held), sessionId: "s", cache: disk, heads: heads)
        await engine.refresh()
        await engine.awaitPendingWork()
        #expect(disk.readSession("s") == nil)

        engine.stop()
        await engine.awaitPendingWork()

        #expect(heads.head(ScopedSessionID(hostId: host, sessionId: "s"))?.cursor == 7)
        #expect(disk.readSession("s") != nil)
    }

    @Test func memoryEvictsTheLeastRecentlyUsedPastItsCap() async throws {
        let heads = SessionHeads()
        let head = try await heldHead()
        let host = HostID()
        let keys = (0...SessionHeads.held).map { ScopedSessionID(hostId: host, sessionId: "s\($0)") }
        for key in keys.dropLast() { heads.put(key, head) }
        _ = heads.head(keys[0])
        heads.put(keys.last!, head)

        #expect(heads.keys.count == SessionHeads.held)
        #expect(heads.head(keys[0]) != nil)
        #expect(heads.head(keys[1]) == nil)
    }

    @Test func aHeadOverTheByteCapIsNotHeld() async throws {
        let heads = SessionHeads()
        var head = try await heldHead()
        head.snapshotData = Data(count: SessionHeads.headBytes + 1)
        let key = ScopedSessionID(hostId: HostID(), sessionId: "s")
        heads.put(key, head)
        #expect(heads.head(key) == nil)
    }

    @Test func headsAreScopedToTheirHost() async throws {
        let heads = SessionHeads()
        let mine = HostID(), other = HostID()
        heads.put(ScopedSessionID(hostId: other, sessionId: "s"), try await heldHead())

        let engine = SessionSyncEngine(api: HeadAPI(snapshot: held), sessionId: "s", cache: cache(mine), heads: heads)
        #expect(engine.session == nil)

        heads.put(ScopedSessionID(hostId: mine, sessionId: "s"), try await heldHead())
        heads.forget(host: other)
        #expect(heads.keys == [ScopedSessionID(hostId: mine, sessionId: "s")])
    }

    @Test func prefetchIsBoundedAndNewestFirst() async {
        let heads = SessionHeads()
        let api = HeadAPI(snapshot: held)
        let host = HostID()
        let keys = (0..<12).map { ScopedSessionID(hostId: host, sessionId: "s\($0)") }
        for key in keys { heads.warm(key, api: { api }) }
        await heads.awaitWarming()

        #expect(heads.keys.count == SessionHeads.warming + SessionHeads.queued)
        #expect(heads.head(keys[2]) == nil)
        #expect(heads.head(keys[3]) == nil)
        #expect(heads.head(keys[11]) != nil)
    }
}
