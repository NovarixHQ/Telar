import Foundation

struct PanelTab: RawRepresentable, Codable, Hashable, Identifiable, Sendable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    var id: String { rawValue }

    static let diff = PanelTab(rawValue: "diff")
    static let editor = PanelTab(rawValue: "editor")
    static let agents = PanelTab(rawValue: "agents")

    static let data = PanelTab(rawValue: "data")
    static let latex = PanelTab(rawValue: "latex")

    static let core: [PanelTab] = [.diff, .editor, .agents]

    var label: String {
        switch self {
        case .diff: "Diff"
        case .editor: "Files"
        case .agents: "Agents"
        default: PluginUI.surface(for: self)?.label ?? rawValue
        }
    }

    var icon: String {
        switch self {
        case .diff: "plus.forwardslash.minus"
        case .editor: "folder"
        case .agents: "person.2"
        default: PluginUI.surface(for: self)?.icon ?? "puzzlepiece"
        }
    }

    var blurb: String {
        switch self {
        case .diff: "What this session changed"
        case .editor: "The checkout, file by file"
        case .agents: "Conversations working with this one"
        default: PluginUI.surface(for: self)?.blurb ?? ""
        }
    }
}
