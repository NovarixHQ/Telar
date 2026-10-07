import Foundation

extension HostMigration {
    @discardableResult
    static func run(defaults: UserDefaults, vault: any TokenVault, now: Date = Date()) -> Bool {
        guard defaults.data(forKey: hostsKey) == nil else { return false }
        let legacyToken = KeychainStore.readLegacySingle()
        guard let plan = plan(
            legacyBaseURL: defaults.string(forKey: legacyBaseURLKey),
            existingKeys: Array(defaults.dictionaryRepresentation().keys),
            now: now, id: HostID()
        ), let host = plan.host else {
            persist(HostBook(), defaults: defaults)
            return false
        }
        if let legacyToken {
            vault.write(legacyToken, account: tokenAccount(host.id))
            KeychainStore.deleteLegacySingle()
        }
        for rename in plan.pendingSendRenames {
            if let value = defaults.data(forKey: rename.old) {
                defaults.set(value, forKey: rename.new)
            }
            defaults.removeObject(forKey: rename.old)
        }
        persist(HostBook(hosts: [host]), defaults: defaults)
        return true
    }
}
