import SwiftUI
import UIKit

struct BrowserPageSurface: View {
    let api: any BrowserAPI
    let sessionId: EngineID
    let pageId: String
    let watch: BrowserWatch
    @Environment(\.panel) private var panel
    @State private var image: UIImage?
    @State private var error: String?
    @State private var address = ""

    private static let cadence = Duration.seconds(3)

    private var page: BrowserPage? { watch.pages.first { $0.id == pageId } }
    private var running: Bool { watch.snapshot?.running == true }

    var body: some View {
        VStack(spacing: 0) {
            addressBar
            Divider().overlay(Theme.borderSubtle)
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .task(id: "\(pageId):\(page?.active == true):\(running)") { await photograph() }
    }

    private var addressBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "globe")
                .font(.system(Theme.footnote, weight: .medium))
                .foregroundStyle(page?.loading == true ? Theme.accent : Theme.textMuted)
            TextField(page.flatMap { $0.url.isEmpty ? nil : $0.url } ?? "Open an address", text: $address)
                .font(Theme.mono)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit(open)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    @ViewBuilder private var content: some View {
        if let image, page?.active == true {
            ScrollView {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
                    .padding(10)
                    .accessibilityLabel("Screenshot of \(page?.label ?? "the page")")
            }
            .background(Theme.sheet)
        } else {
            VStack(spacing: 6) {
                Image(systemName: "globe")
                    .font(.system(Theme.subhead, weight: .medium))
                    .foregroundStyle(Theme.textMuted)
                    .scaledGlyphBox(36, glyph: 15)
                    .background(Theme.fill, in: Circle())
                Text(page?.label ?? "This page is no longer open")
                    .font(.system(Theme.subhead, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                Text(notice)
                    .font(.system(Theme.footnote))
                    .foregroundStyle(error == nil ? Theme.textMuted : Theme.statusRed)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: 300)
            .accessibilityElement(children: .combine)
        }
    }

    private var notice: String {
        if let error { return error }
        guard let page else { return "The agent closed it, or the session ended." }
        if !running { return "The browser is not running." }
        if !page.active { return "Only the page with focus can be photographed." }
        return "Waiting for the first screenshot."
    }

    private func photograph() async {
        guard page?.active == true, running else { return }
        while !Task.isCancelled {
            do {
                let read = try await api.browser(sessionId, screenshot: true)
                error = read.error
                if read.tabs.first(where: \.active)?.id == pageId, let data = read.image, let shot = UIImage(data: data) { image = shot }
                watch.apply(read)
            } catch {
                self.error = describe(error)
            }
            try? await Task.sleep(for: Self.cadence)
        }
    }

    private func open() {
        let typed = address
        guard !typed.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Task {
            do {
                if let opened = try await watch.open(typed, api: api, sessionId: sessionId) { panel?.open(.page(opened.id)) }
                address = ""
                error = nil
            } catch {
                self.error = describe(error)
            }
        }
    }
}
