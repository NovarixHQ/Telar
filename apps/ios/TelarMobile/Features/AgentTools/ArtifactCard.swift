import SwiftUI

@MainActor @Observable final class ArtifactShelf {
    private(set) var slots = ArtifactSlots(cap: 4)
    private(set) var probes: [EngineID: ArtifactProbe] = [:]

    func claim(_ key: EngineID) { slots.claim(key) }
    func release(_ key: EngineID) { slots.release(key) }

    func record(_ probe: ArtifactProbe, for key: EngineID) {
        if probes[key] != probe { probes[key] = probe }
    }
}

extension EnvironmentValues {
    @Entry var artifactShelf: ArtifactShelf?
    @Entry var artifactVersions: [String: Int] = [:]
}

enum ArtifactLoad: Equatable {
    case loading
    case loaded(text: String, file: URL)
    case failed

    @MainActor static func fetch(_ artifact: Artifact, source: AttachmentSource?) async -> ArtifactLoad {
        guard let source else { return .failed }
        let name = "\(artifact.title).\(artifact.kind.fileExtension)"
        guard let file = await AttachmentCache.shared.fileURL(
            host: source.host, session: source.session, attachmentId: artifact.attachmentId, name: name, fetch: source.fetch
        ), let data = try? Data(contentsOf: file) else { return .failed }
        return .loaded(text: String(decoding: data, as: UTF8.self), file: file)
    }
}

struct ArtifactCard: View {
    let artifact: Artifact

    @Environment(\.artifactVersions) private var versions
    @State private var expanded = false

    var body: some View {
        let newest = max(versions[artifact.id] ?? artifact.version, artifact.version)
        VStack(alignment: .leading, spacing: 0) {
            Button { expanded = true } label: { header(newest: newest) }
                .buttonStyle(.plain)
                .accessibilityHint("Opens full screen")
            if newest == artifact.version {
                Rectangle().fill(Theme.border).frame(height: 1)
                ArtifactBody(artifact: artifact)
            }
        }
        .background(Theme.canvas)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusRow))
        .hairline(Theme.radiusRow)
        .fullScreenCover(isPresented: $expanded) { ArtifactSheet(artifact: artifact) }
    }

    private func header(newest: Int) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "square.on.circle")
                .font(.system(Theme.caption, weight: .medium))
                .foregroundStyle(Theme.textMuted)
            Text(artifact.title)
                .font(.system(Theme.footnote, weight: .medium))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
            Spacer(minLength: 0)
            if let label = artifactVersionLabel(artifact, newest: newest) {
                Text(label).font(Theme.monoSmall).foregroundStyle(Theme.textMuted).tabularNumbers()
            }
            Image(systemName: "arrow.up.left.and.arrow.down.right")
                .font(.system(Theme.caption, weight: .medium))
                .foregroundStyle(Theme.textMuted)
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 36)
        .contentShape(Rectangle())
    }
}

private struct ArtifactBody: View {
    let artifact: Artifact

    @Environment(\.attachmentSource) private var source
    @Environment(\.artifactShelf) private var shelf
    @Environment(\.colorScheme) private var scheme
    @State private var load = ArtifactLoad.loading
    @State private var localProbe: ArtifactProbe?
    @State private var crashed = false

    private var key: EngineID { artifact.attachmentId }
    private var probe: ArtifactProbe? { shelf?.probes[key] ?? localProbe }

    var body: some View {
        content.task(id: key) { load = await ArtifactLoad.fetch(artifact, source: source) }
    }

    @ViewBuilder private var content: some View {
        switch load {
        case .loading:
            ArtifactNotice(text: "Loading…").frame(height: ArtifactFrame.height(measured: probe?.height))
        case .failed:
            ArtifactNotice(text: "This artifact could not be loaded.")
        case .loaded(let text, _):
            switch artifact.kind {
            case .html, .svg: frame(text)
            case .markdown: MarkdownText(text: text).padding(.horizontal, 12).padding(.vertical, 10)
            case .mermaid, .unknown: ArtifactNotice.desktopOnly(artifact.kind)
            }
        }
    }

    private func frame(_ text: String) -> some View {
        Group {
            if crashed {
                ArtifactNotice(text: "This artifact stopped responding.")
            } else if shelf?.slots.isLive(key) ?? true {
                ArtifactWebView(
                    key: key, content: text, kind: artifact.kind, dark: scheme == .dark, scrolls: ArtifactFrame.scrolls(probe),
                    onProbe: { probe in
                        localProbe = probe
                        shelf?.record(probe, for: key)
                    },
                    onCrash: { crashed = true }
                )
            } else {
                Button { shelf?.claim(key) } label: {
                    ArtifactNotice(text: "Tap to show").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(height: ArtifactFrame.height(measured: probe?.height))
        .onScrollVisibilityChange(threshold: 0.05) { visible in
            if visible { shelf?.claim(key) } else { shelf?.release(key) }
        }
    }
}

struct ArtifactNotice: View {
    var icon: String?
    let text: String

    static func desktopOnly(_ kind: ArtifactKind) -> ArtifactNotice {
        ArtifactNotice(
            icon: "desktopcomputer",
            text: kind == .mermaid ? "Open on desktop to see this diagram." : "Open on desktop to see this artifact."
        )
    }

    var body: some View {
        HStack(spacing: 8) {
            if let icon { Image(systemName: icon) }
            Text(text)
        }
        .font(Theme.meta)
        .foregroundStyle(Theme.textMuted)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ArtifactSheet: View {
    let artifact: Artifact

    @Environment(\.dismiss) private var dismiss
    @Environment(\.attachmentSource) private var source
    @Environment(\.colorScheme) private var scheme
    @State private var load = ArtifactLoad.loading
    @State private var showSource = false

    private var file: URL? {
        if case .loaded(_, let file) = load { return file }
        return nil
    }

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Theme.canvas)
                .navigationTitle(artifact.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                    ToolbarItem(placement: .principal) {
                        Picker("View", selection: $showSource) {
                            Text("Rendered").tag(false)
                            Text("Source").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .fixedSize()
                    }
                    ToolbarItem(placement: .primaryAction) {
                        if let file { ShareLink(item: file) }
                    }
                }
        }
        .task { load = await ArtifactLoad.fetch(artifact, source: source) }
    }

    @ViewBuilder private var content: some View {
        switch load {
        case .loading:
            ArtifactNotice(text: "Loading…")
        case .failed:
            ArtifactNotice(text: "This artifact could not be loaded.")
        case .loaded(let text, _):
            if showSource {
                ScrollView {
                    Text(text)
                        .font(Theme.mono)
                        .foregroundStyle(Theme.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
            } else {
                switch artifact.kind {
                case .html, .svg:
                    ArtifactWebView(key: artifact.attachmentId, content: text, kind: artifact.kind, dark: scheme == .dark, scrolls: true)
                        .ignoresSafeArea(edges: .bottom)
                case .markdown:
                    ScrollView { MarkdownText(text: text).padding() }
                case .mermaid, .unknown:
                    ArtifactNotice.desktopOnly(artifact.kind)
                }
            }
        }
    }
}
