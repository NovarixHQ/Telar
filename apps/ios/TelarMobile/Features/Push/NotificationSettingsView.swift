import ActivityKit
import SwiftUI
import UserNotifications

struct NotificationSettingsView: View {
    @State private var notifications = MobileNotifications.shared
    @State private var systemDenied = false
    @State private var activitiesAllowed = true
    @State private var pickingSound = false
    @Environment(\.scenePhase) private var scenePhase

    private var enabled: Binding<Bool> {
        Binding(get: { notifications.enabled }, set: { value in
            Task {
                if value { await notifications.enable() } else { notifications.enabled = false; await notifications.syncRegistrations() }
                await refreshSystemState()
            }
        })
    }

    private func synced(_ keyPath: ReferenceWritableKeyPath<MobileNotifications, Bool>) -> Binding<Bool> {
        Binding(get: { notifications[keyPath: keyPath] }, set: { value in
            notifications[keyPath: keyPath] = value
            Task {
                if keyPath == \.previews { await notifications.refreshActivityPrivacy() }
                await notifications.syncRegistrations()
            }
        })
    }

    private var liveActivities: Binding<Bool> {
        Binding(get: { notifications.liveActivities }, set: { value in Task { await notifications.setLiveActivities(value) } })
    }

    private var alertsError: (String, SettingsFix)? {
        if systemDenied { return ("Notifications are off for Telar in iOS Settings.", .openSystemSettings) }
        guard notifications.enabled, !notifications.readiness.isEmpty else { return nil }
        let line = notifications.readiness.statusLine(enabled: true, allowed: true)
        return (line, SettingsFix(title: "Try again") { Task { await notifications.syncRegistrations() } })
    }

    private var lockScreenError: (String, SettingsFix?)? {
        guard notifications.liveActivities else { return nil }
        if !activitiesAllowed { return ("Live Activities are off for Telar in iOS Settings.", .openSystemSettings) }
        return LiveActivityDiagnosis.refusal(notifications.cardReport).map { ($0, nil) }
    }

    var body: some View {
        SettingsPage(title: "Notifications") {
            SettingsGroup(
                label: "Alerts",
                footer: "Mute a single session from its menu.",
                error: alertsError?.0,
                fix: alertsError?.1
            ) {
                CardToggleRow(icon: "bell", title: "Notifications", isOn: enabled)
                if notifications.enabled {
                    CardDivider()
                    CardToggleRow(icon: "checkmark.circle", title: "Work completed", isOn: synced(\.completions))
                    CardDivider()
                    CardToggleRow(icon: "text.bubble", title: "Show session titles", isOn: synced(\.previews))
                    CardDivider()
                    CardValueRow(icon: "speaker.wave.2", title: "Sound", value: notifications.sounds.label) { pickingSound = true }
                }
            }

            SettingsGroup(
                label: "Lock screen",
                footer: "One card for the work on all your Macs. It starts when you open Telar.",
                error: lockScreenError?.0,
                fix: lockScreenError?.1
            ) {
                CardToggleRow(icon: "rectangle.badge.checkmark", title: "Live Activity", isOn: liveActivities)
            }
        }
        .navigationDestination(isPresented: $pickingSound) { NotificationSoundView() }
        .task {
            await refreshSystemState()
            await notifications.syncRegistrations()
            await notifications.refreshCardReport()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshSystemState() } }
        }
    }

    private func refreshSystemState() async {
        systemDenied = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
        activitiesAllowed = ActivityAuthorizationInfo().areActivitiesEnabled
    }
}

private struct NotificationSoundView: View {
    @State private var notifications = MobileNotifications.shared

    var body: some View {
        SettingsPage(title: "Sound") {
            SettingsGroup(footer: "Plays when work finishes, needs you or fails.") {
                ForEach(Array(NotificationSound.allCases.enumerated()), id: \.element) { index, sound in
                    if index > 0 { CardDivider() }
                    Button {
                        notifications.sounds = sound
                        SoundPreview.play(sound)
                        Task { await notifications.syncRegistrations() }
                    } label: {
                        CardRow(icon: sound == .off ? "speaker.slash" : "music.note", title: sound.label) {
                            if notifications.sounds == sound {
                                Image(systemName: "checkmark").foregroundStyle(Theme.accent)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
