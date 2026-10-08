import SwiftUI

struct PanelTabStrip: View {
    let tabs: [PanelTab]
    let active: PanelTab?
    let openable: [PanelTab]
    let label: (PanelTab) -> String
    let select: (PanelTab) -> Void
    let close: (PanelTab) -> Void
    let open: (PanelTab) -> Void

    private enum Labels { case all, selected }

    var body: some View {
        HStack(spacing: 2) {
            ViewThatFits(in: .horizontal) {
                row(.all)
                row(.selected)
                ScrollView(.horizontal, showsIndicators: false) { row(.selected) }
            }
            if !openable.isEmpty { chooser }
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

    private var chooser: some View {
        Menu {
            ForEach(openable) { tab in
                Button(label(tab), systemImage: tab.icon) { open(tab) }
            }
        } label: {
            Image(systemName: "plus")
                .foregroundStyle(Theme.textMuted)
                .scaledGlyphBox(32, glyph: 13, weight: .semibold)
        }
        .accessibilityLabel("Open a surface")
    }

    private static func short(_ text: String) -> String {
        text.count > 22 ? text.prefix(21) + "…" : text
    }

    private func pill(_ tab: PanelTab, labeled: Bool) -> some View {
        let selected = tab == active
        return HStack(spacing: 0) {
            Button { select(tab) } label: {
                HStack(spacing: 6) {
                    Image(systemName: tab.icon)
                        .font(.system(Theme.footnote, weight: selected ? .semibold : .medium))
                    if labeled {
                        Text(Self.short(label(tab)))
                            .font(.system(Theme.footnote, weight: selected ? .semibold : .medium))
                            .lineLimit(1)
                    }
                }
                .padding(.leading, labeled ? 11 : 0)
                .padding(.trailing, selected ? 4 : labeled ? 11 : 0)
                .frame(minWidth: labeled || selected ? nil : 34)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(label(tab)) tab")
            .accessibilityAddTraits(selected ? .isSelected : [])
            if selected {
                Button { close(tab) } label: {
                    Image(systemName: "xmark")
                        .font(.system(Theme.captionTiny, weight: .bold))
                        .foregroundStyle(Theme.textMuted)
                        .frame(width: 22)
                        .frame(maxHeight: .infinity)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 4)
                .accessibilityLabel("Close \(label(tab))")
            }
        }
        .foregroundStyle(selected ? Theme.text : Theme.textMuted)
        .scaledHeight(32, relativeTo: .footnote)
        .background {
            if selected {
                RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                    .fill(Theme.card)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                        .strokeBorder(Theme.border, lineWidth: 1))
                    .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
            }
        }
        .contextMenu {
            Button("Close \(label(tab))", systemImage: "xmark") { close(tab) }
        }
    }
}
