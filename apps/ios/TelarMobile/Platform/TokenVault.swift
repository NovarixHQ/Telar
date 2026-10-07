import Foundation

protocol TokenVault: Sendable {
    func read(account: String) -> String?
    func write(_ token: String, account: String)
    func delete(account: String)
}

final class MemoryVault: TokenVault, @unchecked Sendable {
    private var storage: [String: String]

    init(_ storage: [String: String] = [:]) {
        self.storage = storage
    }

    func read(account: String) -> String? { storage[account] }
    func write(_ token: String, account: String) { storage[account] = token }
    func delete(account: String) { storage[account] = nil }
}
