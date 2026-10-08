import Foundation

struct BrowserPage: Decodable, Equatable, Identifiable, Sendable {
    var id: String
    var url: String
    var title: String
    var active: Bool
    var loading: Bool?

    var label: String {
        if !title.isEmpty { return title }
        return URL(string: url)?.host() ?? (url.isEmpty ? "New page" : url)
    }
}

struct BrowserSnapshot: Decodable, Equatable, Sendable {
    var running: Bool
    var tabs: [BrowserPage]
    var screenshot: String?
    var error: String?

    private enum CodingKeys: String, CodingKey { case running, tabs, screenshot, error }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        running = (try? c.decode(Bool.self, forKey: .running)) ?? false
        tabs = (try? c.decode([Skippable<BrowserPage>].self, forKey: .tabs))?.compactMap(\.value) ?? []
        screenshot = try? c.decodeIfPresent(String.self, forKey: .screenshot)
        error = try? c.decodeIfPresent(String.self, forKey: .error)
    }

    var image: Data? {
        guard let screenshot, let comma = screenshot.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(screenshot[screenshot.index(after: comma)...]))
    }
}

protocol BrowserAPI: Sendable {
    func browser(_ sessionId: EngineID, screenshot: Bool) async throws -> BrowserSnapshot
    func openPage(_ sessionId: EngineID, url: String) async throws -> BrowserSnapshot
}

extension HTTPEngineAPI: BrowserAPI {
    private struct Wrapped: Decodable { var browser: BrowserSnapshot }

    func browser(_ sessionId: EngineID, screenshot: Bool) async throws -> BrowserSnapshot {
        let query = screenshot ? [URLQueryItem(name: "screenshot", value: "1")] : []
        let wrapped: Wrapped = try await get("api/sessions/\(escape(sessionId))/browser", query: query)
        return wrapped.browser
    }

    func openPage(_ sessionId: EngineID, url: String) async throws -> BrowserSnapshot {
        let wrapped: Wrapped = try await post("api/sessions/\(escape(sessionId))/browser/open", body: ["url": AnyEncodable(url)])
        return wrapped.browser
    }
}
