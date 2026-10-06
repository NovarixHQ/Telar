import CoreGraphics
import Testing
@testable import TelarMobile

struct SimulatorScreenMappingTests {
    private let frame = CGSize(width: 100, height: 200)

    private func screen(_ orientation: SimulatorOrientation, width: Double = 100, height: Double = 200) -> SimulatorScreen {
        SimulatorScreen(width: width, height: height, orientation: orientation)
    }

    @Test func aPortraitFrameIsLetterboxedAndCentred() {
        let mapping = SimulatorScreenMapping(frame: frame, screen: screen(.portrait))
        #expect(mapping.rotation == 0)
        #expect(mapping.fitted(in: CGSize(width: 400, height: 400)) == CGRect(x: 100, y: 0, width: 200, height: 400))
    }

    @Test func aTouchMapsToFramebufferUnits() {
        let mapping = SimulatorScreenMapping(frame: frame, screen: screen(.portrait))
        let container = CGSize(width: 400, height: 400)
        #expect(mapping.devicePoint(CGPoint(x: 150, y: 100), in: container) == CGPoint(x: 0.25, y: 0.25))
        #expect(mapping.devicePoint(CGPoint(x: 0, y: 500), in: container) == CGPoint(x: 0, y: 1))
    }

    @Test func landscapeLeftTurnsThePortraitFrameClockwise() {
        let mapping = SimulatorScreenMapping(frame: frame, screen: screen(.landscapeLeft))
        let container = CGSize(width: 200, height: 100)
        #expect(mapping.rotation == 90)
        #expect(mapping.displayedSize == CGSize(width: 200, height: 100))
        #expect(mapping.fitted(in: container) == CGRect(x: 0, y: 0, width: 200, height: 100))
        #expect(mapping.devicePoint(CGPoint(x: 0, y: 0), in: container) == CGPoint(x: 0, y: 1))
        #expect(mapping.devicePoint(CGPoint(x: 200, y: 0), in: container) == CGPoint(x: 0, y: 0))
        #expect(mapping.devicePoint(CGPoint(x: 50, y: 25), in: container) == CGPoint(x: 0.25, y: 0.75))
    }

    @Test func landscapeRightTurnsThePortraitFrameAnticlockwise() {
        let mapping = SimulatorScreenMapping(frame: frame, screen: screen(.landscapeRight))
        let container = CGSize(width: 200, height: 100)
        #expect(mapping.rotation == -90)
        #expect(mapping.devicePoint(CGPoint(x: 0, y: 0), in: container) == CGPoint(x: 1, y: 0))
        #expect(mapping.devicePoint(CGPoint(x: 50, y: 25), in: container) == CGPoint(x: 0.75, y: 0.25))
    }

    @Test func upsideDownFlipsBothAxes() {
        let mapping = SimulatorScreenMapping(frame: frame, screen: screen(.portraitUpsideDown))
        #expect(mapping.rotation == 180)
        #expect(mapping.devicePoint(CGPoint(x: 25, y: 50), in: CGSize(width: 100, height: 200)) == CGPoint(x: 0.75, y: 0.75))
    }

    @Test func aFramebufferThatIsAlreadyLandscapeIsDrawnAsIs() {
        let mapping = SimulatorScreenMapping(frame: CGSize(width: 200, height: 100), screen: screen(.landscapeLeft, width: 200, height: 100))
        #expect(mapping.rotation == 0)
        #expect(mapping.devicePoint(CGPoint(x: 50, y: 25), in: CGSize(width: 200, height: 100)) == CGPoint(x: 0.25, y: 0.25))
    }

    @Test func withoutAScreenConfigTheFrameIsTreatedAsPortrait() {
        let mapping = SimulatorScreenMapping(frame: frame, screen: nil)
        #expect(mapping.rotation == 0)
        #expect(mapping.devicePoint(.zero, in: .zero) == nil)
    }
}
