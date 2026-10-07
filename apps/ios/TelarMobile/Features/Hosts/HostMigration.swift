import Foundation

enum HostMigration {
    static let hostsKey = "telar.hosts"
    static let legacyBaseURLKey = "telar.baseURL"
    static let pendingSendPrefix = "telar.pendingSend."

    struct Plan: Equatable {
        var host: Host?
        var pendingSendRenames: [Rename]

        struct Rename: Equatable {
            var old: String
            var new: String
        }
    }

    static func plan(
        legacyBaseURL: String?, existingKeys: [String],
        now: Date, id: HostID
    ) -> Plan? {
        guard let legacyBaseURL, !legacyBaseURL.isEmpty else { return nil }
        let host = Host(
            id: id,
            name: HostBook.defaultName(for: legacyBaseURL),
            baseURLString: legacyBaseURL,
            addedAt: now,
            migratedFromSingle: true
        )
        let renames = existingKeys
            .filter { $0.hasPrefix(pendingSendPrefix) }
            .map { key in
                Plan.Rename(old: key, new: pendingSendPrefix + id.uuidString + "." + String(key.dropFirst(pendingSendPrefix.count)))
            }
        return Plan(host: host, pendingSendRenames: renames)
    }

    static func tokenAccount(_ id: HostID) -> String {
        "deviceToken.\(id.uuidString)"
    }

    static func persist(_ book: HostBook, defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(book.hosts) {
            defaults.set(data, forKey: hostsKey)
        }
    }

    static func load(defaults: UserDefaults) -> HostBook? {
        guard let data = defaults.data(forKey: hostsKey),
              let hosts = try? JSONDecoder().decode([Host].self, from: data)
        else { return nil }
        return HostBook(hosts: hosts)
    }
}
