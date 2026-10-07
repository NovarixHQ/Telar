import SwiftUI
import UIKit

enum ArtifactFrame {
    static let minHeight: CGFloat = 48
    static let maxHeight: CGFloat = 560
    static let restingHeight: CGFloat = 160

    static func cap(hint: Int?) -> CGFloat {
        hint.map { min(maxHeight, max(minHeight, CGFloat($0))) } ?? maxHeight
    }

    static func height(measured: CGFloat?, hint: Int? = nil) -> CGFloat {
        guard let measured, measured.isFinite else { return hint == nil ? restingHeight : cap(hint: hint) }
        return min(cap(hint: hint), max(minHeight, measured.rounded(.up)))
    }

    static func scrolls(_ probe: ArtifactProbe?, hint: Int? = nil) -> Bool {
        guard let probe else { return false }
        return probe.wide || probe.height > cap(hint: hint)
    }
}

struct ArtifactProbe: Equatable {
    var height: CGFloat
    var wide: Bool

    init(height: CGFloat, wide: Bool) {
        self.height = height
        self.wide = wide
    }

    init?(message: Any) {
        guard let body = message as? [String: Any],
              let height = (body["height"] as? NSNumber)?.doubleValue, height.isFinite, height >= 0 else { return nil }
        self.height = CGFloat(height.rounded(.up))
        wide = (body["wide"] as? Bool) ?? false
    }
}

enum ArtifactLook {
    static let radius = "10px"
    static let fontSans = "-apple-system, system-ui, sans-serif"
    static let fontMono = "ui-monospace, SFMono-Regular, Menlo, monospace"

    private static func pair(_ dark: UInt32, _ light: UInt32) -> UIColor {
        UIColor { UIColor(rgb: $0.userInterfaceStyle == .dark ? dark : light) }
    }

    private static let tints: [(String, UIColor)] = [
        ("tint-blue", pair(0x5DB2F7, 0x007AC5)), ("tint-cyan", pair(0x4FBEC4, 0x01858A)), ("tint-green", pair(0x55C483, 0x1A8A51)),
        ("tint-yellow", pair(0xE4B33F, 0x9B7300)), ("tint-orange", pair(0xF89A56, 0xB75F0B)), ("tint-red", pair(0xFB8083, 0xC0434C)),
        ("tint-pink", pair(0xF080B8, 0xB54481)), ("tint-purple", pair(0xB394FF, 0x7D5CC7)),
    ]

    private static let charts: [(String, UIColor)] = [
        ("chart-1", pair(0x81A9FD, 0x436ED1)), ("chart-2", pair(0xE584CF, 0xA84D95)), ("chart-3", pair(0x55C483, 0x1A8A51)),
        ("chart-4", pair(0xF89A56, 0xB75F0B)), ("chart-5", pair(0x4FBEC4, 0x01858A)), ("chart-6", pair(0xE4B33F, 0x9B7300)),
    ]

    private static let palette: [(String, UIColor)] = [
        ("background", UIColor(Theme.canvas)),
        ("foreground", UIColor(Theme.text)),
        ("card", UIColor(Theme.card)),
        ("card-foreground", UIColor(Theme.text)),
        ("popover", UIColor(Theme.popover)),
        ("popover-foreground", UIColor(Theme.text)),
        ("muted", UIColor(Theme.subtle)),
        ("muted-foreground", UIColor(Theme.textMuted)),
        ("border", UIColor(Theme.border)),
        ("primary", UIColor(Theme.accent)),
        ("primary-foreground", UIColor(Theme.primaryGlyph)),
        ("secondary", UIColor(Theme.subtle)),
        ("secondary-foreground", UIColor(Theme.text)),
        ("accent", UIColor(Theme.subtleStrong)),
        ("accent-foreground", UIColor(Theme.text)),
        ("input", pair(0x6C6C6C, 0x8D8D92)),
        ("ring", UIColor(Theme.accent)),
        ("overlay", UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x0A0A0A).withAlphaComponent(0.55) : UIColor(rgb: 0x27272A).withAlphaComponent(0.1) }),
        ("sidebar", UIColor(Theme.sheet)),
        ("sidebar-foreground", UIColor(Theme.text)),
        ("sidebar-primary", UIColor(Theme.accent)),
        ("sidebar-accent", UIColor(Theme.subtle)),
        ("sidebar-accent-foreground", UIColor(Theme.text)),
        ("sidebar-border", UIColor(Theme.border)),
        ("sidebar-ring", UIColor(Theme.accent)),
        ("success", UIColor(Theme.statusEmerald)),
        ("warning", UIColor(Theme.statusAmber)),
        ("info", UIColor(Theme.statusSky)),
        ("destructive", UIColor(Theme.statusRed)),
        ("code-background", UIColor(Theme.codeBackground)),
        ("code-foreground", UIColor(Theme.text)),
        ("code-comment", UIColor(Theme.textMuted)),
        ("code-keyword", UIColor(Theme.accent)),
        ("code-string", UIColor(Theme.statusEmerald)),
        ("code-number", UIColor(Theme.statusAmber)),
        ("code-function", UIColor(Theme.statusSky)),
    ] + tints + charts

    private static func shadows(dark: Bool) -> [(name: String, value: String)] {
        let (ring, ambient, lift) = dark ? ("rgb(0 0 0 / 0.33)", "rgb(0 0 0 / 0.08)", 0.5) : ("rgb(39 39 42 / 0.1)", "rgb(39 39 42 / 0.23)", 1.0)
        let rung = { (contact: String, y: Double, blur: Double, spread: Double) in
            "0 \(contact) \(ring), 0 \(y * lift)px \(blur * lift)px \(spread * lift)px \(ambient)"
        }
        return [("shadow-1", rung("1px 1px -1px", 2, 6, -4)), ("shadow-2", rung("1px 2px -1px", 8, 24, -14)), ("shadow-3", rung("2px 4px -2px", 18, 48, -26))]
    }

    static func scheme(dark: Bool) -> String { dark ? "dark" : "light" }

    static func tokens(dark: Bool) -> [(name: String, value: String)] {
        let traits = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
        return palette.map { ($0.0, hex($0.1.resolvedColor(with: traits))) } + shadows(dark: dark)
            + [("radius", radius), ("font-sans", fontSans), ("font-mono", fontMono)]
    }

    static func style(dark: Bool) -> String {
        let variables = tokens(dark: dark).map { "--\($0.name):\($0.value);" }.joined()
        return ":where(:root){color-scheme:\(scheme(dark: dark));--scheme:\(scheme(dark: dark));\(variables)}"
            + ":where(html){background:var(--background);color:var(--foreground);font:15px/1.5 var(--font-sans);-webkit-text-size-adjust:100%}:where(body){margin:0}"
    }

    static func hex(_ color: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        let byte = { (value: CGFloat) in String(format: "%02x", Int((min(1, max(0, value)) * 255).rounded())) }
        return "#" + byte(r) + byte(g) + byte(b) + (a < 1 ? byte(a) : "")
    }
}

