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
    var hostName: String?

    let active: Bool
    let panel: PanelModel
    var presentation: PanelPresentation = .page

    var canFillWindow = false
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            strip
            Divider().overlay(Theme.borderSubtle)
            surface
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(presentation == .column ? Theme.sheet : Theme.canvas)
        .navigationTitle(panel.active?.label ?? "Panel")
        .environment(\.panel, panel)
    }

    static func showsClose(_ presentation: PanelPresentation, canFillWindow: Bool) -> Bool {
        presentation == .column || canFillWindow
    }

    private var strip: some View {
        HStack(spacing: 4) {
            PanelTabStrip(
                tabs: panel.tabs, active: panel.active, openable: panel.openable,
                select: { panel.select($0) }, close: { panel.closeTab($0) }, open: { panel.open($0) }
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
            PanelEmptyState(offered: panel.offered) { panel.open($0) }
        case .diff:
            DiffView(api: api, sessionId: sessionId)

        case .agents:
            AgentsSurface(api: api, sessionId: sessionId, hostId: hostId, hostName: hostName, active: active)
        case .editor:
            if let panelAPI {
                FilesSurface(api: panelAPI, sessionId: sessionId, hostId: hostId, active: active, panel: panel)
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
