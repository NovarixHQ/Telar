import SwiftUI

struct DiffView: View {
    let api: any EngineAPI
    let sessionId: EngineID
    let active: Bool
    let revision: Int

    @State private var diff: SessionDiff?
    @State private var error: String?
    @State private var collapsed: Set<String> = []
    @State private var generation = 0

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
                        let open = !collapsed.contains(file.path)
                        Button { toggle(file.path) } label: {
                            DiffFileRow(file: file, open: open)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(Theme.borderSubtle)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                        .contextMenu { fileMenu(file) }
                        if open {
                            PatchBody(api: api, sessionId: sessionId, file: file, generation: generation)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 10, trailing: 16))
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
        .task(id: "\(revision):\(active)") {
            if diff != nil {
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled else { return }
            }
            await load()
        }
        .refreshable { await load() }
    }

    private func toggle(_ path: String) {
        if collapsed.contains(path) { collapsed.remove(path) } else { collapsed.insert(path) }
    }

    private func load() async {
        do {
            diff = try await api.sessionDiff(sessionId)
            generation += 1
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
    }
}
