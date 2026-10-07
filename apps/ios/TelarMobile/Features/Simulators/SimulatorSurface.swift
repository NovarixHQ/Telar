import SwiftUI

struct SimulatorSurface: View {
    let api: any SimulatorsAPI
    let running: [SimulatorSummary]
    let preferred: String?

    var body: some View {
        if running.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "iphone")
                    .font(.system(Theme.subhead, weight: .medium))
                    .foregroundStyle(Theme.textMuted)
                    .scaledGlyphBox(36, glyph: 15)
                    .background(Theme.fill, in: Circle())
                Text("No simulator is running")
                    .font(.system(Theme.subhead, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("When an agent boots one on the computer, it appears here.")
                    .font(.system(Theme.footnote))
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: 300)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
        } else {
            let selected = running.contains { $0.id == preferred } ? preferred : running.first?.id
            SimulatorViewer(api: api, simulators: running, selectedId: selected, embedded: true)
                .id(running.map(\.id).joined(separator: ","))
        }
    }
}
