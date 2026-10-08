import SwiftUI

enum PanelPresentation {
    case column

    case page
}

struct PanelView: View {
    let api: any EngineAPI
    let panelAPI: (any PanelAPI)?
    let sessionId: EngineID
    let hostId: HostID?
    var simulators: [SimulatorSummary] = []
    var simulatorIds: [String] = []
    var hostName: String?
    var terminals: [EngineTerminal] = []
    var browser: BrowserWatch?

    let active: Bool
    var diffRevision = 0
    let panel: PanelModel
    var presentation: PanelPresentation = .page

    var canFillWindow = false
    let onClose: () -> Void

    @State private var launching: PanelTab?
    @State private var entry = ""
    @State private var failure: String?

    var body: some View {
        VStack(spacing: 0) {
            strip
            Divider().overlay(Theme.borderSubtle)
            surface
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(presentation == .column ? Theme.sheet : Theme.canvas)
        .navigationTitle(panel.active.map(panel.label) ?? "Panel")
        .environment(\.panel, panel)
        .alert(launching == .browser ? "Open a page" : "Run a command", isPresented: Binding(get: { launching != nil }, set: { if !$0 { launching = nil } })) {
            TextField(launching == .browser ? "Address" : "Command", text: $entry)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(launching == .browser ? "Open" : "Run") { launch(launching, entry) }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Couldn't open it", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") {}
        } message: { Text(failure ?? "") }
    }

    private func choose(_ tab: PanelTab) {
        switch tab {
        case .terminal:
            entry = ""
            launching = .terminal
        case .browser:
            if let page = browser?.pages.first(where: \.active) ?? browser?.pages.first {
                panel.open(.page(page.id))
            } else {
                entry = ""
                launching = .browser
            }
        default:
            panel.open(tab)
        }
    }

    private func launch(_ kind: PanelTab?, _ text: String) {
        let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty else { return }
        Task {
            do {
                if kind == .browser, let browser, let browserAPI = api as? any BrowserAPI {
                    if let page = try await browser.open(typed, api: browserAPI, sessionId: sessionId) { panel.open(.page(page.id)) }
                } else if let terminalAPI = api as? any TerminalAPI {
                    let terminal = try await terminalAPI.openTerminal(sessionId, command: typed)
                    panel.open(.terminal(terminal.terminalId))
                }
            } catch {
                failure = describe(error)
            }
        }
    }

    static func showsClose(_ presentation: PanelPresentation, canFillWindow: Bool) -> Bool {
        presentation == .column || canFillWindow
    }

    private var strip: some View {
        HStack(spacing: 4) {
            PanelTabStrip(
                tabs: panel.tabs, active: panel.active, openable: panel.openable, label: panel.label,
                select: { panel.select($0) }, close: { panel.closeTab($0) }, open: choose
            )
            Spacer(minLength: 0)

            if canFillWindow {
                Button {
                    panel.setFullScreen(!panel.isFullScreen)
                } label: {
                    Image(systemName: panel.isFullScreen
                          ? "arrow.down.right.and.arrow.up.left"
                          : "arrow.up.left.and.arrow.down.right")
                        .foregroundStyle(Theme.textMuted)
                        .scaledGlyphBox(30, glyph: 12, weight: .semibold)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(panel.isFullScreen ? "Leave full screen" : "Fill the window")
            }
            if Self.showsClose(presentation, canFillWindow: canFillWindow) {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .foregroundStyle(Theme.textMuted)
                        .scaledGlyphBox(30, glyph: 12, weight: .semibold)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close panel")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    @ViewBuilder private var surface: some View {
        switch panel.active {
        case nil:
            PanelEmptyState(offered: panel.offered, open: choose)
        case .diff:
            DiffView(api: api, sessionId: sessionId, active: active, revision: diffRevision)

        case .simulator:
            if let simulatorsAPI = api as? any SimulatorsAPI {
                SimulatorSurface(api: simulatorsAPI, running: simulators, sessionId: sessionId, owned: simulatorIds)
            } else {
                unavailable
            }
        case .agents:
            AgentsSurface(api: api, sessionId: sessionId, hostId: hostId, hostName: hostName, active: active)
        case .editor:
            if let panelAPI {
                FilesSurface(api: panelAPI, sessionId: sessionId, hostId: hostId, active: active, panel: panel)
            } else {
                unavailable
            }

        case let tab? where tab.terminalId != nil:
            if let terminalAPI = api as? any TerminalAPI, let id = tab.terminalId {
                TerminalSurface(api: terminalAPI, sessionId: sessionId, terminalId: id, terminal: terminals.first { $0.terminalId == id })
                    .id(id)
            } else {
                unavailable
            }
        case let tab? where tab.pageId != nil:
            if let browserAPI = api as? any BrowserAPI, let browser, let id = tab.pageId {
                BrowserPageSurface(api: browserAPI, sessionId: sessionId, pageId: id, watch: browser)
                    .id(id)
            } else {
                unavailable
            }
        case let tab?:
            if let panelAPI {
                PluginSurfaceView(tab: tab, api: panelAPI, sessionId: sessionId, hostId: hostId, active: active, panel: panel)
            } else {
                unavailable
            }
        }
    }

    private var unavailable: some View {
        ContentUnavailableView("Not available here", systemImage: "wifi.slash", description: Text("This surface needs a paired computer."))
    }
}

func describe(_ error: Error) -> String {
    (error as? EngineAPIError)?.errorDescription ?? error.localizedDescription
}
