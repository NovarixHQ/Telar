import Foundation

final class HTTPTransport: Sendable {
    private let configuration: URLSessionConfiguration
    let session: URLSession
    let hostKey: String

    init(hostKey: String = "other", configuration: URLSessionConfiguration = HTTPTransport.engineConfiguration) {
        self.hostKey = hostKey
        self.configuration = configuration
        session = URLSession(configuration: configuration)
    }

    static var engineConfiguration: URLSessionConfiguration {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return config
    }

    func streamSession() -> URLSession { URLSession(configuration: configuration) }

    func invalidate() {
        session.finishTasksAndInvalidate()
    }
}
