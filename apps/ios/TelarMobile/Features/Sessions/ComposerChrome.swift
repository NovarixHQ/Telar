import SwiftUI

struct ComposerScrim: View {
    var body: some View {
        Rectangle()
            .fill(.bar)
            .mask {
                LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.35)],
                               startPoint: .top, endPoint: .bottom)
            }
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)
    }
}

struct StatusCard<Content: View>: View {
    let tint: Color
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.06))
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )
    }
}
