import SwiftUI

struct SettingsView: View {
    let settings: AppSettings
    let inbox: MergedInbox
    @State private var pushTarget: PushTarget?
    @State private var openDevicesSeed = UserDefaults.standard.bool(forKey: "openDevices")
    @State private var notifications = MobileNotifications.shared

    enum PushTarget: Hashable {
        case general
        case appearance
        case notifications
        case host(HostID)
        case addMac
        case devices(HostID)
    }

    private var showsAppearance: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    private var notificationsSummary: String {
        let alerts = notifications.enabled ? "On" : "Off"
        return notifications.liveActivities ? "\(alerts) · Live Activity on" : alerts
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        guard let build = info?["CFBundleVersion"] as? String else { return short }
        return "\(short) (\(build))"
    }

    var body: some View {
        SettingsPage(title: "Settings") {
            SettingsCard {
                CardNavRow(icon: "gearshape", title: "General", subtitle: "Session list") { pushTarget = .general }
                if showsAppearance {
                    CardDivider()
                    CardNavRow(icon: "paintbrush", title: "Appearance", subtitle: "Chat width") { pushTarget = .appearance }
                }
                CardDivider()
                CardNavRow(icon: "bell.badge", title: "Notifications", subtitle: notificationsSummary) {
                    pushTarget = .notifications
                }
            }

            SettingsGroup(label: "Connections", footer: "Every computer pairs with its own key. Sessions from all of them share the inbox.") {
                ForEach(settings.hosts) { host in
                    CardNavRow(
                        icon: "desktopcomputer",
                        title: host.name,
                        subtitle: (settings.token(for: host.id) != nil ? "Paired · " : "Open · ")
                            + (host.baseURL?.host() ?? host.baseURLString)
                    ) { pushTarget = .host(host.id) }
                    CardDivider()
                }
                CardNavRow(icon: "plus.circle.fill", title: "Add a computer", subtitle: "Scan a pairing code or connect by address") {
                    pushTarget = .addMac
                }
            }

            SettingsGroup(label: "About") {
                CardValueRow(icon: "info.circle", title: "Version", value: version)
                CardDivider()
                ShareLink(item: ConnectionLogExport(names: settings.connectionLogNames), preview: SharePreview("Connection log")) {
                    CardRow(icon: "waveform.path.ecg", title: "Export connection log", subtitle: "The last 500 requests to each computer") {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(Theme.footnote, weight: .medium))
                            .foregroundStyle(Theme.chevron)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .navigationDestination(item: $pushTarget) { target in
            switch target {
            case .general:
                GeneralSettingsView(settings: settings, inbox: inbox)
            case .appearance:
                AppearanceSettingsView()
            case .notifications:
                NotificationSettingsView()
            case .host(let id):
                HostSettingsView(settings: settings, hostId: id)
            case .addMac:
                ConnectView(settings: settings, target: .new)
            case .devices(let id):
                if let api = settings.api(for: id) {
                    DevicesView(api: api)
                }
            }
        }
        .task {
            if openDevicesSeed, let first = settings.hosts.first {
                openDevicesSeed = false
                pushTarget = .devices(first.id)
            }
        }
    }
}

struct GeneralSettingsView: View {
    let settings: AppSettings
    let inbox: MergedInbox
    @State private var modeFailed = false

    private var sidebarMode: Binding<SidebarMode> {
        Binding(get: { inbox.mode }, set: { next in
            Task {
                modeFailed = !(await inbox.setMode(next) { host, mode in
                    try await settings.api(for: host)?.setSidebarLayout(mode: mode)
                })
            }
        })
    }

    var body: some View {
        SettingsPage(title: "General") {
            SettingsGroup(
                label: "Session list",
                footer: "Applies on every computer you are paired with.",
                error: modeFailed ? "Couldn't save on every computer. Try again when they are connected." : nil
            ) {
                CardRow(icon: "list.bullet.indent", title: "Group by") {
                    Picker("Group by", selection: sidebarMode) {
                        ForEach(SidebarMode.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
            }
        }
    }
}

struct AppearanceSettingsView: View {
    @AppStorage(ChatWidth.storageKey) private var chatWidth = ChatWidth.comfortable

    var body: some View {
        SettingsPage(title: "Appearance") {
            SettingsGroup(label: "Conversation", footer: "How wide the conversation and the composer can grow.") {
                CardRow(icon: "arrow.left.and.right", title: "Chat width") {
                    Picker("Chat width", selection: $chatWidth) {
                        ForEach(ChatWidth.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
            }
        }
    }
}
