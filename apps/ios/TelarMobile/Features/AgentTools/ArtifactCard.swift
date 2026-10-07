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
        if (versions[artifact.id] ?? artifact.version) > artifact.version {
            Text("\(artifact.title) · updated below")
                .font(Theme.meta)
                .foregroundStyle(Theme.textMuted)
        } else {
            ArtifactBody(artifact: artifact)
                .overlay(alignment: .topTrailing) {
                    Button { expanded = true } label: {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.system(Theme.caption, weight: .medium))
                            .foregroundStyle(Theme.textMuted)
                            .padding(6)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                    .accessibilityLabel("Open \(artifact.title) full screen")
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(artifact.title)
                .fullScreenCover(isPresented: $expanded) { ArtifactSheet(artifact: artifact) }
        }
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
            Color.clear.frame(height: ArtifactFrame.height(measured: probe?.height, hint: artifact.height))
        case .failed:
            ArtifactNotice(text: "This artifact could not be loaded.")
        case .loaded(let text, _):
            switch artifact.kind {
            case .html, .svg: frame(text)
            case .markdown: MarkdownText(text: text)
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
                    key: key, content: text, kind: artifact.kind, dark: scheme == .dark, scrolls: ArtifactFrame.scrolls(probe, hint: artifact.height),
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
        .frame(height: ArtifactFrame.height(measured: probe?.height, hint: artifact.height))
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
