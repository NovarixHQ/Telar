import SwiftUI

struct PanelEmptyState: View {
    let offered: [PanelTab]
    let open: (PanelTab) -> Void
    @State private var width: CGFloat = 0

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Image(systemName: "rectangle.3.group")
                    .font(.system(Theme.subhead, weight: .medium))
                    .foregroundStyle(Theme.textMuted)
                    .scaledGlyphBox(36, glyph: 15)
                    .background(Theme.fill, in: Circle())
                Text("Open a surface")
                    .font(.system(Theme.subhead, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("Choose what to keep beside the conversation.")
                    .font(.system(Theme.footnote))
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: width >= 420 ? 2 : 1), spacing: 6) {
                    ForEach(offered) { card($0) }
                }
                .padding(.top, 12)
            }
            .frame(maxWidth: 560)
            .padding(16)
            .padding(.top, 24)
            .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private func card(_ tab: PanelTab) -> some View {
        Button { open(tab) } label: {
            HStack(spacing: 10) {
                Image(systemName: tab.icon)
                    .font(.system(Theme.footnote, weight: .medium))
                    .foregroundStyle(Theme.textMuted)
                    .scaledSquare(20)
                VStack(alignment: .leading, spacing: 1) {
                    Text(tab.label)
                        .font(.system(Theme.subhead, weight: .medium))
                        .foregroundStyle(Theme.text)
                    Text(tab.blurb)
                        .font(.system(Theme.caption))
                        .foregroundStyle(Theme.textMuted)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusCard, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusCard, style: .continuous).strokeBorder(Theme.borderSubtle, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Open \(tab.label)")
        .accessibilityHint(tab.blurb)
    }
}
