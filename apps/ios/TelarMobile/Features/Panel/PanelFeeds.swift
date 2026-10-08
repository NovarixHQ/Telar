import SwiftUI

struct PanelFeeds: ViewModifier {
    let api: any EngineAPI
    let sessionId: EngineID
    let panel: PanelModel
    let terminals: TerminalWatch
    let browser: BrowserWatch
    let browserRevision: Int
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .task(id: scenePhase == .active) {
                guard scenePhase == .active, let terminalAPI = api as? any TerminalAPI else { return }
                await terminals.watch(terminalAPI, sessionId: sessionId)
            }
            .task(id: "\(scenePhase == .active):\(browserRevision)") {
                guard scenePhase == .active, let browserAPI = api as? any BrowserAPI else { return }
                await browser.read(browserAPI, sessionId: sessionId)
            }
            .onChange(of: terminals.terminals) { _, list in
                guard let list else { return }
                let open = list.filter(\.isOpen).reversed().map { (tab: PanelTab.terminal($0.terminalId), title: $0.title) }
                panel.reconcile(open) { $0.terminalId != nil }
            }
            .onChange(of: browser.snapshot) { _, snapshot in
                guard let snapshot else { return }
                panel.reconcile(snapshot.tabs.map { (tab: PanelTab.page($0.id), title: $0.label) }) { $0.pageId != nil }
            }
    }
}

extension View {
    func panelFeeds(api: any EngineAPI, sessionId: EngineID, panel: PanelModel, terminals: TerminalWatch, browser: BrowserWatch, browserRevision: Int) -> some View {
        modifier(PanelFeeds(api: api, sessionId: sessionId, panel: panel, terminals: terminals, browser: browser, browserRevision: browserRevision))
    }
}
