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

    @Test func aRevokedTokenIsClearedTheNextTimeThatHostsApiIsUsed() async {
        PairingStubURLProtocol.handler = { _ in
            (401, Data(#"{"error":{"code":"cockpit_unauthorized","message":"Pair this device with the Telar cockpit to use it."}}"#.utf8))
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PairingStubURLProtocol.self]
        let defaults = UserDefaults(suiteName: "telar.test.appsettings.\(UUID().uuidString)")!
        let settings = AppSettings(defaults: defaults, vault: MemoryVault())
        let id = settings.upsert(baseURLString: "http://revoked.test:3000", token: "tlr_revoked")
        let api = HTTPEngineAPI(
            baseURL: URL(string: "http://revoked.test:3000")!,
            deviceToken: settings.token(for: id),
            session: URLSession(configuration: config),
            onUnauthorized: { [weak settings] in await settings?.clearRevokedToken(id) }
        )

        _ = try? await api.health()

        #expect(settings.token(for: id) == nil)
    }
}
