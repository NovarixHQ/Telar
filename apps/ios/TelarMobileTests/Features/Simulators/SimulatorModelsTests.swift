import Foundation
import Testing
@testable import TelarMobile

struct SimulatorModelsTests {
    private func decode(_ json: String) throws -> SimulatorSummary {
        try JSONDecoder().decode(SimulatorSummary.self, from: Data(json.utf8))
    }

    @Test func aPairedWatchDecodesAsAWatchThatCanBeViewed() throws {
        let watch = try decode(#"{"id":"W1","platform":"ios","name":"Pulso Watch","version":"watchOS 27.0","booted":true,"physical":false,"pairedWith":"P1"}"#)
        #expect(watch.isWatch)
        #expect(watch.icon == "applewatch")
        #expect(watch.viewable)
    }

    @Test func anIPhoneWithoutPairingStaysAnIPhone() throws {
        let phone = try decode(#"{"id":"P1","platform":"ios","name":"iPhone 16","version":"iOS 18.0","booted":false,"physical":false}"#)
        #expect(!phone.isWatch)
        #expect(phone.icon == "iphone")
    }
}
