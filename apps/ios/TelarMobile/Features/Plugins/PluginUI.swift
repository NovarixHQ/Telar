import Foundation

enum PluginUI {
    struct Surface: Equatable {
        let tab: PanelTab
        let label: String
        let icon: String
        let blurb: String
    }

    enum Viewer: Equatable {
        case notebook, table
    }

    struct Contribution {
        var surfaces: [Surface] = []
        var viewers: [Viewer] = []
    }

    static let bundled: [(id: PluginID, contribution: Contribution)] = [
        (.dataScience, Contribution(surfaces: [Surface(tab: .data, label: "Data", icon: "flask", blurb: "Plots, variables and the Python environment")], viewers: [.notebook, .table])),
        (.latex, Contribution(surfaces: [Surface(tab: .latex, label: "LaTeX", icon: "function", blurb: "Compile status, errors and the log")])),
    ]

    static func surfaces(enabled: Set<PluginID>) -> [Surface] {
        bundled.filter { enabled.contains($0.id) }.flatMap(\.contribution.surfaces)
    }

    static func surface(for tab: PanelTab) -> Surface? {
        bundled.lazy.flatMap(\.contribution.surfaces).first { $0.tab == tab }
    }

    static func viewerAvailable(_ viewer: Viewer, enabled: Set<PluginID>) -> Bool {
        bundled.contains { enabled.contains($0.id) && $0.contribution.viewers.contains(viewer) }
    }
}
