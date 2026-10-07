import SwiftUI
import WebKit

struct ArtifactWebView: UIViewRepresentable {
    let key: String
    let content: String
    let kind: ArtifactKind
    let dark: Bool
    var scrolls: Bool
    var onProbe: (ArtifactProbe) -> Void = { _ in }
    var onCrash: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = true
        configuration.dataDetectorTypes = []
        let scripts = configuration.userContentController
        scripts.addUserScript(WKUserScript(source: ArtifactDocument.probe, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
        scripts.add(context.coordinator, contentWorld: .defaultClient, name: ArtifactDocument.channel)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsLinkPreview = false
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        view.scrollView.isScrollEnabled = scrolls
        if coordinator.key != key {
            coordinator.key = key
            coordinator.dark = dark
            coordinator.load(view)
        } else if coordinator.dark != dark {
            coordinator.dark = dark
            view.evaluateJavaScript(ArtifactDocument.restyle(dark: dark), in: nil, in: .defaultClient)
        }
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeAllScriptMessageHandlers()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: ArtifactWebView?
        var key: String?
        var dark = false
        private var restarted = false

        func load(_ view: WKWebView) {
            guard let parent else { return }
            view.loadHTMLString(ArtifactDocument.html(parent.content, kind: parent.kind, dark: dark), baseURL: nil)
        }

        func webView(_ view: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.targetFrame?.isMainFrame == false || action.request.url?.scheme == "about" {
                decisionHandler(.allow)
                return
            }
            if action.navigationType == .linkActivated { Self.openOutside(action.request.url) }
            decisionHandler(.cancel)
        }

        func webView(_ view: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if action.navigationType == .linkActivated { Self.openOutside(action.request.url) }
            return nil
        }

        func webViewWebContentProcessDidTerminate(_ view: WKWebView) {
            if restarted {
                parent?.onCrash()
            } else {
                restarted = true
                load(view)
            }
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            if let probe = ArtifactProbe(message: message.body) { parent?.onProbe(probe) }
        }

        private static func openOutside(_ url: URL?) {
            guard let url, url.scheme == "http" || url.scheme == "https" else { return }
            UIApplication.shared.open(url)
        }
    }
}
