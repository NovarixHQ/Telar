import Foundation

/// Splits a `multipart/x-mixed-replace` body into JPEG frames, using each part's Content-Length when it has one.
struct MJPEGParser {
    private let marker: Data
    private var buffer = Data()
    private static let headerEnd = Data("\r\n\r\n".utf8)
    private static let maxBuffer = 16 << 20

    init(contentType: String? = nil) {
        marker = Data("--\(Self.boundary(contentType) ?? "frame")".utf8)
    }

    static func boundary(_ contentType: String?) -> String? {
        guard let contentType else { return nil }
        for parameter in contentType.split(separator: ";") {
            let pair = parameter.trimmingCharacters(in: .whitespaces)
            guard pair.lowercased().hasPrefix("boundary=") else { continue }
            let value = pair.dropFirst("boundary=".count).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            return value.hasPrefix("--") ? String(value.dropFirst(2)) : value
        }
        return nil
    }

    mutating func append(_ chunk: Data) -> [Data] {
        buffer.append(chunk)
        var frames: [Data] = []
        while let frame = nextFrame() { frames.append(frame) }
        if buffer.count > Self.maxBuffer { buffer.removeAll() }
        return frames
    }

    private mutating func nextFrame() -> Data? {
        guard let start = buffer.range(of: marker) else {
            if buffer.count > marker.count { buffer = Data(buffer.suffix(marker.count)) }
            return nil
        }
        guard let header = buffer.range(of: Self.headerEnd, in: start.upperBound..<buffer.endIndex) else { return nil }
        let bodyStart = header.upperBound
        let end: Int
        let resume: Int
        if let length = Self.contentLength(buffer[start.upperBound..<header.lowerBound]) {
            guard buffer.endIndex - bodyStart >= length else { return nil }
            end = bodyStart + length
            resume = end
        } else {
            guard let next = buffer.range(of: marker, in: bodyStart..<buffer.endIndex) else { return nil }
            resume = next.lowerBound
            var trimmed = next.lowerBound
            while trimmed > bodyStart, [0x0D, 0x0A].contains(buffer[trimmed - 1]) { trimmed -= 1 }
            end = trimmed
        }
        let frame = Data(buffer[bodyStart..<end])
        buffer = Data(buffer[resume...])
        return frame.isEmpty ? nextFrame() : frame
    }

    private static func contentLength(_ headers: Data) -> Int? {
        for line in String(decoding: headers, as: UTF8.self).split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" else { continue }
            return Int(parts[1].trimmingCharacters(in: .whitespaces))
        }
        return nil
    }
}