enum ArtifactDocument {
    static let channel = "artifactProbe"
    static let lookId = "telar-look"

    static func html(_ content: String, kind: ArtifactKind, dark: Bool) -> String {
        let body = content.replacingOccurrences(of: #"^\s*<!doctype[^>]*>"#, with: "", options: [.regularExpression, .caseInsensitive])
        let fit = kind == .svg ? "<style>:where(svg){display:block;max-width:100%;height:auto;margin:0 auto}</style>" : ""
        return #"<!doctype html><html data-scheme="\#(ArtifactLook.scheme(dark: dark))"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">"#
            + #"<style id="\#(lookId)">\#(ArtifactLook.style(dark: dark))</style>"# + fit + body
    }

    static func restyle(dark: Bool) -> String {
        "document.getElementById(\(jsString(lookId)))?.replaceChildren(\(jsString(ArtifactLook.style(dark: dark))));"
            + "document.documentElement.dataset.scheme=\(jsString(ArtifactLook.scheme(dark: dark)));"
    }

    static let probe = """
    (() => {
      const measure = () => {
        const body = document.body;
        if (!body) return 0;
        const style = getComputedStyle(body);
        let bottom = 0, last = null;
        for (const child of body.children) {
          if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
          if (child.checkVisibility && !child.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
          const edge = child.getBoundingClientRect().bottom;
          if (edge >= bottom) { bottom = edge; last = child; }
        }
        for (const node of body.childNodes) {
          if (node.nodeType !== 3 || !node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNode(node);
          bottom = Math.max(bottom, range.getBoundingClientRect().bottom);
        }
        const tail = [last ? getComputedStyle(last).marginBottom : "0", style.paddingBottom, style.borderBottomWidth, style.marginBottom]
          .reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
        return bottom + scrollY + tail;
      };
      const post = () => {
        const root = document.documentElement;
        webkit.messageHandlers.\(channel).postMessage({ height: measure(), wide: root.scrollWidth > root.clientWidth + 1 });
      };
      const watch = new ResizeObserver(post);
      watch.observe(document.documentElement);
      if (document.body) {
        watch.observe(document.body);
        new MutationObserver(post).observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      addEventListener("load", post);
      document.fonts.ready.then(post);
      post();
    })();
    """

    private static func jsString(_ value: String) -> String {
        (try? String(decoding: JSONEncoder().encode(value), as: UTF8.self)) ?? "\"\""
    }
}

struct ArtifactSlots: Equatable {
    var cap: Int
    private(set) var live: [String] = []

    init(cap: Int) { self.cap = cap }

    mutating func claim(_ key: String) {
        live.removeAll { $0 == key }
        live.append(key)
        if live.count > cap { live.removeFirst(live.count - cap) }
    }

    mutating func release(_ key: String) {
        live.removeAll { $0 == key }
    }

    func isLive(_ key: String) -> Bool { live.contains(key) }
}

func latestArtifactVersions(_ turns: [JournalTurn]) -> [String: Int] {
    var latest: [String: Int] = [:]
    for turn in turns {
        for item in turn.items + turn.tasks.flatMap(\.items) {
            guard case .artifact(let artifact) = item.detail else { continue }
            latest[artifact.id] = max(latest[artifact.id] ?? 0, artifact.version)
        }
    }
    return latest
}

