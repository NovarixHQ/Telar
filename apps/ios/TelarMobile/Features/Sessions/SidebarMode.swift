import Foundation

enum SidebarMode: String, CaseIterable, Identifiable, Decodable, Sendable {
    case grouped, flat

    static let fallback: SidebarMode = .flat

    var id: String { rawValue }

    var label: String {
        switch self {
        case .grouped: return "Project"
        case .flat: return "None"
        }
    }
}
