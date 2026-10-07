import Foundation

struct MJPEGParts {
    private static let maxPart = 16 << 20
    private var part = Data()
    private var expected: Int64 = -1

    mutating func begin(expectedLength: Int64) -> Data? {
        let finished = expected < 0 && !part.isEmpty ? part : nil
        part = Data()
        expected = expectedLength
        return finished
    }

    mutating func append(_ chunk: Data) -> Data? {
        part.append(chunk)
        if expected > 0, part.count >= expected {
            let frame = part.prefix(Int(expected))
            part = Data()
            expected = -1
            return frame
        }
        if part.count > Self.maxPart { part.removeAll() }
        return nil
    }
}
