import Foundation
import Testing
@testable import TelarMobile

@MainActor
@Suite(.serialized) struct AppSettingsTests {
    @Test func clearRevokedTokenDropsOnlyThatHostsKeychainEntry() {
        let defaults = UserDefaults(suiteName: "telar.test.appsettings.\(UUID().uuidString)")!
        let vault = MemoryVault()
        let settings = AppSettings(defaults: defaults, vault: vault)
        let revoked = settings.upsert(baseURLString: "http://revoked.test:3000", token: "tlr_revoked")
        let other = settings.upsert(baseURLString: "http://other.test:3000", token: "tlr_other")

        settings.clearRevokedToken(revoked)

        #expect(settings.token(for: revoked) == nil)
        #expect(settings.token(for: other) == "tlr_other")
        #expect(settings.host(revoked) != nil, "the host stays listed, only its token is dropped")
    }

    @Test func clearRevokedTokenIsANoOpWhenAlreadyUnpaired() {
        let defaults = UserDefaults(suiteName: "telar.test.appsettings.\(UUID().uuidString)")!
        let settings = AppSettings(defaults: defaults, vault: MemoryVault())
        let open = settings.upsert(baseURLString: "http://open.test:3000", token: nil)

        settings.clearRevokedToken(open)

        #expect(settings.token(for: open) == nil)
    }
}
