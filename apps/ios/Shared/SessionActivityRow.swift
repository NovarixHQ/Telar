import Foundation

struct SessionActivityRow: Codable, Hashable, Identifiable {
    var id: String
    var status: String
    var title: String? = nil
    var project: String? = nil
    var workers: Int? = nil

    var needsYou: Bool { status == "Needs you" }
    var over: Bool { status == "Done" || status == "Failed" }
    var workersLabel: String? { workers.flatMap { $0 > 0 ? ($0 == 1 ? "1 worker" : "\($0) workers") : nil } }
    var label: String { title ?? [project ?? "Session", workersLabel].compactMap { $0 }.joined(separator: " · ") }
    var detail: String? { title == nil ? nil : [project, workersLabel].compactMap { $0 }.joined(separator: " · ") }

    static func clip(_ text: String, _ max: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > max else { return trimmed }
        return String(trimmed.prefix(max - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }
