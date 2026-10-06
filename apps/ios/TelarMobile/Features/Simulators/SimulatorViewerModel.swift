import Observation
import UIKit

@MainActor @Observable final class SimulatorViewerModel {
    enum Phase: Equatable {
        case connecting
        case streaming
        case failed(String)
    }

    let api: any SimulatorsAPI
    private(set) var simulators: [SimulatorSummary]
    private(set) var selectedId: String?
    private(set) var image: UIImage?
    private(set) var screen: SimulatorScreen?
    private(set) var phase = Phase.connecting
    private(set) var canDrive = false
    private(set) var shuttingDown = false
    private(set) var notice: String?
    private(set) var closed = false

    @ObservationIgnored private var stream: MJPEGStream?
    @ObservationIgnored private var loops: Task<Void, Never>?
    @ObservationIgnored private var retry: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var base: URL?
    @ObservationIgnored private var pending: [SimulatorInput] = []
    @ObservationIgnored private var sending = false
    @ObservationIgnored private var rotationCursor: SimulatorOrientation?

    init(api: any SimulatorsAPI, simulators: [SimulatorSummary], selectedId: String? = nil) {
        self.api = api
        self.simulators = simulators
        self.selectedId = selectedId ?? simulators.first?.id
    }

    var selected: SimulatorSummary? { simulators.first { $0.id == selectedId } }

    func start() {
        guard loops == nil else { return }
        openStream()
        loops = Task { [weak self, api] in
            let canDrive = await SimulatorAccess.canDrive(api)
            self?.canDrive = canDrive
            var tick = 0
            while !Task.isCancelled {
                guard let self else { return }
                await refreshScreen()
                if tick % 4 == 0 { await refreshList() }
                tick += 1
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() {
        generation += 1
        loops?.cancel()
        loops = nil
        retry?.cancel()
        retry = nil
        stream?.stop()
        stream = nil
    }

    func reload() {
        stop()
        image = nil
        start()
    }

    func select(_ id: String) {
        guard id != selectedId else { return }
        selectedId = id
        screen = nil
        rotationCursor = nil
        pending = []
        reload()
    }

    func touch(_ phase: SimulatorTouchPhase, at point: CGPoint) {
        send(.touch(phase, x: point.x, y: point.y))
    }

    func press(_ button: SimulatorButton) {
        send(.button(button))
    }

    func rotate() {
        let next = (rotationCursor ?? screen?.orientation ?? .portrait).next
        rotationCursor = next
        send(.orientation(next))
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            await self?.refreshScreen()
        }
    }

    func shutDown() async {
        guard let id = selectedId, !shuttingDown else { return }
        shuttingDown = true
        defer { shuttingDown = false }
        do {
            _ = try await api.shutdownSimulator(id)
            drop(id)
        } catch {
            notice = error.localizedDescription
        }
    }

    private func send(_ event: SimulatorInput) {
        guard canDrive else { return }
        pending.append(event)
        flush()
    }

    private func flush() {
        guard !sending, let id = selectedId, !pending.isEmpty else { return }
        pending = SimulatorInput.coalesce(pending)
        let batch = Array(pending.prefix(SimulatorInput.maxBatch))
        pending.removeFirst(batch.count)
        sending = true
        Task { [weak self, api] in
            var failure: String?
            do { try await api.sendSimulatorInput(id, events: batch) } catch { failure = error.localizedDescription }
            guard let self else { return }
            sending = false
            if let failure { notice = failure } else if notice != nil { notice = nil }
            flush()
        }
    }

    private func openStream() {
        guard let id = selectedId else { return }
        generation += 1
        let current = generation
        if image == nil { phase = .connecting }
        let stream = MJPEGStream(
            onFrame: { [weak self] frame in
                guard let self, generation == current else { return }
                image = frame
                phase = .streaming
            },
            onEnd: { [weak self] ending in
                guard let self, generation == current else { return }
                Task { await self.streamEnded(ending) }
            }
        )
        self.stream = stream
        stream.start(api.simulatorStreamRequest(id, base: base))
    }

    private func streamEnded(_ ending: MJPEGStream.Ending) async {
        stream = nil
        let current = generation
        switch ending {
        case .failed(let error):
            if HostAddresses.isTransportFailure(error), let moved = await api.movedBase(after: base) { base = moved }
            if image == nil { phase = .failed(error.localizedDescription) }
        case .status(let status, let body):
            let error = EngineAPIError.failure(body, status: status)
            phase = .failed(error.localizedDescription)
            if error.isUnauthorized || error.isForbidden || error.isNotFound { return }
        case .closed:
            break
        }
        guard current == generation, loops != nil else { return }
        retry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, let self, current == generation else { return }
            openStream()
        }
    }

    private func refreshScreen() async {
        guard let id = selectedId, let fresh = try? await api.simulatorScreen(id), id == selectedId else { return }
        if fresh.orientation != screen?.orientation { rotationCursor = fresh.orientation }
        if fresh != screen { screen = fresh }
    }

    private func refreshList() async {
        guard let state = try? await api.simulators() else { return }
        let viewable = state.viewable
        if viewable != simulators { simulators = viewable }
        if let id = selectedId, !viewable.contains(where: { $0.id == id }) { drop(id) }
    }

    private func drop(_ id: String) {
        simulators.removeAll { $0.id == id }
        if let next = simulators.first {
            select(next.id)
        } else {
            stop()
            closed = true
        }
    }
}

enum SimulatorAccess {
    /// A view-only phone may watch, but the cockpit refuses its input, so its controls are hidden.
    static func canDrive(_ api: any SimulatorsAPI) async -> Bool {
        (try? await api.remoteStatus())?.callerRole != "observer"
    }
}
