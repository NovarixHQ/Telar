import Foundation
import Testing
@testable import TelarMobile

struct MJPEGParserTests {
    private let first = Data([0xFF, 0xD8, 0x01, 0x02, 0xFF, 0xD9])
    private let second = Data([0xFF, 0xD8, 0x0D, 0x0A, 0x03, 0xFF, 0xD9])

    private func part(_ jpeg: Data, boundary: String = "frame", length: Bool = true) -> Data {
        var header = "--\(boundary)\r\nContent-Type: image/jpeg\r\n"
        if length { header += "Content-Length: \(jpeg.count)\r\n" }
        return Data((header + "\r\n").utf8) + jpeg + Data("\r\n".utf8)
    }

    @Test func framesWithALengthComeOutWhole() {
        var parser = MJPEGParser(contentType: "multipart/x-mixed-replace; boundary=frame")
        #expect(parser.append(part(first) + part(second)) == [first, second])
    }

    @Test func aFrameSplitAcrossChunksWaitsForItsLastByte() {
        var parser = MJPEGParser()
        let body = part(first) + part(second)
        var frames: [Data] = []
        for byte in body { frames += parser.append(Data([byte])) }
        #expect(frames == [first, second])
    }

    @Test func framesWithoutALengthEndAtTheNextBoundary() {
        var parser = MJPEGParser(contentType: "multipart/x-mixed-replace;boundary=\"--myboundary\"")
        let frames = parser.append(Data("preamble".utf8) + part(first, boundary: "myboundary", length: false)
            + part(second, boundary: "myboundary", length: false) + Data("--myboundary".utf8))
        #expect(frames == [first, second])
    }

    @Test func theBoundaryComesFromTheContentType() {
        #expect(MJPEGParser.boundary("multipart/x-mixed-replace; boundary=frame") == "frame")
        #expect(MJPEGParser.boundary("multipart/x-mixed-replace; Boundary=\"abc\"") == "abc")
        #expect(MJPEGParser.boundary("image/jpeg") == nil)
        #expect(MJPEGParser.boundary(nil) == nil)
    }
}
