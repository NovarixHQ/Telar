import SwiftUI

struct SessionFamilyToggle: View {
    let family: SessionFamily
    let open: Bool
    let toggle: () -> Void

    var body: some View {
        Button {
            withAnimation(.snappy(duration: 0.2)) { toggle() }
        } label: {
            HStack(spacing: 2) {
                if family.needsYou > 0 { Circle().fill(Theme.statusRed).frame(width: 6, height: 6) }
                Text("\(family.children.count)").monospacedDigit()
                Image(systemName: "chevron.down").rotationEffect(.degrees(open ? 0 : -90))
            }
            .font(.caption2).foregroundStyle(Theme.textMuted.opacity(0.7))
            .padding(.horizontal, 4).padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("\(open ? "Hide" : "Show") \(Self.summary(family))")
    }

    static func summary(_ family: SessionFamily) -> String {
        let count = family.children.count
        var parts = ["\(count) \(count == 1 ? "session" : "sessions")"]
        if family.working > 0 { parts.append("\(family.working) working") }
        if family.needsYou > 0 { parts.append("\(family.needsYou) \(family.needsYou == 1 ? "needs" : "need") you") }
        return parts.joined(separator: " · ")
    }
}

struct SessionStatusSlot: View {
    let session: Session

    var body: some View {
        let now = Timestamp(Date().timeIntervalSince1970 * 1000)
        if let until = session.snoozedUntil, until > now, session.activity != .blocked {
            HStack(spacing: 3) {
                Image(systemName: "alarm").font(.system(Theme.captionTiny))
                Text(relativeTime(until)).monospacedDigit()
            }
            .font(.caption2).foregroundStyle(Theme.textMuted.opacity(0.7))
        } else if session.activity == .blocked {
            HStack(spacing: 3) {
                Image(systemName: "circle.circle").font(.system(Theme.captionTiny))
                Text("Needs you")
            }
            .font(.caption2.weight(.medium)).foregroundStyle(Theme.statusAmber)
        } else if session.activity == .working || session.activity == .queued {
            HStack(spacing: 3) {
                SteppedPulseDot(color: Theme.statusSky)
                Text(session.activity == .queued ? "Queued" : "Working")
            }
            .font(.caption2.weight(.medium)).foregroundStyle(Theme.statusSky)
        } else if session.activity == .monitoring {
            Text("Monitoring").font(.caption2.weight(.medium)).foregroundStyle(Theme.statusSky)
        } else if session.lastTurnFailed == true {
            Text("Failed").font(.caption2.weight(.medium)).foregroundStyle(Theme.statusRed)
        } else {
            Text(relativeTime(session.activityAt ?? session.updatedAt))
                .font(.caption2).foregroundStyle(Theme.textMuted.opacity(0.7)).monospacedDigit()
        }
    }
}

struct UnreadDot: View {
    let session: Session

    var body: some View {
        if Settling.showsUnreadMark(session) {
            Circle().fill(Theme.accent).frame(width: 6, height: 6)
                .accessibilityLabel("Unread answer")
        }
    }
}
