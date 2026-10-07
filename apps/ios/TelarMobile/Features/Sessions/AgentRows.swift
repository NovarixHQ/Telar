import SwiftUI

extension AgentTone {
    var color: Color {
        switch self {
        case .live: Theme.statusSky
        case .attention: Theme.statusAmber
        case .done: Theme.statusEmerald
        case .danger: Theme.statusRed
        case .quiet: Theme.textMuted
        }
    }
}

struct AgentSection<Rows: View>: View {
    let label: String
    let count: Int
    @ViewBuilder let rows: Rows

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(label)
                Text("\(count)").monospacedDigit()
            }
            .bandCaption()
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(label), \(count)")
            .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) { rows }
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusCard, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard, style: .continuous)
                    .strokeBorder(Theme.borderSubtle, lineWidth: 1))
        }
    }
}

struct AgentRow: View {
    let title: String
    let detail: String?
    let state: (label: String, tone: AgentTone)
    let activity: SessionActivity?
    let open: URL?
    var last = false
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .subheadline) private var dotLift: CGFloat = 5

    var body: some View {
        if let open {
            Button { openURL(open) } label: { content }
                .buttonStyle(RowButtonStyle())
                .accessibilityHint("Opens this conversation")
        } else {
            content
        }
    }

    private var content: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Group {
                if let activity {
                    ActivityBadge(activity: activity)
                } else {
                    Circle().fill(state.tone.color).frame(width: 7, height: 7).accessibilityHidden(true)
                }
            }
            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + dotLift }
            VStack(alignment: .leading, spacing: 3) {
                if typeSize.isAccessibilitySize {
                    titleText.lineLimit(nil)
                    stateCapsule
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        titleText.lineLimit(2)
                        Spacer(minLength: 0)
                        stateCapsule
                    }
                }
                if let detail {
                    Text(detail)
                        .font(.system(Theme.footnote))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(typeSize.isAccessibilitySize ? 4 : 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if open != nil {
                Image(systemName: "chevron.right")
                    .font(.system(Theme.caption, weight: .semibold))
                    .foregroundStyle(Theme.chevron.opacity(0.6))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(Theme.borderSubtle).frame(height: 1).padding(.leading, 31) }
        }
        .accessibilityElement(children: .combine)
    }
}

private extension AgentRow {
    var titleText: Text {
        Text(title).font(.system(Theme.subhead, weight: .medium)).foregroundStyle(Theme.text)
    }

    var stateCapsule: some View {
        Text(state.label)
            .font(.system(Theme.caption, weight: .semibold))
            .foregroundStyle(state.tone.color)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(state.tone.color.opacity(0.12), in: Capsule())
    }
}

struct AgentsEmpty: View {
    let failed: Bool

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.2")
                .font(.system(Theme.subhead, weight: .medium))
                .foregroundStyle(Theme.textMuted)
                .scaledGlyphBox(36, glyph: 15)
                .background(Theme.fill, in: Circle())
            Text("No other conversation is involved")
                .font(.system(Theme.subhead, weight: .semibold))
                .foregroundStyle(Theme.text)
            Text(failed ? "The computer did not answer — retrying." : "Conversations this one hands work to appear here.")
                .font(.system(Theme.footnote))
                .foregroundStyle(Theme.textMuted)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: 300)
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
        .accessibilityElement(children: .combine)
    }
}
