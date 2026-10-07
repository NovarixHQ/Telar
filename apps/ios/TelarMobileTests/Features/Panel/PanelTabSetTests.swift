import Foundation
import Testing
@testable import TelarMobile

@Suite @MainActor struct PanelTabSetTests {
    private func fresh() -> (PanelModel, UserDefaults, String) {
        let suite = "telar.panel.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        return (PanelModel(hostId: UUID(), sessionId: "s", defaults: defaults), defaults, suite)
    }

    @Test func aSessionsPanelStartsWithNothingOpen() {
        let (panel, defaults, suite) = fresh()
        defer { defaults.removePersistentDomain(forName: suite) }
        #expect(panel.tabs.isEmpty && panel.active == nil && !panel.isOpen)
        panel.open()
        #expect(panel.isOpen && panel.tabs.isEmpty)
        #expect(panel.openable == [.diff, .editor, .agents, .simulator])
    }

    @Test func openingASurfaceAddsItOnceAndTheChooserStopsOfferingIt() {
        let (panel, defaults, suite) = fresh()
        defer { defaults.removePersistentDomain(forName: suite) }
        panel.open(.agents)
        panel.open(.diff)
        panel.open(.agents)
        #expect(panel.tabs == [.agents, .diff])
        #expect(panel.active == .agents)
        #expect(panel.openable == [.editor, .simulator])
    }

    @Test func closingTheActiveTabFocusesItsRightNeighbourThenTheLast() {
        let (panel, defaults, suite) = fresh()
        defer { defaults.removePersistentDomain(forName: suite) }
        for tab in [PanelTab.diff, .editor, .agents] { panel.open(tab) }
        panel.select(.editor)
        panel.closeTab(.editor)
        #expect(panel.tabs == [.diff, .agents] && panel.active == .agents)
        panel.closeTab(.agents)
        #expect(panel.active == .diff)
        panel.closeTab(.diff)
        #expect(panel.tabs.isEmpty && panel.active == nil && panel.isOpen)
    }

    @Test func closingAnInactiveTabKeepsFocus() {
        let (panel, defaults, suite) = fresh()
        defer { defaults.removePersistentDomain(forName: suite) }
        panel.open(.diff)
        panel.open(.agents)
        panel.closeTab(.diff)
        #expect(panel.active == .agents)
    }

    @Test func theOpenSetIsRememberedPerSession() {
        let (panel, defaults, suite) = fresh()
        defer { defaults.removePersistentDomain(forName: suite) }
        panel.open(.agents)
        panel.open(.diff)
        panel.select(.agents)
        let again = PanelModel(hostId: panel.hostId, sessionId: "s", defaults: defaults)
        #expect(again.tabs == [.agents, .diff] && again.active == .agents && again.isOpen)
        #expect(PanelModel(hostId: panel.hostId, sessionId: "other", defaults: defaults).tabs.isEmpty)
    }

    @Test func aPanelLeftOpenWithNothingInItRestoresClosed() {
        let (panel, defaults, suite) = fresh()
        defer { defaults.removePersistentDomain(forName: suite) }
        panel.open(.diff)
        panel.closeTab(.diff)
        #expect(panel.isOpen)
        #expect(!PanelModel(hostId: panel.hostId, sessionId: "s", defaults: defaults).isOpen)
    }

    @Test func aPanelSavedBeforeTabsCouldCloseStartsEmpty() throws {
        let suite = "telar.panel.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let host = UUID()
        let old = #"{"isOpen":true,"active":"files","editor":{"files":[],"treeShown":true}}"#
        defaults.set(Data(old.utf8), forKey: "telar.panel.\(host.uuidString).s")
        let panel = PanelModel(hostId: host, sessionId: "s", defaults: defaults)
        #expect(panel.tabs.isEmpty && panel.active == nil && !panel.isOpen)
    }
}
