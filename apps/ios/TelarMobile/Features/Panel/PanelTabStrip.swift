import SwiftUI

struct PanelTabStrip: View {
    let tabs: [PanelTab]
    let active: PanelTab
    let select: (PanelTab) -> Void

    private enum Labels { case all, selected }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row(.all)
            row(.selected)
            ScrollView(.horizontal, showsIndicators: false) { row(.selected) }
        }
    }

    private func row(_ labels: Labels) -> some View {
        HStack(spacing: 2) {
            ForEach(tabs) { tab in
                pill(tab, labeled: labels == .all || tab == active)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func pill(_ tab: PanelTab, labeled: Bool) -> some View {
        let selected = tab == active
        return Button { select(tab) } label: {
            HStack(spacing: 6) {
                Image(systemName: tab.icon)
                    .font(.system(Theme.footnote, weight: selected ? .semibold : .medium))
                if labeled {
                    Text(tab.label)
                        .font(.system(Theme.footnote, weight: selected ? .semibold : .medium))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(selected ? Theme.text : Theme.textMuted)
            .padding(.horizontal, labeled ? 11 : 0)
            .scaledHeight(32, relativeTo: .footnote)
            .frame(minWidth: labeled ? nil : 34)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                        .fill(Theme.card)
                        .overlay(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                            .strokeBorder(Theme.border, lineWidth: 1))
                        .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(tab.label) tab")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
