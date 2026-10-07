import SwiftUI
import UIKit

struct SettingsCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

struct SettingsSectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.system(Theme.footnote, weight: .semibold))
            .kerning(0.6)
            .foregroundStyle(Theme.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
    }
}

struct SettingsFootnote: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(Theme.footnote))
            .foregroundStyle(Theme.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 8)
    }
}

struct SettingsPage<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(spacing: 24) { content }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 32)
        }
        .background(Theme.sheet)
        .navigationTitle(title)
    }
}

struct SettingsFix {
    let title: String
    let action: () -> Void

    @MainActor static let openSystemSettings = SettingsFix(title: "Open Settings") {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }
}

struct SettingsGroup<Content: View>: View {
    var label: String?
    var footer: String?
    var error: String?
    var fix: SettingsFix?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            if let label { SettingsSectionLabel(label) }
            SettingsCard { content }
            if let error {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    VStack(alignment: .leading, spacing: 4) {
                        Text(error).fixedSize(horizontal: false, vertical: true)
                        if let fix {
                            Button(fix.title, action: fix.action)
                                .font(.system(Theme.footnote, weight: .semibold))
                                .foregroundStyle(Theme.accent)
                        }
                    }
                }
                .font(.system(Theme.footnote))
                .foregroundStyle(Theme.statusRed)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 8)
            } else if let footer {
                SettingsFootnote(footer)
            }
        }
    }
}

struct CardToggleRow: View {
    let icon: String
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        CardRow(icon: icon, title: title) {
            Toggle(title, isOn: $isOn).labelsHidden()
        }
    }
}

struct CardValueRow: View {
    let icon: String
    let title: String
    let value: String
    var action: (() -> Void)?

    var body: some View {
        let row = CardRow(icon: icon, title: title) {
            HStack(spacing: 6) {
                Text(value)
                    .font(.system(.callout))
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
                if action != nil {
                    Image(systemName: "chevron.right")
                        .font(.system(Theme.footnote, weight: .medium))
                        .foregroundStyle(Theme.chevron)
                }
            }
        }
        if let action {
            Button(action: action) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }
}

struct CardDivider: View {
    var body: some View {
        Rectangle().fill(Theme.borderSubtle).frame(height: 1)
    }
}

struct CardRow<Trailing: View>: View {
    let icon: String
    var iconColor: Color = Theme.textMuted
    let title: String
    var titleColor: Color = Theme.text
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(iconColor)
                .scaledGlyphBox(27, glyph: 17)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(.callout, weight: .semibold))
                    .foregroundStyle(titleColor)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(Theme.footnote))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

struct CardNavRow: View {
    let icon: String
    let title: String
    var subtitle: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            CardRow(icon: icon, title: title, subtitle: subtitle) {
                Image(systemName: "chevron.right")
                    .font(.system(Theme.footnote, weight: .medium))
                    .foregroundStyle(Theme.chevron)
            }
        }
        .buttonStyle(.plain)
    }
}

struct CardField: View {
    var label: String?
    let placeholder: String
    @Binding var text: String
    var mono = false
    var keyboard: UIKeyboardType = .default
    var secure = false
    var multiline = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let label {
                Text(label)
                    .font(.system(Theme.footnote, weight: .medium))
                    .foregroundStyle(Theme.textMuted)
            }
            Group {
                if secure {
                    SecureField(placeholder, text: $text)
                } else if multiline {
                    TextField(placeholder, text: $text, axis: .vertical).lineLimit(4...10)
                } else {
                    TextField(placeholder, text: $text)
                }
            }
            .font(mono ? .system(Theme.subhead, design: .monospaced) : .system(.callout))
            .foregroundStyle(Theme.text)
            .keyboardType(keyboard)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

struct PrimaryActionButton: View {
    let title: String
    var busy = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if busy {
                    ProgressView().tint(Theme.primaryGlyph)
                } else {
                    Text(title)
                        .font(.system(.callout, weight: .semibold))
                        .foregroundStyle(enabled ? Theme.primaryGlyph : Theme.textMuted)
                }
            }
            .frame(maxWidth: .infinity)
            .scaledHeight(50, relativeTo: .callout)
            .background(enabled ? AnyShapeStyle(Theme.primaryFill) : AnyShapeStyle(Theme.subtleStrong))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .disabled(!enabled || busy)
    }
}

struct StatusBanner: View {
    let icon: String
    let color: Color
    let title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .scaledGlyphBox(27, glyph: 17)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(Theme.subhead, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail {
                    Text(detail)
                        .font(.system(Theme.footnote))
                        .foregroundStyle(Theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}
