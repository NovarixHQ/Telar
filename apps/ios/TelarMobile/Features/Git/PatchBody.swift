import SwiftUI

struct PatchBody: View {
    let api: any EngineAPI
    let sessionId: EngineID
    let file: GitFileChange
    let generation: Int

    @State private var lines: [PatchLine]?
    @State private var rendered: [AttributedString] = []
    @State private var note: String?
    @State private var error: String?
    @State private var showAll = false
    @Environment(\.colorScheme) private var scheme

    private static let lineCap = 400

    var body: some View {
        Group {
            if let lines, !lines.isEmpty {
                let shown = showAll ? lines.count : min(lines.count, Self.lineCap)
                VStack(alignment: .leading, spacing: 6) {
                    PatchRows(lines: Array(lines.prefix(shown)), rendered: Array(rendered.prefix(shown)))
                    if shown < lines.count {
                        Button("Show \(lines.count - shown) more lines") { showAll = true }
                            .buttonStyle(.borderless)
                            .font(.system(Theme.caption, weight: .medium))
                            .foregroundStyle(Theme.textMuted)
                    }
                }
            } else if let note {
                Text(note).font(.system(Theme.caption)).foregroundStyle(Theme.textMuted)
            } else if let error {
                Text(error).font(.system(Theme.caption)).foregroundStyle(Theme.statusRed)
            } else if lines != nil {
                Text("No textual difference.").font(.system(Theme.caption)).foregroundStyle(Theme.textMuted)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task(id: "\(generation):\(scheme == .dark)") { await load() }
    }

    private func load() async {
        if file.binary == true {
            note = "Binary file — no text diff to show."
            return
        }
        let patch: FilePatch
        do {
            patch = try await api.filePatch(sessionId, path: file.path, untracked: file.status == "untracked")
            error = nil
        } catch {
            if lines == nil { self.error = describe(error) }
            return
        }
        if let incomplete = patch.incomplete {
            note = incomplete == "timeout" ? "git did not answer in time — pull to try again." : "git could not produce a diff for this file."
            return
        }
        if patch.binary {
            note = "Binary file — no text diff to show."
            return
        }
        let text = patch.patch
        let parsed = await Task.detached(priority: .userInitiated) { PatchModel.lines(text) }.value
        guard !Task.isCancelled else { return }
        note = nil
        let plain = parsed.map { patchText($0, highlighted: nil) }
        if parsed != lines || rendered.count != parsed.count {
            lines = parsed
            rendered = plain
        }
        let language = CodeLanguage.named(file.path)
        let sides = PatchModel.sides(parsed)
        let dark = scheme == .dark
        let old = await CodeHighlighter.shared.highlightedLines(sides.old, language: language, dark: dark)
        let new = await CodeHighlighter.shared.highlightedLines(sides.new, language: language, dark: dark)
        guard !Task.isCancelled, old != nil || new != nil else { return }
        var oldIndex = 0, newIndex = 0
        rendered = parsed.map { line in
            var coloured: AttributedString?
            switch line.kind {
            case .removed:
                coloured = old?[safe: oldIndex]
                oldIndex += 1
            case .added:
                coloured = new?[safe: newIndex]
                newIndex += 1
            case .context:
                coloured = new?[safe: newIndex]
                oldIndex += 1
                newIndex += 1
            case .hunk, .note:
                break
            }
            return patchText(line, highlighted: coloured)
        }
    }
}

private struct PatchRows: View {
    let lines: [PatchLine]
    let rendered: [AttributedString]

    @ScaledMetric(relativeTo: .caption) private var rowHeight: CGFloat = 17
    @State private var viewport: CGFloat = 0

    var body: some View {
        let digits = String(lines.reduce(0) { max($0, $1.old ?? 0, $1.new ?? 0) }).count
        let column = CGFloat(digits) * CodeLayout.advance(ofSize: UIFont.preferredFont(forTextStyle: .caption2).pointSize) + 6
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .trailing, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    HStack(spacing: 0) {
                        number(line.old, width: column)
                        number(line.new, width: column)
                    }
                    .padding(.trailing, 4)
                    .frame(height: rowHeight)
                    .background(tint(line.kind))
                }
            }
            .overlay(alignment: .trailing) { Rectangle().fill(Theme.borderSubtle).frame(width: 1) }
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                        Text(rendered[safe: index] ?? AttributedString(line.text))
                            .font(.system(Theme.caption, design: .monospaced))
                            .lineLimit(1)
                            .fixedSize()
                            .padding(.horizontal, 6)
                            .frame(maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight, alignment: .leading)
                            .background(tint(line.kind))
                    }
                }
                .frame(minWidth: viewport, alignment: .leading)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewport = $0 }
        }
        .background(Theme.codeBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .textSelection(.enabled)
    }

    private func number(_ value: Int?, width: CGFloat) -> some View {
        Text(value.map(String.init) ?? "")
            .font(.system(Theme.captionTiny, design: .monospaced))
            .foregroundStyle(Theme.textMuted.opacity(0.8))
            .frame(width: width, alignment: .trailing)
    }

    private func tint(_ kind: PatchLine.Kind) -> Color {
        switch kind {
        case .added: Theme.statusEmerald.opacity(0.1)
        case .removed: Theme.statusRed.opacity(0.1)
        case .hunk: Theme.statusSky.opacity(0.06)
        case .context, .note: .clear
        }
    }
}

private func patchText(_ line: PatchLine, highlighted: AttributedString?) -> AttributedString {
    switch line.kind {
    case .hunk:
        var text = AttributedString(line.text)
        text.foregroundColor = Theme.statusSky
        return text
    case .note:
        var text = AttributedString(line.text)
        text.foregroundColor = Theme.textMuted
        return text
    case .context, .added, .removed:
        var text: AttributedString
        if let highlighted, String(highlighted.characters) == line.text {
            text = highlighted
        } else {
            text = AttributedString(line.text)
            text.foregroundColor = Theme.text
        }
        let mark = (line.kind == .added ? Theme.statusEmerald : Theme.statusRed).opacity(0.3)
        for range in line.changed where range.upperBound <= text.characters.count {
            let start = text.characters.index(text.startIndex, offsetBy: range.lowerBound)
            let end = text.characters.index(start, offsetBy: range.count)
            text[start..<end].swiftUI.backgroundColor = mark
        }
        return text
    }
}
