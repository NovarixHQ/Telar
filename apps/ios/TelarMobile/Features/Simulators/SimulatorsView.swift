import SwiftUI

struct SimulatorsView: View {
    let api: any SimulatorsAPI
    @State private var state: SimulatorsState?
    @State private var error: String?
    @State private var canDrive: Bool?
    @State private var busy: Set<String> = []
    @State private var viewing: SimulatorSummary?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                if let state {
                    if let banner = banner(state) {
                        SettingsCard { banner }
                    }
                    if !state.simulators.isEmpty {
                        VStack(spacing: 0) {
                            SettingsSectionLabel("On this computer")
                            SettingsCard {
                                ForEach(Array(state.simulators.enumerated()), id: \.element.id) { index, simulator in
                                    if index > 0 { CardDivider() }
                                    row(simulator)
                                }
                            }
                            if canDrive == false {
                                SettingsFootnote("This phone is view-only: it can watch a running simulator but not start, stop or touch it.")
                            }
                        }
                    }
                }
                if let error {
                    SettingsCard {
                        StatusBanner(icon: "exclamationmark.triangle", color: Theme.statusAmber, title: error)
                    }
                } else if state == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 48)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(Theme.sheet)
        .navigationTitle("Simulators")
        .refreshable { await load() }
        .task {
            canDrive = await SimulatorAccess.canDrive(api)
            while !Task.isCancelled {
                await load()
                let settling = state.map { ["installing", "starting"].contains($0.status) } ?? false
                try? await Task.sleep(for: .seconds(settling ? 3 : 15))
            }
        }
        .fullScreenCover(item: $viewing) { simulator in
            SimulatorViewer(api: api, simulators: state?.viewable ?? [simulator], selectedId: simulator.id)
        }
    }

    private func banner(_ state: SimulatorsState) -> StatusBanner? {
        let unavailable = state.platforms.filter { !$0.available }.compactMap(\.reason)
        switch state.status {
        case "disabled":
            return StatusBanner(icon: "iphone.slash", color: Theme.textMuted, title: "Simulators are off on this computer.",
                                detail: "Turn them on in the cockpit's settings on the computer.")
        case "installing", "starting", "idle":
            return StatusBanner(icon: "hourglass", color: Theme.textMuted, title: "Getting simulators ready…", detail: state.detail)
        case "failed":
            return StatusBanner(icon: "xmark.circle", color: Theme.statusRed, title: "Simulators could not start.", detail: state.detail)
        default:
            let problems = state.errors + unavailable
            if state.simulators.isEmpty {
                return StatusBanner(icon: "iphone", color: Theme.textMuted, title: "No simulators found.",
                                    detail: problems.isEmpty ? nil : problems.joined(separator: "\n"))
            }
            return problems.isEmpty ? nil : StatusBanner(icon: "exclamationmark.triangle", color: Theme.statusAmber,
                                                         title: problems.joined(separator: "\n"))
        }
    }

    private func row(_ simulator: SimulatorSummary) -> some View {
        CardRow(icon: simulator.icon, iconColor: simulator.booted ? Theme.statusEmerald : Theme.textMuted,
                title: simulator.name, subtitle: [simulator.version, simulator.booted ? "Running" : nil].compactMap { $0 }.joined(separator: " · ")) {
            HStack(spacing: 8) {
                if busy.contains(simulator.id) {
                    ProgressView()
                } else {
                    if simulator.viewable {
                        Button("View") { viewing = simulator }
                    }
                    if canDrive == true {
                        Button(simulator.booted ? "Shut down" : "Start") { Task { await toggle(simulator) } }
                            .tint(simulator.booted ? Theme.statusRed : Theme.accent)
                    }
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    private func load() async {
        do {
            state = try await api.simulators()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ simulator: SimulatorSummary) async {
        busy.insert(simulator.id)
        defer { busy.remove(simulator.id) }
        do {
            if simulator.booted {
                _ = try await api.shutdownSimulator(simulator.id)
            } else {
                _ = try await api.bootSimulator(simulator.id)
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        await load()
    }
}
