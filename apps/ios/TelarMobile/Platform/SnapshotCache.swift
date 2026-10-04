import Foundation

struct SnapshotCache: Sendable {
    let root: URL

    static let sessionsOnDisk = 30
    static let sessionBytes = 1_000_000
    static let sessionsTotalBytes = 20_000_000

    static let `default`: SnapshotCache = {
        let files = FileManager.default
        try? files.removeItem(at: files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "snapshots"))
        return SnapshotCache(root: files.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "snapshots"))
    }()

    struct Entry: Equatable {
        var data: Data

        var savedAt: Timestamp
    }

    func readSession(host: HostID, id: EngineID) -> Entry? {
        read(sessionFile(host, id))
    }

    func writeSession(host: HostID, id: EngineID, data: Data) {
        guard data.count <= Self.sessionBytes else { return dropSession(host: host, id: id) }
        write(sessionFile(host, id), data)
        prune()
    }

    func dropSessions(host: HostID) {
        try? FileManager.default.removeItem(at: sessionsDir(host))
    }

    func dropSession(host: HostID, id: EngineID) {
        try? FileManager.default.removeItem(at: sessionFile(host, id))
    }

    func readInbox(host: HostID) -> Entry? {
        read(hostDir(host).appending(path: "inbox.json"))
    }

    func writeInbox(host: HostID, data: Data) {
        write(hostDir(host).appending(path: "inbox.json"), data)
    }

    func readShelf(host: HostID) -> Entry? {
        read(hostDir(host).appending(path: "shelf.json"))
    }

    func writeShelf(host: HostID, data: Data) {
        write(hostDir(host).appending(path: "shelf.json"), data)
    }

    func dropHost(_ host: HostID) {
        try? FileManager.default.removeItem(at: hostDir(host))
    }

    private func hostDir(_ host: HostID) -> URL { root.appending(path: host.uuidString) }
    private func sessionsDir(_ host: HostID) -> URL { hostDir(host).appending(path: "sessions") }
    private func sessionFile(_ host: HostID, _ id: EngineID) -> URL {
        let name = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
        return sessionsDir(host).appending(path: "\(name).json")
    }

    private func read(_ file: URL) -> Entry? {
        guard let data = try? Data(contentsOf: file),
              let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              let modified = attributes[.modificationDate] as? Date
        else { return nil }
        return Entry(data: data, savedAt: Timestamp(modified.timeIntervalSince1970 * 1000))
    }

    private func write(_ file: URL, _ data: Data) {
        let dir = file.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var rootURL = root
            try? rootURL.setResourceValues(values)

            try data.write(to: file, options: .atomic)
        } catch {
        }
    }

    private func prune() {
        let files = FileManager.default
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        let hosts = (try? files.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        let newest = hosts
            .flatMap { (try? files.contentsOfDirectory(at: $0.appending(path: "sessions"), includingPropertiesForKeys: keys)) ?? [] }
            .map { file in (file, (try? file.resourceValues(forKeys: Set(keys))) ?? URLResourceValues()) }
            .sorted { ($0.1.contentModificationDate ?? .distantPast) > ($1.1.contentModificationDate ?? .distantPast) }
        var total = 0
        for (rank, (file, values)) in newest.enumerated() {
            total += values.fileSize ?? 0
            if rank >= Self.sessionsOnDisk || total > Self.sessionsTotalBytes { try? files.removeItem(at: file) }
        }
    }
}

struct HostSnapshotCache: Sendable {
    let cache: SnapshotCache
    let hostId: HostID

    func readSession(_ id: EngineID) -> SnapshotCache.Entry? { cache.readSession(host: hostId, id: id) }
    func writeSession(_ id: EngineID, _ data: Data) { cache.writeSession(host: hostId, id: id, data: data) }
    func dropSession(_ id: EngineID) { cache.dropSession(host: hostId, id: id) }
    func dropSessions() { cache.dropSessions(host: hostId) }
    func readInbox() -> SnapshotCache.Entry? { cache.readInbox(host: hostId) }
    func writeInbox(_ data: Data) { cache.writeInbox(host: hostId, data: data) }
    func readShelf() -> SnapshotCache.Entry? { cache.readShelf(host: hostId) }
    func writeShelf(_ data: Data) { cache.writeShelf(host: hostId, data: data) }
}

func recordedAtLabel(_ savedAt: Timestamp) -> String {
    Date(timeIntervalSince1970: TimeInterval(savedAt) / 1000).formatted(date: .omitted, time: .shortened)
}
