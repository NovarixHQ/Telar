import Foundation
import Testing
@testable import TelarMobile

@Suite struct SnapshotCacheTests {
    private func fresh() -> SnapshotCache {
        let root = FileManager.default.temporaryDirectory.appending(path: "telar-snapshots-\(UUID().uuidString)")
        return SnapshotCache(root: root)
    }

    @Test func roundTripsBytesPerHostAndSession() {
        let cache = fresh()
        let a = HostID(), b = HostID()
        cache.writeSession(host: a, id: "s1", data: Data("A".utf8))
        cache.writeSession(host: b, id: "s1", data: Data("B".utf8))
        #expect(cache.readSession(host: a, id: "s1")?.data == Data("A".utf8))
        #expect(cache.readSession(host: b, id: "s1")?.data == Data("B".utf8))
        #expect(cache.readSession(host: a, id: "missing") == nil)
        #expect(cache.readSession(host: a, id: "s1")!.savedAt > 0)
    }

    @Test func inboxIsPerHostAndForgettingAMacForgetsItsBytes() {
        let cache = fresh()
        let host = HostID()
        cache.writeInbox(host: host, data: Data("inbox".utf8))
        cache.writeSession(host: host, id: "s1", data: Data("x".utf8))
        #expect(cache.readInbox(host: host)?.data == Data("inbox".utf8))
        cache.dropHost(host)
        #expect(cache.readInbox(host: host) == nil)
        #expect(cache.readSession(host: host, id: "s1") == nil)
    }

    @Test func aGoneSessionIsDropped() {
        let cache = fresh()
        let host = HostID()
        cache.writeSession(host: host, id: "s1", data: Data("x".utf8))
        cache.dropSession(host: host, id: "s1")
        #expect(cache.readSession(host: host, id: "s1") == nil)
    }

    private func write(_ cache: SnapshotCache, _ host: HostID, _ id: String, _ data: Data, age: Int) {
        cache.writeSession(host: host, id: id, data: data)
        let file = cache.root.appending(path: "\(host.uuidString)/sessions/\(id).json")
        try? FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: TimeInterval(age))], ofItemAtPath: file.path)
    }

    @Test func keepsOnlyTheNewestSessionsAcrossHosts() {
        let cache = fresh()
        let hosts = [HostID(), HostID()]
        for index in 0..<(SnapshotCache.sessionsOnDisk + 5) {
            write(cache, hosts[index % 2], "s\(index)", Data("\(index)".utf8), age: index)
        }
        #expect(cache.readSession(host: hosts[0], id: "s0") == nil)
        #expect(cache.readSession(host: hosts[0], id: "s4") == nil)
        #expect(cache.readSession(host: hosts[1], id: "s5") != nil)
        #expect(cache.readSession(host: hosts[0], id: "s\(SnapshotCache.sessionsOnDisk + 4)") != nil)
    }

    @Test func aHeadOverItsOwnCapIsNotKept() {
        let cache = fresh()
        let host = HostID()
        cache.writeSession(host: host, id: "s1", data: Data("small".utf8))
        cache.writeSession(host: host, id: "s1", data: Data(count: SnapshotCache.sessionBytes + 1))
        #expect(cache.readSession(host: host, id: "s1") == nil)
    }

    @Test func theOldestGoPastTheTotalBytes() {
        let cache = fresh()
        let host = HostID()
        let count = SnapshotCache.sessionsTotalBytes / SnapshotCache.sessionBytes + 2
        for index in 0..<count {
            write(cache, host, "s\(index)", Data(count: SnapshotCache.sessionBytes), age: index)
        }
        #expect(cache.readSession(host: host, id: "s0") == nil)
        #expect(cache.readSession(host: host, id: "s1") == nil)
        #expect(cache.readSession(host: host, id: "s\(count - 1)") != nil)
    }

    @Test func forgettingAHostsSessionsKeepsItsInbox() {
        let cache = fresh()
        let host = HostID()
        cache.writeInbox(host: host, data: Data("inbox".utf8))
        cache.writeSession(host: host, id: "s1", data: Data("x".utf8))
        cache.dropSessions(host: host)
        #expect(cache.readSession(host: host, id: "s1") == nil)
        #expect(cache.readInbox(host: host) != nil)
    }

    @Test func recordedAtLabelIsAClockTime() {
        let label = recordedAtLabel(Timestamp(Date().timeIntervalSince1970 * 1000))
        #expect(!label.isEmpty && label.count < 12)
    }
}
