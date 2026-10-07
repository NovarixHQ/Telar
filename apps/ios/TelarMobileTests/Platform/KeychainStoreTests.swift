import Foundation
import Testing
@testable import TelarMobile

struct KeychainStoreTests {
    @Test func aTokenSurvivesWhetherOrNotTheBuildWasSigned() {
        let account = "telar.test.keychain.\(UUID().uuidString)"
        defer { KeychainStore.delete(account: account) }

        KeychainStore.write("tlr_first", account: account)
        KeychainStore.write("tlr_second", account: account)
        #expect(KeychainStore.read(account: account) == "tlr_second")

        KeychainStore.delete(account: account)
        #expect(KeychainStore.read(account: account) == nil)
    }
}
