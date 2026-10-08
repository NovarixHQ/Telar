import Foundation
import Observation

@MainActor @Observable final class TerminalWatch {
    private(set) var terminals: [EngineTerminal]?

    func watch(_ api: any TerminalAPI, sessionId: EngineID) async {
        var pause = Duration.seconds(2)
        while !Task.isCancelled {
            do {
                let listed = try await api.terminals(sessionId)
                if listed != terminals { terminals = listed }
                for try await frame in api.terminalStatuses(sessionId) {
                    if case .status(let terminal) = frame { upsert(terminal) }
                    pause = .seconds(2)
                }
            } catch {
                pause = min(pause * 2, .seconds(60))
            }
            try? await Task.sleep(for: pause)
        }
    }

    private func upsert(_ terminal: EngineTerminal) {
        var list = terminals ?? []
        list.removeAll { $0.terminalId == terminal.terminalId }
        list.append(terminal)
        list.sort { $0.startedAt > $1.startedAt }
        terminals = list
    }
}

@MainActor @Observable final class TerminalFeed {
    private(set) var text = ""
    private(set) var terminal: EngineTerminal?
    private(set) var failure: String?
    private(set) var dropped = false

    @ObservationIgnored private var screen = TerminalScreen()
    @ObservationIgnored private var cursor = 0
    @ObservationIgnored private var publishing = false

    init(terminal: EngineTerminal?) {
        self.terminal = terminal
    }

    func follow(_ api: any TerminalAPI, sessionId: EngineID, terminalId: String) async {
        var pause = Duration.seconds(1)
        while !Task.isCancelled {
            do {
                for try await frame in api.terminalFrames(sessionId, terminalId, after: cursor) {
                    failure = nil
                    pause = .seconds(1)
                    absorb(frame)
                }
            } catch {
                if !Task.isCancelled { failure = describe(error) }
                pause = min(pause * 2, .seconds(30))
            }
            try? await Task.sleep(for: pause)
        }
    }

    func adopt(_ terminal: EngineTerminal) { self.terminal = terminal }

    func fail(_ error: Error) { failure = describe(error) }

    private func absorb(_ frame: TerminalFrame) {
        switch frame {
        case .bytes(let data, let next, let gone):
            if next < cursor || gone > cursor {
                screen = TerminalScreen()
                dropped = gone > 0
            }
            screen.feed(data)
            cursor = next
            publish()
        case .status(let terminal):
            self.terminal = terminal
        case .other:
            break
        }
    }

    private func publish() {
        guard !publishing else { return }
        publishing = true
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(80))
            guard let self else { return }
            publishing = false
            if text != screen.text { text = screen.text }
        }
    }
}
