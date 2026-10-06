import Foundation

protocol SimulatorsAPI: RemoteAPI {
    func simulators() async throws -> SimulatorsState
    func bootSimulator(_ id: String) async throws -> SimulatorSummary
    func shutdownSimulator(_ id: String) async throws -> SimulatorSummary
    func simulatorScreen(_ id: String) async throws -> SimulatorScreen
    func sendSimulatorInput(_ id: String, events: [SimulatorInput]) async throws
    func simulatorStreamRequest(_ id: String, base: URL?) -> URLRequest
    func movedBase(after failed: URL?) async -> URL?
}

extension HTTPEngineAPI: SimulatorsAPI {
    private struct WrappedSimulator: Decodable { var simulator: SimulatorSummary }

    func simulators() async throws -> SimulatorsState {
        struct Wrapped: Decodable { var simulators: SimulatorsState }
        let wrapped: Wrapped = try await get("api/simulators")
        return wrapped.simulators
    }

    func bootSimulator(_ id: String) async throws -> SimulatorSummary {
        let wrapped: WrappedSimulator = try await post("api/simulators/\(escape(id))/boot", body: [:])
        return wrapped.simulator
    }

    func shutdownSimulator(_ id: String) async throws -> SimulatorSummary {
        let wrapped: WrappedSimulator = try await post("api/simulators/\(escape(id))/shutdown", body: [:])
        return wrapped.simulator
    }

    func simulatorScreen(_ id: String) async throws -> SimulatorScreen {
        try await get(hubPath(id, "config"))
    }

    func simulatorInputRequest(_ id: String, events: [SimulatorInput]) throws -> URLRequest {
        try jsonRequest("POST", url("api/simulators/\(escape(id))/input"), body: ["events": events])
    }

    func sendSimulatorInput(_ id: String, events: [SimulatorInput]) async throws {
        let _: IgnoredBody = try await perform(simulatorInputRequest(id, events: events))
    }

    func simulatorStreamRequest(_ id: String, base: URL?) -> URLRequest {
        let streamURL = url(hubPath(id, "stream.mjpeg"))
        var request = makeRequest(base.flatMap { HostAddresses.rebase(streamURL, from: baseURL, to: $0) } ?? streamURL)
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    func movedBase(after failed: URL?) async -> URL? {
        await failover?(failed ?? baseURL)
    }

    private func hubPath(_ id: String, _ resource: String) -> String {
        "api/simulators/hub/vendor/serve-sim/helper/\(escape(id))/\(resource)"
    }
}
