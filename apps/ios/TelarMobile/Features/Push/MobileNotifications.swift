import ActivityKit
import Observation
import UIKit
import UserNotifications

struct PushRegistration: Encodable {
    var hostId: String
    var token: String
    var topic: String
    var sandbox: Bool
    var enabled: Bool
    var completions: Bool
    var previews: Bool
    var sounds: String? = nil
    var mutedSessions: [String]
    var liveActivities: Bool = false
    var hostName: String? = nil
    var relay: RelayCredential? = nil
    var relayCard = true
    #if targetEnvironment(simulator)
    var simulator = true
    #endif
}
struct PushStatus: Decodable {
    var configured: Bool
}

@MainActor @Observable final class MobileNotifications {
    static let shared = MobileNotifications()
    var destination: ScopedSessionID?
    var visibleSession: ScopedSessionID?
    var settings: AppSettings?
    var status = "Notifications are off"
    var readiness = PushReadiness()
    var activityError: String?
    var cardReport: RelayCardReport?
    private var token: String? = UserDefaults.standard.string(forKey: "telar.apns.token")
    private var activityTokens: [String: String] = [:]
    private var watchers: [String: Task<Void, Never>] = [:]
    private var stateWatchers: [String: Task<Void, Never>] = [:]
    private let defaults = UserDefaults.standard
    private var registrations: [HostID: Task<Void, Never>] = [:]
    private var attemptedRegistration = false
    private var started = false
    private var cardDismissed = false
    var liveActivities = UserDefaults.standard.object(forKey: "telar.activities.enabled") as? Bool ?? true {
        didSet { defaults.set(liveActivities, forKey: "telar.activities.enabled") }
    }

