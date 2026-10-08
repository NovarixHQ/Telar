import Foundation

@MainActor final class OpenSession {
    struct Key: Hashable {
        var ref: ScopedSessionID?
        var fingerprint: String?
        var active: Bool
    }

    private var held: (key: String, store: SessionStore)?

    func store(_ ref: ScopedSessionID, key fingerprint: String, api: HTTPEngineAPI, cache: HostSnapshotCache?) -> SessionStore {
        let key = "\(fingerprint):\(ref.hostId):\(ref.sessionId)"
        if let held, held.key == key { return held.store }
        let made = SessionStore(api: api, sessionId: ref.sessionId, hostId: ref.hostId, cache: cache, heads: cache == nil ? nil : .shared)
        held = (key, made)
        return made
    }
}
