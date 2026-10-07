import Foundation
import Testing
@testable import TelarMobile

private func artifactItem(_ id: String, artifactId: String = "chart", version: Int, kind: String = "html", extra: String = "") -> Item {
    try! JSONDecoder().decode(Item.self, from: Data("""
    {"id":"\(id)","runId":"run_1","sessionId":"s","status":"completed","startedAt":100,
     "detail":{"type":"artifact","artifact":{"id":"\(artifactId)","kind":"\(kind)","title":"Load by hour","attachmentId":"att_\(id)","version":\(version)\(extra)}}}
    """.utf8))
}

@Suite struct ArtifactDecodingTests {
    @Test func decodesAnArtifactItem() {
        let item = artifactItem("artifact_chart_v2", version: 2)
        #expect(item.detail == .artifact(Artifact(id: "chart", kind: .html, title: "Load by hour", attachmentId: "att_artifact_chart_v2", version: 2)))
    }

    @Test func decodesTheAgentsHeight() {
        guard case .artifact(let artifact) = artifactItem("a", version: 1, extra: #","height":420"#).detail else {
            Issue.record("expected an artifact")
            return
        }
        #expect(artifact.height == 420)
    }

    @Test func anUnknownKindStillDecodes() {
        guard case .artifact(let artifact) = artifactItem("a", version: 1, kind: "chart").detail else {
            Issue.record("expected an artifact")
            return
        }
        #expect(artifact.kind == .unknown)
    }

    @Test func aMalformedArtifactFallsBackToAnUnknownRow() {
        let item = try! JSONDecoder().decode(Item.self, from: Data("""
        {"id":"x","runId":"run_1","sessionId":"s","startedAt":1,"detail":{"type":"artifact","artifact":{"id":"chart"}}}
        """.utf8))
        #expect(item.detail == .unknown(label: "artifact"))
    }

    @Test func anArtifactIsItsOwnRowAndNeverFolds() {
        let rows = [makeItem("a", type: "command_execution"), artifactItem("b", version: 1), makeItem("c", type: "file_read")]
            .map { JournalItem(item: $0, streamedText: "", openedBy: 0) }
        #expect(segmentActivity(rows).map(\.id) == ["a", "b", "c"])
        let cuts = cutAroundLiveAgents(rows, tasks: [])
        #expect(cuts.count == 3)
        if case .artifact(let item) = cuts[1] { #expect(item.id == "b") } else { Issue.record("expected an artifact cut") }
    }
}

@Suite struct ArtifactVersionTests {
    @Test func theNewestVersionWinsAcrossTurns() {
        let first = projectJournal(turns: [makeTurn("run_1")], items: [artifactItem("v1", version: 1), artifactItem("v3", version: 3)], events: [])
        #expect(latestArtifactVersions(first) == ["chart": 3])
    }
}

@Suite struct ArtifactFrameTests {
    @Test func heightIsTheMeasuredHeightWithinBounds() {
        #expect(ArtifactFrame.height(measured: nil) == ArtifactFrame.restingHeight)
        #expect(ArtifactFrame.height(measured: 12) == ArtifactFrame.minHeight)
        #expect(ArtifactFrame.height(measured: 240.2) == 241)
        #expect(ArtifactFrame.height(measured: 5000) == ArtifactFrame.maxHeight)
        #expect(ArtifactFrame.height(measured: .infinity) == ArtifactFrame.restingHeight)
    }

    @Test func theAgentsHeightIsHeldUntilThePageMeasuresItselfAndCapsIt() {
        #expect(ArtifactFrame.height(measured: nil, hint: 420) == 420)
        #expect(ArtifactFrame.height(measured: 300, hint: 420) == 300)
        #expect(ArtifactFrame.height(measured: 900, hint: 420) == 420)
        #expect(ArtifactFrame.height(measured: nil, hint: 5000) == ArtifactFrame.maxHeight)
        #expect(ArtifactFrame.scrolls(ArtifactProbe(height: 421, wide: false), hint: 420))
        #expect(!ArtifactFrame.scrolls(ArtifactProbe(height: 420, wide: false), hint: 420))
    }

