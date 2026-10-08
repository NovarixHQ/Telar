import Foundation

struct PatchLine: Equatable {
    enum Kind { case hunk, context, added, removed, note }

    var kind: Kind
    var text: String
    var old: Int?
    var new: Int?
    var changed: [Range<Int>] = []
}

enum PatchModel {
    static func lines(_ patch: String) -> [PatchLine] {
        var lines: [PatchLine] = []
        var old = 0, new = 0
        var inHunk = false
        for raw in patch.split(separator: "\n", omittingEmptySubsequences: false) {
            if raw.hasPrefix("@@") {
                let starts = hunkStarts(raw)
                old = starts.old
                new = starts.new
                inHunk = true
                lines.append(PatchLine(kind: .hunk, text: String(raw)))
                continue
            }
            guard inHunk else { continue }
            let body = String(raw.dropFirst())
            switch raw.first {
            case "+":
                lines.append(PatchLine(kind: .added, text: body, new: new))
                new += 1
            case "-":
                lines.append(PatchLine(kind: .removed, text: body, old: old))
                old += 1
            case " ":
                lines.append(PatchLine(kind: .context, text: body, old: old, new: new))
                old += 1
                new += 1
            case "\\":
                lines.append(PatchLine(kind: .note, text: String(raw)))
            default:
                if raw.isEmpty { continue }
                inHunk = false
            }
        }
        markWordChanges(&lines)
        return lines
    }

    private static func hunkStarts(_ header: Substring) -> (old: Int, new: Int) {
        func start(after marker: Character) -> Int {
            guard let at = header.firstIndex(of: marker) else { return 0 }
            let digits = header[header.index(after: at)...].prefix { $0.isNumber }
            return Int(digits) ?? 0
        }
        return (start(after: "-"), start(after: "+"))
    }

    private static func markWordChanges(_ lines: inout [PatchLine]) {
        var index = 0
        while index < lines.count {
            guard lines[index].kind == .removed else { index += 1; continue }
            let removedStart = index
            while index < lines.count, lines[index].kind == .removed { index += 1 }
            let addedStart = index
            while index < lines.count, lines[index].kind == .added { index += 1 }
            let pairs = min(addedStart - removedStart, index - addedStart)
            for offset in 0..<pairs {
                let before = removedStart + offset, after = addedStart + offset
                guard let ranges = WordDiff.changes(lines[before].text, lines[after].text) else { continue }
                lines[before].changed = ranges.old
                lines[after].changed = ranges.new
            }
        }
    }

    static func sides(_ lines: [PatchLine]) -> (old: String, new: String) {
        var old: [String] = [], new: [String] = []
        for line in lines {
            switch line.kind {
            case .removed: old.append(line.text)
            case .added: new.append(line.text)
            case .context:
                old.append(line.text)
                new.append(line.text)
            case .hunk, .note: break
            }
        }
        return (old.joined(separator: "\n"), new.joined(separator: "\n"))
    }

    static func revision(_ turns: [JournalTurn]) -> Int {
        func touches(_ item: JournalItem) -> Bool {
            guard item.status == .completed else { return false }
            switch item.detail {
            case .fileChange, .commandExecution: return true
            default: return false
            }
        }
        return turns.reduce(0) { total, turn in
            total + turn.items.filter(touches).count + turn.tasks.reduce(0) { $0 + $1.items.filter(touches).count }
        }
    }
}

enum WordDiff {
    static let maxLineLength = 600

    static func changes(_ old: String, _ new: String) -> (old: [Range<Int>], new: [Range<Int>])? {
        guard old != new, old.count <= maxLineLength, new.count <= maxLineLength else { return nil }
        let a = tokens(old), b = tokens(new)
        guard !a.isEmpty, !b.isEmpty else { return nil }
        let common = lcs(a.map(\.text), b.map(\.text))
        let shared = common.a.reduce(0) { $0 + a[$1].range.count }
        guard Double(shared) / Double(max(old.count, new.count)) >= 0.3 else { return nil }
        return (merge(a, keeping: common.a), merge(b, keeping: common.b))
    }

    struct Token: Equatable {
        var text: Substring
        var range: Range<Int>
    }

    static func tokens(_ line: String) -> [Token] {
        var tokens: [Token] = []
        var offset = 0
        var index = line.startIndex
        while index < line.endIndex {
            let first = line[index]
            var end = line.index(after: index)
            if isWord(first) {
                while end < line.endIndex, isWord(line[end]) { end = line.index(after: end) }
            } else if first.isWhitespace {
                while end < line.endIndex, line[end].isWhitespace { end = line.index(after: end) }
            }
            let text = line[index..<end]
            tokens.append(Token(text: text, range: offset..<(offset + text.count)))
            offset += text.count
            index = end
        }
        return tokens
    }

    private static func isWord(_ character: Character) -> Bool {
        character.isLetter || character.isNumber || character == "_"
    }

    private static func lcs(_ a: [Substring], _ b: [Substring]) -> (a: Set<Int>, b: Set<Int>) {
        let n = a.count, m = b.count
        var table = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        for i in stride(from: n - 1, through: 0, by: -1) {
            for j in stride(from: m - 1, through: 0, by: -1) {
                table[i][j] = a[i] == b[j] ? table[i + 1][j + 1] + 1 : max(table[i + 1][j], table[i][j + 1])
            }
        }
        var keptA = Set<Int>(), keptB = Set<Int>()
        var i = 0, j = 0
        while i < n, j < m {
            if a[i] == b[j] {
                keptA.insert(i)
                keptB.insert(j)
                i += 1
                j += 1
            } else if table[i + 1][j] >= table[i][j + 1] {
                i += 1
            } else {
                j += 1
            }
        }
        return (keptA, keptB)
    }

    private static func merge(_ tokens: [Token], keeping kept: Set<Int>) -> [Range<Int>] {
        var ranges: [Range<Int>] = []
        for (index, token) in tokens.enumerated() where !kept.contains(index) {
            if let last = ranges.last, last.upperBound == token.range.lowerBound {
                ranges[ranges.count - 1] = last.lowerBound..<token.range.upperBound
            } else {
                ranges.append(token.range)
            }
        }
        return ranges
    }
}
