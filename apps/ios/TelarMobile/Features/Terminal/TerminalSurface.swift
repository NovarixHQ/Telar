import SwiftUI

struct TerminalSurface: View {
    let api: any TerminalAPI
    let sessionId: EngineID
    let terminalId: String
    @State private var feed: TerminalFeed
    @State private var line = ""
    @State private var acting = false

    init(api: any TerminalAPI, sessionId: EngineID, terminalId: String, terminal: EngineTerminal?) {
        self.api = api
        self.sessionId = sessionId
        self.terminalId = terminalId
        _feed = State(initialValue: TerminalFeed(terminal: terminal))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Theme.borderSubtle)
            output
            Divider().overlay(Theme.borderSubtle)
            input
        }
        .task(id: terminalId) { await feed.follow(api, sessionId: sessionId, terminalId: terminalId) }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle().fill(tone).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 1) {
                Text(feed.terminal?.statusLabel ?? "Connecting")
                    .font(.system(Theme.footnote, weight: .medium))
                    .foregroundStyle(Theme.text)
                if let detail = feed.failure ?? feed.terminal?.detail ?? feed.terminal?.command {
                    Text(detail)
                        .font(Theme.monoSmall)
                        .foregroundStyle(feed.failure == nil ? Theme.textMuted : Theme.statusRed)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
            action("Restart", icon: "arrow.clockwise") { try await api.restartTerminal(sessionId, terminalId) }
            action("Stop", icon: "stop.fill") { try await api.stopTerminal(sessionId, terminalId) }
                .disabled(feed.terminal?.isOpen == false)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
    }

    private var tone: Color {
        guard let terminal = feed.terminal else { return Theme.textMuted }
        if terminal.status == .failed { return Theme.statusRed }
        guard terminal.isOpen, terminal.busy else { return Theme.textMuted }
        return terminal.status == .ready ? Theme.statusEmerald : Theme.statusSky
    }

    private func action(_ label: String, icon: String, _ run: @escaping () async throws -> EngineTerminal) -> some View {
        Button {
            acting = true
            Task {
                do { feed.adopt(try await run()) } catch { feed.fail(error) }
                acting = false
            }
        } label: {
            Image(systemName: icon)
                .foregroundStyle(Theme.textMuted)
                .scaledGlyphBox(30, glyph: 12, weight: .semibold)
        }
        .buttonStyle(.plain)
        .disabled(acting)
        .accessibilityLabel(label)
    }

    private var output: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if feed.dropped {
                    Text("Earlier output is no longer kept.")
                        .font(.system(Theme.caption))
                        .foregroundStyle(Theme.textMuted)
                }
                Text(feed.text.isEmpty ? " " : feed.text)
                    .font(Theme.mono)
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(12)
        }
        .defaultScrollAnchor(.bottom)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .background(Theme.codeBackground)
    }

    private var input: some View {
        HStack(spacing: 6) {
            Image(systemName: "chevron.right")
                .font(.system(Theme.caption, weight: .semibold))
                .foregroundStyle(Theme.textMuted)
            TextField("Type into the terminal", text: $line)
                .font(Theme.mono)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.send)
                .onSubmit(send)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .disabled(feed.terminal?.isOpen == false)
    }

    private func send() {
        let typed = line
        line = ""
        Task {
            do { try await api.writeTerminal(sessionId, terminalId, data: typed + "\r") } catch { feed.fail(error) }
        }
    }
}
