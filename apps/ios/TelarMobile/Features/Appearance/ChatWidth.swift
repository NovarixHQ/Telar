import SwiftUI
import UIKit

enum ChatWidth: String, CaseIterable, Identifiable {
    case comfortable, wide, full

    static let storageKey = "telar.chatWidth"

    var id: Self { self }
    var label: String { rawValue.capitalized }

    var measure: CGFloat {
        switch self {
        case .comfortable: 680
        case .wide: 980
        case .full: .infinity
        }
    }

    /// The widest the conversation lane may grow inside `available` points less `margins` on each side.
    /// The setting applies only on an iPad at regular width; elsewhere the lane is Comfortable.
    static func lane(_ setting: ChatWidth, available: CGFloat, margins: CGFloat, pad: Bool, sizeClass: UserInterfaceSizeClass?) -> CGFloat {
        let chosen = pad && sizeClass == .regular ? setting : .comfortable
        return max(0, min(chosen.measure, available - 2 * margins))
    }
}

private struct ReadingColumn: ViewModifier {
    let margins: CGFloat
    @AppStorage(ChatWidth.storageKey) private var setting = ChatWidth.comfortable
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var available = CGFloat.infinity

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, margins)
            .frame(maxWidth: ChatWidth.lane(setting, available: available, margins: margins,
                                            pad: UIDevice.current.userInterfaceIdiom == .pad, sizeClass: sizeClass) + 2 * margins)
            .frame(maxWidth: .infinity)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { available = $0 }
    }
}

extension View {
    /// Centres the conversation lane at the chosen Chat width, keeping `margins` clear on each side.
    func readingColumn(margins: CGFloat = 0) -> some View {
        modifier(ReadingColumn(margins: margins))
    }
}
