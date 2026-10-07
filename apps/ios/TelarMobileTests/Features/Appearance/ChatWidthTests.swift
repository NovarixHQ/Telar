import SwiftUI
import Testing
@testable import TelarMobile

@Suite struct ChatWidthTests {
    private func lane(_ setting: ChatWidth, _ available: CGFloat, margins: CGFloat = 16, pad: Bool = true,
                      sizeClass: UserInterfaceSizeClass? = .regular) -> CGFloat {
        ChatWidth.lane(setting, available: available, margins: margins, pad: pad, sizeClass: sizeClass)
    }

    @Test func comfortableKeepsTheIPadLaneItAlwaysHad() {
        #expect(lane(.comfortable, 1376) == 680)
        #expect(lane(.comfortable, 1024) == 680)
    }

    @Test func wideAndFullGrowOnALandscapeIPad() {
        #expect(lane(.wide, 1376) == 980)
        #expect(lane(.full, 1376) == 1344)
    }

    @Test func noLaneIsWiderThanTheRoomLessItsMargins() {
        for setting in ChatWidth.allCases {
            #expect(lane(setting, 700) == 668)
            #expect(lane(setting, 694, margins: 0) <= 694)
        }
        #expect(lane(.wide, 900) == 868)
    }

    @Test func splitViewAtRegularWidthStillHonoursTheSetting() {
        #expect(lane(.full, 910) == 878)
        #expect(lane(.comfortable, 910) == 680)
    }

    @Test func compactWidthIgnoresTheSetting() {
        #expect(lane(.full, 1000, sizeClass: .compact) == 680)
        #expect(lane(.wide, 375, sizeClass: .compact) == 343)
    }

    @Test func iPhoneIgnoresTheSettingEvenAtRegularWidth() {
        #expect(lane(.full, 932, pad: false) == 680)
        #expect(lane(.wide, 393, pad: false, sizeClass: .compact) == 361)
    }

    @Test func aRoomSmallerThanItsMarginsCollapsesToZero() {
        #expect(lane(.full, 20) == 0)
    }

    @Test func beforeTheRoomIsMeasuredTheSettingAloneDecides() {
        #expect(lane(.wide, .infinity) == 980)
        #expect(lane(.full, .infinity) == .infinity)
    }
}
