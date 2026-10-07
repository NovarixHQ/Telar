import Foundation
import Testing
@testable import TelarMobile

struct MJPEGPartsTests {
    private let first = Data([0xFF, 0xD8, 0x01, 0x02, 0xFF, 0xD9])
    private let second = Data([0xFF, 0xD8, 0x0D, 0x0A, 0x03, 0xFF, 0xD9])

    @Test func aPartWithALengthEndsOnItsLastByte() {
        var parts = MJPEGParts()
        #expect(parts.begin(expectedLength: Int64(first.count)) == nil)
        #expect(parts.append(first.prefix(3)) == nil)
        #expect(parts.append(first.suffix(3)) == first)
        #expect(parts.begin(expectedLength: Int64(second.count)) == nil)
        #expect(parts.append(second) == second)
    }

    @Test func aPartWithoutALengthEndsWhenTheNextBegins() {
        var parts = MJPEGParts()
        #expect(parts.begin(expectedLength: -1) == nil)
        #expect(parts.append(first) == nil)
        #expect(parts.begin(expectedLength: -1) == first)
        #expect(parts.append(second) == nil)
        #expect(parts.begin(expectedLength: Int64(first.count)) == second)
    }

    @Test func aPartCutShortIsDropped() {
        var parts = MJPEGParts()
        _ = parts.begin(expectedLength: 100)
        #expect(parts.append(first) == nil)
        #expect(parts.begin(expectedLength: -1) == nil)
    }
}