    @Test func theFrameScrollsOnlyWhenThePageOverflows() {
        #expect(!ArtifactFrame.scrolls(nil))
        #expect(!ArtifactFrame.scrolls(ArtifactProbe(height: 300, wide: false)))
        #expect(!ArtifactFrame.scrolls(ArtifactProbe(height: ArtifactFrame.maxHeight, wide: false)))
        #expect(ArtifactFrame.scrolls(ArtifactProbe(height: ArtifactFrame.maxHeight + 1, wide: false)))
        #expect(ArtifactFrame.scrolls(ArtifactProbe(height: 100, wide: true)))
    }

    @Test func probeMessagesAreReadDefensively() {
        #expect(ArtifactProbe(message: ["height": 120.4, "wide": true]) == ArtifactProbe(height: 121, wide: true))
        #expect(ArtifactProbe(message: ["height": 80]) == ArtifactProbe(height: 80, wide: false))
        #expect(ArtifactProbe(message: ["height": "tall"]) == nil)
        #expect(ArtifactProbe(message: ["height": -1]) == nil)
        #expect(ArtifactProbe(message: "120") == nil)
    }
}

@Suite struct ArtifactThemeTests {
    private func token(_ name: String, dark: Bool) -> String? {
        ArtifactLook.tokens(dark: dark).first { $0.name == name }?.value
    }

    @Test func colorsAreInjectedAsHexPerScheme() {
        #expect(token("background", dark: true) == "#0a0a0a")
        #expect(token("background", dark: false) == "#fcfcfc")
        #expect(token("foreground", dark: true) == "#f5f5f5")
        #expect(token("border", dark: true) == "#ffffff1a")
        #expect(token("chart-1", dark: false) == "#436ed1")
        #expect(token("chart-6", dark: true) == "#e4b33f")
        for (name, value) in ArtifactLook.tokens(dark: true) where !["shadow-1", "shadow-2", "shadow-3", "radius", "font-sans", "font-mono"].contains(name) {
            #expect(value.range(of: "^#[0-9a-f]{6}([0-9a-f]{2})?$", options: .regularExpression) != nil, "\(name) is \(value)")
        }
    }

    @Test func everyCockpitVariableIsPresent() {
        let names = Set(ArtifactLook.tokens(dark: false).map(\.name))
        let expected: Set = ["background", "foreground", "muted", "card", "border", "primary", "accent", "success", "warning",
                             "info", "destructive", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6",
                             "input", "ring", "popover", "secondary", "sidebar", "tint-blue", "code-background",
                             "shadow-1", "shadow-2", "shadow-3", "radius", "font-sans", "font-mono"]
        #expect(expected.isSubset(of: names))
    }

    @Test func theLookLandsBeforeThePageAndYieldsToIt() {
        let html = ArtifactDocument.html("<!DOCTYPE html><style>:root{--background:red}</style><p>hi</p>", kind: .html, dark: true)
        let look = html.range(of: "--background:#0a0a0a")!
        let page = html.range(of: "--background:red")!
        #expect(look.lowerBound < page.lowerBound)
        #expect(html.hasPrefix(#"<!doctype html><html data-scheme="dark">"#))
        #expect(html.contains(":where(:root){color-scheme:dark;--scheme:dark;"))
        #expect(html.components(separatedBy: "<!doctype html>").count == 2)
        #expect(!html.localizedCaseInsensitiveContains("<!DOCTYPE html><style>:root"))
    }

    @Test func aSchemeChangeRestylesWithoutReloading() {
        let script = ArtifactDocument.restyle(dark: false)
        #expect(script.hasPrefix("document.getElementById(\"telar-look\")"))
        #expect(script.contains("color-scheme:light"))
        #expect(script.contains("--background:#fcfcfc"))
        #expect(script.hasSuffix(#"document.documentElement.dataset.scheme="light";"#))
    }

    @Test func svgIsFittedToTheColumn() {
        #expect(ArtifactDocument.html("<svg/>", kind: .svg, dark: false).contains("max-width:100%"))
        #expect(!ArtifactDocument.html("<p/>", kind: .html, dark: false).contains("max-width:100%"))
    }
}

@Suite struct ArtifactSlotTests {
    @Test func theLeastRecentlyShownFrameIsReleasedPastTheCap() {
        var slots = ArtifactSlots(cap: 2)
        slots.claim("a")
        slots.claim("b")
        slots.claim("c")
        #expect(!slots.isLive("a"))
        #expect(slots.isLive("b") && slots.isLive("c"))
        slots.claim("b")
        slots.claim("d")
        #expect(slots.live == ["b", "d"])
        slots.release("b")
        #expect(slots.live == ["d"])
    }
}
