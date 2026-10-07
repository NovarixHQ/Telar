import SwiftUI

func splitPath(_ path: String) -> (name: String, folder: String?) {
    guard let slash = path.lastIndex(of: "/") else { return (path, nil) }
    return (String(path[path.index(after: slash)...]), String(path[..<slash]))
}

func diffStatBlocks(added: Int, removed: Int, of total: Int = 5) -> (added: Int, removed: Int) {
    let lines = added + removed
    guard lines > 0 else { return (0, 0) }
    var green = Int((Double(added) / Double(lines) * Double(total)).rounded())
    if added > 0 { green = max(green, 1) }
    if removed > 0 { green = min(green, total - 1) }
    return (green, total - green)
}

struct DiffStatusBadge: View {
    let status: String

    var body: some View {
        Text(letter)
            .font(.system(Theme.captionTiny, design: .monospaced, weight: .bold))
            .foregroundStyle(color)
            .scaledSquare(18)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            .accessibilityLabel(status)
    }

    private var letter: String {
        switch status {
        case "added": "A"
        case "deleted": "D"
        case "renamed": "R"
        case "untracked": "U"
        default: "M"
        }
    }

    private var color: Color {
        switch status {
        case "added", "untracked": Theme.statusEmerald
        case "deleted": Theme.statusRed
        case "renamed": Theme.statusSky
        default: Theme.statusAmber
        }
    }
}

struct DiffCounts: View {
    let added: Int?
    let removed: Int?

    var body: some View {
        HStack(spacing: 6) {
            if let added { Text("+\(added)").foregroundStyle(Theme.statusEmerald) }
            if let removed { Text("−\(removed)").foregroundStyle(Theme.statusRed) }
        }
        .font(.system(Theme.footnote, weight: .medium))
        .tabularNumbers()
    }
}

struct DiffStatBar: View {
    let added: Int
    let removed: Int

    var body: some View {
        let blocks = diffStatBlocks(added: added, removed: removed)
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(index < blocks.added ? Theme.statusEmerald
                          : index < blocks.added + blocks.removed ? Theme.statusRed : Theme.border)
                    .frame(width: 7, height: 7)
            }
        }
        .accessibilityHidden(true)
    }
}

struct DiffSummary: View {
    let diff: SessionDiff
    let notes: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let branch = diff.branch {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.system(Theme.footnote, weight: .semibold))
                        .foregroundStyle(Theme.textMuted)
                    Text(branch)
                        .font(.system(Theme.subhead, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Branch \(branch)")
            }
            HStack(spacing: 8) {
                Text(diff.files.count == 1 ? "1 file" : "\(diff.files.count) files")
                    .font(.system(Theme.footnote))
                    .foregroundStyle(Theme.textMuted)
                DiffCounts(added: diff.linesAdded, removed: diff.linesRemoved)
                Spacer(minLength: 0)
                DiffStatBar(added: diff.linesAdded, removed: diff.linesRemoved)
            }
            .accessibilityElement(children: .combine)
            ForEach(notes, id: \.self) { DiffCallout(text: $0) }
        }
    }
}

struct DiffCallout: View {
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(Theme.caption))
            Text(text)
                .font(.system(Theme.footnote))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Theme.statusAmber)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.statusAmber.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
    }
}

struct DiffFileRow: View {
    let file: GitFileChange
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let parts = splitPath(file.path)
        HStack(alignment: .center, spacing: 10) {
            DiffStatusBadge(status: file.status)
            VStack(alignment: .leading, spacing: 1) {
                Text(parts.name)
                    .font(.system(Theme.subhead, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                    .truncationMode(.middle)
                if let detail = detail(folder: parts.folder) {
                    Text(detail)
                        .font(.system(Theme.caption))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            Spacer(minLength: 8)
            if file.binary == true {
                Text("binary")
                    .font(.system(Theme.caption))
                    .foregroundStyle(Theme.textMuted)
            } else {
                DiffCounts(added: file.linesAdded.flatMap { $0 > 0 ? $0 : nil },
                           removed: file.linesRemoved.flatMap { $0 > 0 ? $0 : nil })
            }
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }

    private func detail(folder: String?) -> String? {
        if let from = file.renamedFrom { return "from \(from)" }
        return folder
    }
}

struct DiffCommitRow: View {
    let commit: GitCommitEntry

    var body: some View {
        HStack(spacing: 10) {
            Text(commit.shortSha)
                .font(Theme.mono)
                .foregroundStyle(Theme.textMuted)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Theme.fill, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            Text(commit.subject)
                .font(.system(Theme.footnote))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            Spacer(minLength: 4)
            Text(relativeTime(commit.at))
                .font(.system(Theme.caption))
                .foregroundStyle(Theme.textMuted)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
