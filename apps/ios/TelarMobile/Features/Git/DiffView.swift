import SwiftUI

struct DiffView: View {
    let api: any EngineAPI
    let sessionId: EngineID

    @State private var diff: SessionDiff?
    @State private var error: String?

    @State private var expanded: Set<String> = []

    @Environment(\.panel) private var panel

    var body: some View {
        Group {
            if let diff {
                List {
                    DiffSummary(diff: diff, notes: notes(diff))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 14, leading: 16, bottom: 10, trailing: 16))
                    ForEach(diff.files) { file in
                        NavigationLink(value: file) {
                            DiffFileRow(file: file)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(Theme.borderSubtle)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                        .contextMenu { fileMenu(file) }
                        if expanded.contains(file.path) {
                            InlinePatch(api: api, sessionId: sessionId, file: file)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
                        }
                    }
                    if !diff.commits.isEmpty {
                        Section {
                            ForEach(diff.commits) { commit in
                                DiffCommitRow(commit: commit)
                                    .listRowBackground(Color.clear)
                                    .listRowSeparatorTint(Theme.borderSubtle)
                                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                            }
                        } header: {
                            HStack(spacing: 6) {
                                Text("Commits")
                                Text("\(diff.commits.count)").monospacedDigit()
                            }
                            .bandCaption()
                            .padding(.top, 12)
                        }
                    }
                    if diff.files.isEmpty && diff.commits.isEmpty && diff.filesIncomplete == nil {
                        Label("No changes yet.", systemImage: "checkmark.circle")
                            .font(.system(Theme.subhead))
                            .foregroundStyle(Theme.textMuted)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            } else if let error {
                ContentUnavailableView("Could not load changes", systemImage: "xmark.circle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .background(Theme.canvas)
        .navigationTitle("Changes")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: GitFileChange.self) { file in
            PatchView(api: api, sessionId: sessionId, file: file)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            diff = try await api.sessionDiff(sessionId)
            error = nil
        } catch {
            self.error = (error as? EngineAPIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func notes(_ diff: SessionDiff) -> [String] {
        var sentences: [String] = []
        if diff.base == nil { sentences.append("No recorded base — committed work is not included.") }
        if diff.files.isEmpty && diff.commits.isEmpty && diff.filesIncomplete != nil {
            sentences.append("Nothing was listed — which is not the same as nothing having changed.")
        }
        if let files = diff.filesIncomplete {
            sentences.append(
                files == "timeout"
                    ? "git did not answer in time — this list may be missing files and the counts may be low. Pull to ask again."
                    : "git could not read this checkout's changes — this list may be missing files and the counts may be low."
            )
        }
        if let commits = diff.commitsIncomplete {
            sentences.append(
                commits == "timeout"
                    ? "git did not answer in time for this session's commits — work it has already committed may not be listed. Pull to ask again."
                    : "git could not read this session's commits — work it has already committed may not be listed."
            )
        }
        if diff.baseUnverified != nil {
            sentences.append("Nothing confirmed the starting point — it is the one recorded when this checkout was cut.")
        }
        if diff.truncated { sentences.append("File list truncated.") }
        return sentences
    }

    @ViewBuilder private func fileMenu(_ file: GitFileChange) -> some View {
        if let panel, file.status != "deleted" {
            Button("Open in Editor", systemImage: "sidebar.trailing") { panel.openFile(file.path) }
            Divider()
        }
        Button("Copy path", systemImage: "doc.on.doc") { UIPasteboard.general.string = file.path }
        if let panel {
            Button("Insert as reference", systemImage: "text.badge.plus") {
                panel.insertReference(ComposerReference.file(file.path))
            }
        }
        Divider()
        let open = expanded.contains(file.path)
        Button(open ? "Collapse patch" : "Expand patch", systemImage: open ? "chevron.up" : "chevron.down") {
            if open { expanded.remove(file.path) } else { expanded.insert(file.path) }
        }
    }
}

struct PatchView: View {
    let api: any EngineAPI
    let sessionId: EngineID
    let file: GitFileChange

    @State private var patch: FilePatch?
    @State private var error: String?

    var body: some View {
        Group {
            if let patch {
                if let incomplete = patch.incomplete {
                    ContentUnavailableView(
                        "git did not read this patch",
                        systemImage: "exclamationmark.triangle",
                        description: Text(incomplete == "timeout" ? "It did not answer in time. Open it again." : "It could not produce a diff for this file.")
                    )
                } else if patch.binary {
                    ContentUnavailableView("Binary file", systemImage: "doc", description: Text("No text diff to show."))
                } else if patch.patch.isEmpty {
                    ContentUnavailableView("No textual difference", systemImage: "equal", description: Text("git compared this file and found nothing changed."))
                } else {
                    ScrollView([.vertical, .horizontal]) {
                        PatchLines(patch: patch.patch).padding(12)
                    }
                    .background(Theme.codeBackground)
                }
            } else if let error {
                ContentUnavailableView("Could not load the patch", systemImage: "xmark.circle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .background(Theme.canvas)
        .navigationTitle((file.path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                patch = try await api.filePatch(sessionId, path: file.path, untracked: file.status == "untracked")
            } catch {
                self.error = (error as? EngineAPIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

struct PatchLines: View {
    let patch: String

    var limit: Int?

    var body: some View {
        let all = patch.split(separator: "\n", omittingEmptySubsequences: false)
        let shown = limit.map { Array(all.prefix($0)) } ?? Array(all)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.offset) { _, line in
                Text(String(line))
                    .font(.system(Theme.caption, design: .monospaced))
                    .foregroundStyle(patchLineColor(line))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(patchLineBackground(line))
            }
            if shown.count < all.count {
                Text("\(all.count - shown.count) more lines — tap the row to read the whole patch.")
                    .font(.system(Theme.caption))
                    .foregroundStyle(Theme.textMuted)
                    .padding(.top, 4)
            }
        }
    }
}

private struct InlinePatch: View {
    let api: any EngineAPI
    let sessionId: EngineID
    let file: GitFileChange

    @State private var patch: FilePatch?
    @State private var error: String?

    private static let lineCap = 60

    var body: some View {
        Group {
            if let patch {
                if let incomplete = patch.incomplete {
                    Text(incomplete == "timeout" ? "git did not answer in time — try again." : "git could not produce a diff for this file.")
                        .font(.system(Theme.caption))
                        .foregroundStyle(Theme.statusAmber)
                } else if patch.binary {
                    Text("Binary file — no text diff to show.")
                        .font(.system(Theme.caption))
                        .foregroundStyle(Theme.textMuted)
                } else if patch.patch.isEmpty {
                    Text("No textual difference.")
                        .font(.system(Theme.caption))
                        .foregroundStyle(Theme.textMuted)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        PatchLines(patch: patch.patch, limit: Self.lineCap).padding(10)
                    }
                    .background(Theme.codeBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            } else if let error {
                Text(error).font(.system(Theme.caption)).foregroundStyle(Theme.statusRed)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task {
            do {
                patch = try await api.filePatch(sessionId, path: file.path, untracked: file.status == "untracked")
            } catch {
                self.error = describe(error)
            }
        }
    }
}

private func patchLineColor(_ line: Substring) -> Color {
    if line.hasPrefix("+") && !line.hasPrefix("+++") { return Theme.statusEmerald }
    if line.hasPrefix("-") && !line.hasPrefix("---") { return Theme.statusRed }
    if line.hasPrefix("@@") { return Theme.statusSky }
    return Theme.textMuted
}

private func patchLineBackground(_ line: Substring) -> Color {
    if line.hasPrefix("+") && !line.hasPrefix("+++") { return Theme.statusEmerald.opacity(0.08) }
    if line.hasPrefix("-") && !line.hasPrefix("---") { return Theme.statusRed.opacity(0.08) }
    return .clear
}
