import CoreGraphics

struct SimulatorScreenMapping: Equatable {
    var frame: CGSize
    var orientation: SimulatorOrientation

    init(frame: CGSize, screen: SimulatorScreen?) {
        self.frame = frame
        let rawPortrait = screen.map { $0.width <= $0.height } ?? true
        orientation = rawPortrait ? screen?.orientation ?? .portrait : .portrait
    }

    var rotation: Double {
        switch orientation {
        case .portrait: 0
        case .landscapeLeft: 90
        case .landscapeRight: -90
        case .portraitUpsideDown: 180
        }
    }

    var sideways: Bool { abs(rotation) == 90 }

    var displayedSize: CGSize { sideways ? CGSize(width: frame.height, height: frame.width) : frame }

    func fitted(in container: CGSize) -> CGRect {
        let shown = displayedSize
        guard shown.width > 0, shown.height > 0, container.width > 0, container.height > 0 else { return .zero }
        let scale = min(container.width / shown.width, container.height / shown.height)
        let size = CGSize(width: shown.width * scale, height: shown.height * scale)
        return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2,
                      width: size.width, height: size.height)
    }

    func devicePoint(_ location: CGPoint, in container: CGSize) -> CGPoint? {
        let rect = fitted(in: container)
        guard rect.width > 0, rect.height > 0 else { return nil }
        let x = min(max((location.x - rect.minX) / rect.width, 0), 1)
        let y = min(max((location.y - rect.minY) / rect.height, 0), 1)
        switch orientation {
        case .portrait: return CGPoint(x: x, y: y)
        case .landscapeLeft: return CGPoint(x: y, y: 1 - x)
        case .landscapeRight: return CGPoint(x: 1 - y, y: x)
        case .portraitUpsideDown: return CGPoint(x: 1 - x, y: 1 - y)
        }
    }
}
