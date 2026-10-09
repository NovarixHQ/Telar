import ExpoModulesCore
import Security

public final class SwiftPairingsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TelarSwiftPairings")

    Function("hosts") { () -> String? in
      UserDefaults.standard.data(forKey: "telar.hosts").flatMap { String(data: $0, encoding: .utf8) }
    }

    Function("token") { (account: String) -> String? in
      Self.read(account: account)
    }
  }

  // The Swift app's KeychainStore: service is the bundle id, no access group, so this app's default group finds it.
  private static func read(account: String) -> String? {
    let service = Bundle.main.bundleIdentifier ?? "io.github.novarix.telar"
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    #if targetEnvironment(simulator)
    if status == errSecMissingEntitlement {
      return UserDefaults(suiteName: "telar.simulator-keychain")?.string(forKey: "\(service)/\(account)")
    }
    #endif
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
