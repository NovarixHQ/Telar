import Foundation

final class HTTPTransport: @unchecked Sendable {
    private let lock = NSLock()
    private let configuration: URLSessionConfiguration
    private var current: URLSession
    let hostKey: String

    init(hostKey: String = "other", configuration: URLSessionConfiguration = HTTPTransport.engineConfiguration) {
        self.hostKey = hostKey
        self.configuration = configuration
        current = URLSession(configuration: configuration)
    }

    static var engineConfiguration: URLSessionConfiguration {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return config
    }

    var session: URLSession { lock.withLock { current } }

    func streamSession() -> URLSession { URLSession(configuration: configuration) }

    @discardableResult
    func renew(replacing stale: URLSession? = nil) -> URLSession {
        lock.withLock {
            guard stale == nil || stale === current else { return current }
            current.finishTasksAndInvalidate()
            current = URLSession(configuration: configuration)
            ConnectionLog.shared.note(hostKey, "session renewed")
            return current
        }
    }

    func invalidate() {
        lock.withLock { current.finishTasksAndInvalidate() }
    }
}