    func start(settings: AppSettings) {
        self.settings = settings
        guard !started else { return }
        started = true
        defaults.removeObject(forKey: "telar.activity.rejectedStartTokens")
        Task { await syncRegistrations() }
        Task { await ReadSync.reconcile(settings: settings) }
    }
    func refreshCardReport() async { cardReport = await PushRelayClient.shared.cardReport() }
    func setLiveActivities(_ enabled: Bool) async {
        liveActivities = enabled
        if !enabled {
            for activity in Activity<SessionActivityAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        await syncRegistrations()
    }

    var enabled = UserDefaults.standard.bool(forKey: "telar.notifications.enabled") {
        didSet { defaults.set(enabled, forKey: "telar.notifications.enabled") }
    }
    var completions = UserDefaults.standard.object(forKey: "telar.notifications.completions") as? Bool ?? true {
        didSet { defaults.set(completions, forKey: "telar.notifications.completions") }
    }
    var previews = UserDefaults.standard.bool(forKey: "telar.notifications.previews") {
        didSet { defaults.set(previews, forKey: "telar.notifications.previews") }
    }
    var sounds = UserDefaults.standard.string(forKey: "telar.notifications.sounds").flatMap(NotificationSound.init(rawValue:)) ?? .hilo {
        didSet { defaults.set(sounds.rawValue, forKey: "telar.notifications.sounds") }
    }
    var muted = Set(UserDefaults.standard.stringArray(forKey: "telar.notifications.muted") ?? []) {
        didSet { defaults.set(Array(muted), forKey: "telar.notifications.muted") }
    }
    func isMuted(_ ref: ScopedSessionID) -> Bool { muted.contains(ref.url.absoluteString) }
    func toggleMute(_ ref: ScopedSessionID) async {
        var next = muted
        if next.contains(ref.url.absoluteString) { next.remove(ref.url.absoluteString) } else { next.insert(ref.url.absoluteString) }
        muted = next
        await syncRegistrations()
    }

    func enable() async {
        do {
            enabled = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            if enabled { UIApplication.shared.registerForRemoteNotifications(); status = "Connecting notifications…" }
            else { status = "Notifications are disabled in system Settings" }
        } catch { status = "Couldn't request notification permission" }
        await syncRegistrations()
    }
    func registered(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        defaults.set(token, forKey: "telar.apns.token")
        Task { await syncRegistrations() }
    }
    func syncRegistrations() async {
        await endOtherCards()
        for activity in Activity<SessionActivityAttributes>.activities where activity.activityState == .active || activity.activityState == .stale {
            watch(activity)
        }
        guard let settings else { return }
        if (enabled || liveActivities) && !attemptedRegistration {
            attemptedRegistration = true
            UIApplication.shared.registerForRemoteNotifications()
        }
        guard let token else {
            if PushRelayClient.shared.unavailable { status = PushReadiness.unsupportedLine }
            return
        }
        let authorization = await UNUserNotificationCenter.current().notificationSettings()
        let allowed = authorization.authorizationStatus == .authorized || authorization.authorizationStatus == .provisional
        let relayTokens = RelayTokens(token: token, card: liveCard.flatMap { activityTokens[$0.id] })
        let paired = Set(settings.hosts.map(\.id))
        readiness.forget(except: paired)
        for (id, running) in registrations where !paired.contains(id) { running.cancel() }
        registrations = registrations.filter { paired.contains($0.key) }
        let running = settings.hosts.compactMap { host in
            settings.api(for: host.id).map { register(host, api: $0, token: token, allowed: allowed, relayTokens: relayTokens) }
        }
        for task in running { await task.value }
    }

    private func register(_ host: Host, api: HTTPEngineAPI, token: String, allowed: Bool, relayTokens: RelayTokens) -> Task<Void, Never> {
        registrations[host.id]?.cancel()
        let mutedSessions = muted.compactMap { URL(string: $0).flatMap(ScopedSessionID.init(url:)) }.filter { $0.hostId == host.id }.map(\.sessionId)
        #if DEBUG
        let sandbox = true
        #else
        let sandbox = false
        #endif
        let registration = PushRegistration(hostId: host.id.uuidString, token: token,
            topic: Bundle.main.bundleIdentifier ?? "io.github.novarix.telar", sandbox: sandbox,
            enabled: enabled && allowed, completions: completions, previews: previews, sounds: sounds.rawValue,
            mutedSessions: mutedSessions,
            liveActivities: liveActivities && ActivityAuthorizationInfo().areActivitiesEnabled,
            hostName: host.name, relay: nil)
        let task = Task { [weak self] in
            var sent = registration
            sent.relay = await PushRelayClient.shared.credential(for: host.id.uuidString, tokens: relayTokens)
            let reply = try? await api.registerPush(sent)
            guard !Task.isCancelled, let self else { return }
            readiness.record(host.id, configured: reply?.configured)
            readiness.deviceUnsupported = PushRelayClient.shared.unavailable
            status = readiness.statusLine(enabled: enabled, allowed: allowed)
        }
        registrations[host.id] = task
        return task
    }

    private var liveCard: Activity<SessionActivityAttributes>? {
        Activity<SessionActivityAttributes>.activities.first {
            $0.attributes.sessionId == AutomaticCard.sessionId && ($0.activityState == .active || $0.activityState == .stale)
        }
    }

    func promptAfterPairing() async {
        guard NotificationPrompt.shouldAsk(asked: defaults.bool(forKey: NotificationPrompt.askedKey), enabled: enabled) else {
            await syncRegistrations()
            return
        }
        defaults.set(true, forKey: NotificationPrompt.askedKey)
        await enable()
    }

    func approve(_ approval: NotificationActions.Approval) async -> Bool {
        guard let api = settings?.api(for: approval.ref.hostId) else { return false }
        do {
            try await api.resolveRequest(approval.ref.sessionId, requestId: approval.requestId, decision: .accept, reason: nil, answers: nil)
            return true
        } catch {
            return false
        }
    }

    func refreshActivityPrivacy() async {
        guard !previews, let card = liveCard else { return }
        var state = card.content.state
        state.title = "Telar work"
        state.rows = state.rows?.map { var row = $0; row.title = nil; return row }
        await card.update(ActivityContent(state: state, staleDate: card.content.staleDate))
    }

    func startCard(_ active: [HostedSession], projectName: (HostedSession) -> String?) {
        guard UIApplication.shared.applicationState == .active else { return }
        let working = active.filter { AutomaticCard.isActive($0.session) }
        if working.isEmpty { cardDismissed = false; return }
        guard liveActivities, ActivityAuthorizationInfo().areActivitiesEnabled, !cardDismissed, liveCard == nil else { return }
        let projects = Dictionary(active.compactMap { s in projectName(s).map { (s.session.id, $0) } }, uniquingKeysWith: { first, _ in first })
        let names = Dictionary((settings?.hosts ?? []).map { ($0.id, HostLabel.short($0.name)) }, uniquingKeysWith: { first, _ in first })
        let now = Date()
        let state = AutomaticCard.initialState(active, names: names, previews: previews, projects: projects, now: now)
        do {
            let activity = try Activity.request(attributes: SessionActivityAttributes(hostId: "", sessionId: AutomaticCard.sessionId, hostName: "Telar"),
                                                content: ActivityContent(state: state, staleDate: now.addingTimeInterval(Self.activityStale)), pushType: .token)
            watch(activity)
        } catch { activityError = "Couldn't start a Live Activity: \(error.localizedDescription)" }
    }
    static let activityStale: TimeInterval = 600
    func removeHost(_ host: HostID, api: HTTPEngineAPI?) async {
        if let token, let api {
            #if DEBUG
            let sandbox = true
            #else
            let sandbox = false
            #endif
            _ = try? await api.registerPush(.init(hostId: host.uuidString, token: token,
                topic: Bundle.main.bundleIdentifier ?? "io.github.novarix.telar", sandbox: sandbox,
                enabled: false, completions: false, previews: false, mutedSessions: []))
        }
        await PushRelayClient.shared.revoke(host: host.uuidString)
    }
    private func endOtherCards() async {
        let newest = Activity<SessionActivityAttributes>.activities.filter { $0.attributes.sessionId == AutomaticCard.sessionId }
            .max { ($0.content.state.startedAt, $0.id) < ($1.content.state.startedAt, $1.id) }
        for activity in Activity<SessionActivityAttributes>.activities where activity.id != newest?.id {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
    private func watch(_ activity: Activity<SessionActivityAttributes>) {
        if !liveActivities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
            return
        }
        if let data = activity.pushToken { activityTokens[activity.id] = data.map { String(format: "%02x", $0) }.joined() }
        guard watchers[activity.id] == nil else { return }
        stateWatchers[activity.id] = Task { [weak self] in
            for await state in activity.activityStateUpdates {
                if state == .dismissed { self?.cardDismissed = true }
                if state == .ended || state == .dismissed {
                    self?.activityTokens[activity.id] = nil
                    self?.watchers.removeValue(forKey: activity.id)?.cancel()
                    self?.stateWatchers[activity.id] = nil
                    await self?.syncRegistrations()
                    break
                }
            }
        }
        watchers[activity.id] = Task { [weak self] in
            for await data in activity.pushTokenUpdates {
                guard !Task.isCancelled else { break }
                self?.activityTokens[activity.id] = data.map { String(format: "%02x", $0) }.joined()
                await self?.syncRegistrations()
            }
        }
    }
}

final class MobileAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().setNotificationCategories(NotificationActions.categories)
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in MobileNotifications.shared.registered(deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in
            MobileNotifications.shared.status = PushRelayClient.shared.unavailable
                ? PushReadiness.unsupportedLine : "Push registration failed. Check network and signing."
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == NotificationActions.approve,
           let approval = NotificationActions.approval(from: response.notification.request.content.userInfo) {
            Task { @MainActor in
                if !(await MobileNotifications.shared.approve(approval)) { await NotificationActions.reportFailure(approval, sound: MobileNotifications.shared.sounds) }
                completionHandler()
            }
            return
        }
        let url = (response.notification.request.content.userInfo["url"] as? String).flatMap(URL.init(string:))
        Task { @MainActor in
            let ref = url.flatMap(ScopedSessionID.init(url:))
            if let ref { MobileNotifications.shared.destination = ref }
            completionHandler()
            if let ref { await ReadSync.clearDelivered([ref]) }
        }
    }
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        let reads = Set(ReadSync.reads(from: userInfo))
        guard !reads.isEmpty else { completionHandler(.noData); return }
        Task {
            completionHandler(await ReadSync.clearDelivered(reads) ? .newData : .noData)
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let url = (notification.request.content.userInfo["url"] as? String).flatMap(URL.init(string:))
        Task { @MainActor in
            let ref = url.flatMap(ScopedSessionID.init(url:))
            completionHandler(ref != nil && ref == MobileNotifications.shared.visibleSession ? [] : [.banner, .sound])
        }
    }
}
