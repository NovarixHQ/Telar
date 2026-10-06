import Foundation

struct SimulatorSummary: Decodable, Equatable, Identifiable, Sendable {
    var id: String
    var platform: String
    var name: String
    var version: String
    var booted: Bool
    var physical: Bool
    var pairedWith: String?

    var viewable: Bool { booted && platform == "ios" && !physical }
    var isWatch: Bool { pairedWith != nil }
    var icon: String { isWatch ? "applewatch" : "iphone" }
}

struct SimulatorPlatformAvailability: Decodable, Equatable, Sendable {
    var platform: String
    var available: Bool
    var reason: String?
}

struct SimulatorsState: Decodable, Equatable, Sendable {
    var status: String
    var detail: String?
    var platforms: [SimulatorPlatformAvailability]
    var simulators: [SimulatorSummary]
    var errors: [String]

    var viewable: [SimulatorSummary] { simulators.filter(\.viewable) }
}

enum SimulatorOrientation: String, Codable, CaseIterable, Sendable {
    case portrait
    case landscapeLeft = "landscape_left"
    case portraitUpsideDown = "portrait_upside_down"
    case landscapeRight = "landscape_right"

    var next: SimulatorOrientation {
        let all = Self.allCases
        return all[(all.firstIndex(of: self)! + 1) % all.count]
    }
}

struct SimulatorScreen: Decodable, Equatable, Sendable {
    var width: Double
    var height: Double
    var orientation: SimulatorOrientation
}

enum SimulatorTouchPhase: String, Encodable, Sendable {
    case begin, move, end
}

enum SimulatorButton: String, Encodable, Sendable {
    case home
    case appSwitcher = "app_switcher"
}

enum SimulatorInput: Encodable, Equatable, Sendable {
    case touch(SimulatorTouchPhase, x: Double, y: Double)
    case button(SimulatorButton)
    case orientation(SimulatorOrientation)

    private enum Keys: String, CodingKey { case type, phase, x, y, button, orientation }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case .touch(let phase, let x, let y):
            try container.encode("touch", forKey: .type)
            try container.encode(phase, forKey: .phase)
            try container.encode(x, forKey: .x)
            try container.encode(y, forKey: .y)
        case .button(let button):
            try container.encode("button", forKey: .type)
            try container.encode(button, forKey: .button)
        case .orientation(let orientation):
            try container.encode("orientation", forKey: .type)
            try container.encode(orientation, forKey: .orientation)
        }
    }

    var isMove: Bool {
        if case .touch(.move, _, _) = self { return true }
        return false
    }

    static let maxBatch = 64

    static func coalesce(_ events: [SimulatorInput]) -> [SimulatorInput] {
        events.enumerated().compactMap { index, event in
            event.isMove && index + 1 < events.count && events[index + 1].isMove ? nil : event
        }
    }
}

func agentSimulator(_ current: String?, after events: [EngineEvent]) -> String? {
    events.reduce(current) { latest, event in
        switch event.payload {
        case .simulatorOpened(let simulator): simulator.id
        case .simulatorClosed(let id): latest == id ? nil : latest
        default: latest
        }
    }
}

func preferringAgent(_ running: [SimulatorSummary], _ agentId: String?) -> [SimulatorSummary] {
    guard let agentId, let index = running.firstIndex(where: { $0.id == agentId }) else { return running }
    var ordered = running
    ordered.insert(ordered.remove(at: index), at: 0)
    return ordered
}
