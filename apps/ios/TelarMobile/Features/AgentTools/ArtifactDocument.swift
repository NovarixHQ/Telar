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

    private static let charts: [(String, UIColor)] = ([
        (0x81A9FD, 0x436ED1), (0xE584CF, 0xA84D95), (0x55C483, 0x1A8A51), (0xF89A56, 0xB75F0B), (0x4FBEC4, 0x01858A), (0xE4B33F, 0x9B7300),
    ] as [(UInt32, UInt32)]).enumerated().map { index, pair in
        ("chart-\(index + 1)", UIColor { UIColor(rgb: $0.userInterfaceStyle == .dark ? pair.0 : pair.1) })
    }

    private static let palette: [(String, UIColor)] = [
        ("background", UIColor(Theme.canvas)),
        ("foreground", UIColor(Theme.text)),
        ("muted", UIColor(Theme.subtle)),
        ("muted-foreground", UIColor(Theme.textMuted)),
        ("card", UIColor(Theme.card)),
        ("border", UIColor(Theme.border)),
        ("primary", UIColor(Theme.accent)),
        ("accent", UIColor(Theme.subtleStrong)),
        ("success", UIColor(Theme.statusEmerald)),
        ("warning", UIColor(Theme.statusAmber)),
        ("info", UIColor(Theme.statusSky)),
        ("destructive", UIColor(Theme.statusRed)),
    ] + charts

    static func tokens(dark: Bool) -> [(name: String, value: String)] {
        let traits = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
        return palette.map { ($0.0, hex($0.1.resolvedColor(with: traits))) }
            + [("radius", radius), ("font-sans", fontSans), ("font-mono", fontMono)]
    }

    static func style(dark: Bool) -> String {
        let variables = tokens(dark: dark).map { "--\($0.name):\($0.value);" }.joined()
        return ":where(:root){color-scheme:\(dark ? "dark" : "light");\(variables)}"
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
        return #"<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">"#
            + #"<style id="\#(lookId)">\#(ArtifactLook.style(dark: dark))</style>"# + fit + body
    }

    static func restyle(dark: Bool) -> String {
        "document.getElementById(\(jsString(lookId)))?.replaceChildren(\(jsString(ArtifactLook.style(dark: dark))));"
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

