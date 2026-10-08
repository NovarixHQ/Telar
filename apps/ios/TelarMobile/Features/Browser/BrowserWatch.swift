import Foundation
import Observation

@MainActor @Observable final class BrowserWatch {
    private(set) var snapshot: BrowserSnapshot?

    var pages: [BrowserPage] { snapshot?.tabs ?? [] }

    func read(_ api: any BrowserAPI, sessionId: EngineID) async {
        if let read = try? await api.browser(sessionId, screenshot: false) { apply(read) }
    }

    func apply(_ read: BrowserSnapshot) {
        var bare = read
        bare.screenshot = nil
        if bare != snapshot { snapshot = bare }
    }

    func open(_ address: String, api: any BrowserAPI, sessionId: EngineID) async throws -> BrowserPage? {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let url = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        let known = Set(pages.map(\.id))
        let read = try await api.openPage(sessionId, url: url)
        apply(read)
        return read.tabs.last { !known.contains($0.id) } ?? read.tabs.first(where: \.active)
    }
}
