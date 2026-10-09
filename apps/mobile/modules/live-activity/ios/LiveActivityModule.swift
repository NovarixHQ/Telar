import ActivityKit
import ExpoModulesCore

public final class LiveActivityModule: Module {
  private static let cardId = "__card__"
  private var watchers: [String: [Task<Void, Never>]] = [:]
  private var tokens: [String: String] = [:]

  public func definition() -> ModuleDefinition {
    Name("TelarLiveActivity")
    Events("onPushToken", "onStateChange")

    OnCreate { for activity in self.live { self.watch(activity) } }
    OnDestroy { self.watchers.values.flatMap { $0 }.forEach { $0.cancel() } }

    Function("enabled") { ActivityAuthorizationInfo().areActivitiesEnabled }

    Function("card") { () -> [String: Any]? in
      guard let card = self.card else { return nil }
      return ["id": card.id, "token": self.tokens[card.id] as Any]
    }

    Function("start") { (state: String, staleSeconds: Double) throws -> String in
      let content = try Self.decode(state)
      let activity = try Activity.request(
        attributes: SessionActivityAttributes(hostId: "", sessionId: Self.cardId, hostName: "Telar"),
        content: ActivityContent(state: content, staleDate: Date().addingTimeInterval(staleSeconds)),
        pushType: .token)
      self.watch(activity)
      return activity.id
    }

    AsyncFunction("conceal") { () async in
      guard let card = self.card else { return }
      var state = card.content.state
      state.title = "Telar work"
      state.rows = state.rows?.map { var row = $0; row.title = nil; return row }
      await card.update(ActivityContent(state: state, staleDate: card.content.staleDate))
    }

    AsyncFunction("endAll") { () async in
      for activity in Activity<SessionActivityAttributes>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
    }

    AsyncFunction("endOthers") { () async in
      let newest = Activity<SessionActivityAttributes>.activities.filter { $0.attributes.sessionId == Self.cardId }
        .max { ($0.content.state.startedAt, $0.id) < ($1.content.state.startedAt, $1.id) }
      for activity in Activity<SessionActivityAttributes>.activities where activity.id != newest?.id {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  private var live: [Activity<SessionActivityAttributes>] {
    Activity<SessionActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
  }
  private var card: Activity<SessionActivityAttributes>? { live.first { $0.attributes.sessionId == Self.cardId } }

  private static func decode(_ json: String) throws -> SessionActivityAttributes.ContentState {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .secondsSince1970
    return try decoder.decode(SessionActivityAttributes.ContentState.self, from: Data(json.utf8))
  }

  private func watch(_ activity: Activity<SessionActivityAttributes>) {
    guard watchers[activity.id] == nil else { return }
    if let data = activity.pushToken { tokens[activity.id] = Self.hex(data) }
    let states = Task { [weak self] in
      for await state in activity.activityStateUpdates {
        self?.sendEvent("onStateChange", ["id": activity.id, "state": "\(state)"])
        if state == .ended || state == .dismissed {
          self?.tokens[activity.id] = nil
          self?.watchers.removeValue(forKey: activity.id)?.forEach { $0.cancel() }
          break
        }
      }
    }
    let pushTokens = Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        guard !Task.isCancelled else { break }
        self?.tokens[activity.id] = Self.hex(data)
        self?.sendEvent("onPushToken", ["id": activity.id, "token": Self.hex(data)])
      }
    }
    watchers[activity.id] = [states, pushTokens]
  }

  private static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
}
