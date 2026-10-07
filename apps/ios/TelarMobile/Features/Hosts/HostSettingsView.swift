import SwiftUI

struct HostSettingsView: View {
    let settings: AppSettings
    let hostId: HostID
    @State private var nameDraft = ""
    @State private var confirmRemove = false
    @State private var push: Destination?
    @Environment(\.dismiss) private var dismiss

    enum Destination: Hashable { case connection, devices, dictation, simulators }

    private var host: Host? { settings.host(hostId) }

    private var address: String? {
        guard let url = host?.baseURL, let name = url.host() else { return host?.baseURLString }
        return url.port.map { "\(name):\($0)" } ?? name
    }

    var body: some View {
        SettingsPage(title: host?.name ?? "Computer") {
            SettingsGroup(label: "Name", footer: "Shown on inbox rows and menus.") {
                CardField(placeholder: host?.baseURL?.host() ?? "My computer", text: $nameDraft)
                    .submitLabel(.done)
                    .onSubmit(commitName)
            }

            SettingsGroup(label: "This computer") {
                CardNavRow(
                    icon: "server.rack",
                    title: "Connection",
                    subtitle: [address, settings.token(for: hostId) != nil ? "paired" : "open"].compactMap { $0 }.joined(separator: " · ")
                ) { push = .connection }
                if settings.api(for: hostId) != nil {
                    CardDivider()
                    CardNavRow(icon: "iphone.radiowaves.left.and.right", title: "Devices", subtitle: "Who may reach this computer") {
                        push = .devices
                    }
                    CardDivider()
                    CardNavRow(icon: "waveform", title: "Dictation", subtitle: "Speech to text") { push = .dictation }
                    CardDivider()
                    CardNavRow(icon: "iphone", title: "Simulators", subtitle: "Watch and drive its simulators") { push = .simulators }
                }
            }

            SettingsGroup(footer: "The Mac keeps running. Revoke this phone in its Devices settings.") {
                Button {
                    confirmRemove = true
                } label: {
                    CardRow(icon: "trash", iconColor: Theme.statusRed, title: "Remove this computer", titleColor: Theme.statusRed) { EmptyView() }
                }
                .buttonStyle(.plain)
            }
        }
        .navigationDestination(item: $push) { destination in
            switch destination {
            case .connection:
                ConnectView(settings: settings, target: .existing(hostId))
            case .devices:
                if let api = settings.api(for: hostId) { DevicesView(api: api) }
            case .dictation:
                if let api = settings.api(for: hostId) { DictationSettingsView(api: api) }
            case .simulators:
                if let api = settings.api(for: hostId) { SimulatorsView(api: api) }
            }
        }
        .onAppear { nameDraft = host?.name ?? "" }
        .onDisappear(perform: commitName)
        .confirmationDialog("Remove \(host?.name ?? "this computer")?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                settings.remove(hostId)
                dismiss()
            }
        } message: {
            Text("This phone forgets the credential and any pending drafts for it. Pair again anytime.")
        }
    }

    private func commitName() {
        guard let host, nameDraft != host.name else { return }
        settings.rename(hostId, to: nameDraft)
        nameDraft = settings.host(hostId)?.name ?? nameDraft
    }
}
