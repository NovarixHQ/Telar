import Foundation

struct TerminalScreen: Equatable {
    private(set) var text = ""
    private var state = State.text
    private var returned = false

    private enum State { case text, escape, csi, string, stringEscape, charset }

    static let limit = 48_000

    mutating func feed(_ chunk: String) {
        for scalar in chunk.unicodeScalars {
            switch state {
            case .text: put(scalar)
            case .escape:
                switch scalar {
                case "[": state = .csi
                case "]", "P", "_", "^", "X": state = .string
                case "(", ")", "*", "+": state = .charset
                default: state = .text
                }
            case .csi:
                if (0x40...0x7E).contains(scalar.value) { state = .text }
            case .string:
                if scalar == "\u{07}" { state = .text } else if scalar == "\u{1B}" { state = .stringEscape }
            case .stringEscape, .charset:
                state = .text
            }
        }
        if text.utf8.count > Self.limit { trim() }
    }

    private mutating func put(_ scalar: Unicode.Scalar) {
        switch scalar {
        case "\u{1B}": state = .escape
        case "\r": returned = true
        case "\n":
            returned = false
            text.append("\n")
        case "\u{08}":
            if let last = text.last, last != "\n" { text.removeLast() }
        case "\t":
            write(scalar)
        default:
            if scalar.value >= 0x20, scalar.value != 0x7F { write(scalar) }
        }
    }

    private mutating func write(_ scalar: Unicode.Scalar) {
        if returned {
            returned = false
            if let newline = text.lastIndex(of: "\n") {
                text.removeSubrange(text.index(after: newline)...)
            } else {
                text = ""
            }
        }
        text.unicodeScalars.append(scalar)
    }

    private mutating func trim() {
        let excess = text.utf8.count - Self.limit * 3 / 4
        let cut = text.utf8.index(text.utf8.startIndex, offsetBy: excess)
        guard let newline = text.utf8[cut...].firstIndex(of: UInt8(ascii: "\n")) else { return text = "" }
        text.removeSubrange(...newline)
    }
}
