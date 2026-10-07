import SwiftUI

extension View {
    func warmsHead(_ key: ScopedSessionID, api: @escaping () -> (any EngineAPI)?) -> some View {
        task(id: key) {
            try? await Task.sleep(for: .milliseconds(300))
            if !Task.isCancelled { SessionHeads.shared.warm(key, api: api) }
        }
        .onDisappear { SessionHeads.shared.cancelWarm(key) }
    }
}
