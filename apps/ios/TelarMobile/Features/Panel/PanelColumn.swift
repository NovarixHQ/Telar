import SwiftUI

enum PanelWidth {
    static let key = "telar.panel.width"
    static let ideal: Double = 440
    static let min: Double = 320
    static let chatFloor: Double = 560

    static func clamp(_ width: Double, total: Double) -> Double {
        let max = Swift.max(min, Swift.min(720, total - chatFloor))
        return Swift.min(Swift.max(width, min), max)
    }
}

struct PanelColumn<Panel: View>: ViewModifier {
    let shown: Bool
    let full: Bool
    @Binding var width: Double
    @ViewBuilder let panel: () -> Panel
    @State private var dragStart: Double?

    func body(content: Content) -> some View {
        GeometryReader { geometry in
            let total = geometry.size.width
            let column = full ? total : PanelWidth.clamp(width, total: total)
            HStack(spacing: 0) {
                content
                    .frame(width: shown ? Swift.max(0, total - column) : total)
                    .opacity(shown && full ? 0 : 1)
                    .accessibilityHidden(shown && full)
                if shown {
                    panel()
                        .frame(width: column)
                        .background(Theme.sheet)
                        .overlay(alignment: .leading) {
                            Rectangle().fill(Theme.borderSubtle).frame(width: 1)
                            if !full { handle(total: total) }
                        }
                        .transition(.move(edge: .trailing))
                }
            }
        }
        .animation(.snappy(duration: 0.3), value: shown)
        .animation(.snappy(duration: 0.3), value: full)
    }

    private func handle(total: Double) -> some View {
        Capsule()
            .fill(Theme.textMuted.opacity(dragStart == nil ? 0.35 : 0.7))
            .frame(width: 4, height: 36)
            .frame(width: 16)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .offset(x: -8)
            .gesture(
                DragGesture(minimumDistance: 2, coordinateSpace: .global)
                    .onChanged { value in
                        let start = dragStart ?? PanelWidth.clamp(width, total: total)
                        if dragStart == nil { dragStart = start }
                        width = PanelWidth.clamp(start - value.translation.width, total: total)
                    }
                    .onEnded { _ in dragStart = nil }
            )
            .accessibilityElement()
            .accessibilityLabel("Panel width")
            .accessibilityValue("\(Int(PanelWidth.clamp(width, total: total))) points")
            .accessibilityAdjustableAction { direction in
                let step: Double = direction == .increment ? 40 : -40
                width = PanelWidth.clamp(width + step, total: total)
            }
    }
}

extension View {
    func panelColumn<Panel: View>(shown: Bool, full: Bool, width: Binding<Double>, @ViewBuilder panel: @escaping () -> Panel) -> some View {
        modifier(PanelColumn(shown: shown, full: full, width: width, panel: panel))
    }
}
