import SwiftUI

struct TextFileView: View {
    let api: any PanelAPI
    let sessionId: EngineID
    let hostId: HostID?
    let path: String
    let active: Bool
    let prose: Bool

    var root: String?
    let onSaveState: (FilesSurface.SaveState?) -> Void

    @State private var file: WorkspaceFile?
    @State private var error: String?
    @State private var text = ""
    @State private var baseline: String?
    @State private var refusal: WorkspaceWriteRefusal?
    @State private var saveFailure: String?
    @State private var dirty = false
    @State private var saving = false
    @State private var editing = false
    @State private var saveTask: Task<Void, Never>?
    @AppStorage("telar.editor.wrap") private var wrap = false

    @State private var colours: CodeColours?
    @State private var findRequest = 0
    @State private var sideways = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.panel) private var panel
    @FocusState private var focused: Bool

    private var draftKey: String { "telar.fileDraft.\(hostId?.uuidString ?? "local").\(sessionId).\(path)" }
    private struct Draft: Codable { var text: String; var baseline: String }

    private var canEdit: Bool { file.map { !$0.binary && !$0.truncated } ?? false }

    var body: some View {
        VStack(spacing: 0) {
            FileAddressRow(path: path, detail: file.map { humanBytes($0.bytes) }, trailing: prose || file?.binary != false ? nil : AnyView(codeTools))
                .contextMenu { addressMenu }
            if let refusal {
                problemBanner(refusalCopy(refusal), reread: refusal == .conflict)
            } else if let saveFailure {
                problemBanner(saveFailure, reread: false)
            }
            if let file {
                if file.binary {
                    ContentUnavailableView("Binary file", systemImage: "doc.zipper", description: Text("\(humanBytes(file.bytes)) of bytes rather than text, so nothing was sent to read."))
                } else if prose {
                    editor
                } else {
                    code(file)
                }
            } else if let error {
                ContentUnavailableView("Could not read this file", systemImage: "xmark.circle", description: Text(error))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: "\(path):\(active)") { await read() }
        .onDisappear { flush() }
    }

    private var codeTools: some View {
        HStack(spacing: 14) {
            if dirty {
                Text("Unsaved").foregroundStyle(Theme.statusAmber)
            }
            Button { findRequest += 1 } label: {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.textMuted)
            }
            .accessibilityLabel("Find in file")
            if canEdit {
                if editing {
                    Button("Save") { Task { await save() } }
                        .foregroundStyle(dirty && !saving ? Theme.accent : Theme.textMuted)
                        .disabled(!dirty || saving)
                        .keyboardShortcut("s", modifiers: .command)
                } else {
                    Button("Edit") { editing = true }
                        .foregroundStyle(Theme.text)
                }
            }
        }
        .font(.system(Theme.caption, weight: .medium))
        .buttonStyle(.plain)
    }

    private func code(_ file: WorkspaceFile) -> some View {
        VStack(spacing: 0) {
            if file.truncated {
                Text("Truncated: the first \(humanBytes(file.text.utf8.count)) of \(humanBytes(file.bytes)), so it can't be edited here.")
                    .font(.system(Theme.caption))
                    .foregroundStyle(Theme.statusAmber)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
            }
            CodeTextView(
                text: text, colours: colours, editable: editing && canEdit, wrap: wrap, findRequest: findRequest,
                onEdit: edited, onSideways: { sideways = $0 }
            )
        }
        .interactivePopDisabled(!wrap && sideways)
        .background(Theme.codeBackground)
        .task(id: "\(text.hashValue):\(scheme == .dark)") { await colour() }
    }

    private var editor: some View {
        TextEditor(text: $text)
            .font(.system(Theme.subhead, design: (path as NSString).pathExtension.lowercased() == "md" ? .default : .monospaced))
            .lineSpacing(3)
            .foregroundStyle(Theme.text)
            .scrollContentBackground(.hidden)
            .background(Theme.canvas)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .focused($focused)
            .padding(.horizontal, 6)
            .onChange(of: text) { _, next in
                guard file != nil, next != file?.text || dirty else { return }
                dirty = true
                stash(next)
                scheduleSave()
            }
    }

    @ViewBuilder private var addressMenu: some View {
        if let absolute = workspaceFilePath(root, path) {
            Button("Copy path", systemImage: "doc.on.doc") { UIPasteboard.general.string = absolute }
        }
        Button("Copy relative path", systemImage: "doc.on.doc") { UIPasteboard.general.string = path }
        Divider()
        Button("Re-read from disk", systemImage: "arrow.clockwise") { Task { await read(discardingDraft: true) } }
        Toggle(isOn: $wrap) { Label("Wrap lines", systemImage: "text.word.spacing") }
        if let panel {
            Divider()
            Button("Insert as a reference", systemImage: "text.badge.plus") {
                panel.insertReference(ComposerReference.file(path))
            }
        }
    }

    private func problemBanner(_ message: String, reread: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle").font(.system(Theme.caption)).foregroundStyle(Theme.statusRed)
            Text(message).font(.system(Theme.footnote)).foregroundStyle(Theme.statusRed)
            Spacer(minLength: 0)
            if reread {
                Button("Re-read from disk") { Task { await read(discardingDraft: true) } }
                    .font(.system(Theme.footnote, weight: .medium))
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.text)
            }
        }
        .padding(10)
        .background(Theme.statusRed.opacity(0.08))
    }

    private func refusalCopy(_ refusal: WorkspaceWriteRefusal) -> String {
        switch refusal {
        case .conflict: "This file changed on disk while you were editing — most likely the agent wrote it. Your text has not been saved."
        case .notFound: "This file is no longer there. It was moved or deleted while you had it open."
        case .binary: "The engine reports this file as binary, so there is no text to save back."
        case .tooLarge: "This file is too large for the panel to save safely — it was only partly read, and writing it back would drop the rest."
        case .unknown: "The engine refused the write."
        }
    }

    private func colour() async {
        let source = text, dark = scheme == .dark
        if colours != nil {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
        }
        let highlighted = await CodeHighlighter.shared.highlight(source, language: CodeLanguage.named(path), dark: dark)
        guard !Task.isCancelled else { return }
        colours = CodeColours(highlighted, text: source)
    }

    private func read(discardingDraft: Bool = false) async {
        do {
            let fresh = try await api.sessionFile(sessionId, path: path)
            file = fresh
            error = nil
            if discardingDraft {
                UserDefaults.standard.removeObject(forKey: draftKey)
                text = fresh.text
                baseline = fresh.sha256
                dirty = false
                refusal = nil
                saveFailure = nil
                onSaveState(nil)
            } else if let data = UserDefaults.standard.data(forKey: draftKey), let draft = try? JSONDecoder().decode(Draft.self, from: data) {
                if draft.text == fresh.text {
                    UserDefaults.standard.removeObject(forKey: draftKey)
                    text = fresh.text
                    baseline = fresh.sha256
                } else {
                    text = draft.text
                    baseline = draft.baseline
                    dirty = true
                    editing = true
                    if !prose { onSaveState(.unsaved) }
                }
            } else if !dirty {
                text = fresh.text
                baseline = fresh.sha256
            }
        } catch {
            self.error = describe(error)
        }
    }

    private func edited(_ next: String) {
        guard let file else { return }
        text = next
        dirty = next != file.text
        if dirty {
            stash(next)
        } else {
            UserDefaults.standard.removeObject(forKey: draftKey)
            baseline = file.sha256
        }
        onSaveState(dirty ? .unsaved : nil)
    }

    private func stash(_ next: String) {
        guard let baseline else { return }
        if let data = try? JSONEncoder().encode(Draft(text: next, baseline: baseline)) {
            UserDefaults.standard.set(data, forKey: draftKey)
        }
    }

    private func scheduleSave() {
        saveTask?.cancel()
        onSaveState(.saving)
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    private func flush() {
        guard prose, dirty, saveTask != nil else { return }
        saveTask?.cancel()
        let api = self.api, sessionId = self.sessionId, path = self.path, text = self.text, baseline = self.baseline
        Task.detached {
            guard let baseline else { return }
            _ = try? await api.writeSessionFile(sessionId, path: path, text: text, expectedSha256: baseline)
        }
    }

    private func save() async {
        guard let baseline, dirty, !saving else { return }
        let written = text
        saving = true
        defer { saving = false }
        onSaveState(.saving)
        do {
            switch try await api.writeSessionFile(sessionId, path: path, text: written, expectedSha256: baseline) {
            case .written(let fresh):
                self.baseline = fresh.sha256
                file = fresh
                refusal = nil
                saveFailure = nil
                if text == written {
                    dirty = false
                    UserDefaults.standard.removeObject(forKey: draftKey)
                    onSaveState(nil)
                } else {
                    stash(text)
                    if prose { scheduleSave() } else { onSaveState(.unsaved) }
                }
            case .refused(let why, _):
                refusal = why
                onSaveState(.problem)
            }
        } catch {
            saveFailure = describe(error)
            onSaveState(.problem)
        }
    }
}
