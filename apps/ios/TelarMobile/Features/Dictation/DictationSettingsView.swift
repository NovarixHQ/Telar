import SwiftUI

struct DictationSettingsView: View {
    let api: any EngineAPI

    @State private var provider = DictationProvider.off
    @State private var configured = false
    @State private var language = DictationLanguages.automatic
    @State private var languages: [DictationLanguageOption] = []
    @State private var vocabulary: [String] = []
    @State private var loading = true
    @State private var keyDraft = ""
    @State private var saving = false
    @State private var refusal: String?
    @State private var editingVocabulary = false
    @State private var logCopied = false

    var body: some View {
        SettingsPage(title: "Dictation") {
            SettingsGroup(
                label: "Speech to text",
                footer: "Set on this computer; every device that dictates through it uses it.",
                error: refusal
            ) {
                CardRow(icon: provider == DictationProvider.off ? "mic.slash" : "waveform", title: "Service") {
                    Menu {
                        Button("Off") { save(provider: DictationProvider.off) }
                        Button("Cloud service") { save(provider: DictationProvider.deepgram) }
                    } label: { menuLabel(providerLabel) }
                    .disabled(loading || saving)
                }
                if provider == DictationProvider.deepgram {
                    CardDivider()
                    CardRow(icon: "globe", title: "Language") {
                        Menu {
                            ForEach(languages) { option in
                                Button(option.label) { save(language: option.code) }
                            }
                        } label: { menuLabel(languageLabel) }
                        .disabled(loading || saving || languages.isEmpty)
                    }
                    CardDivider()
                    keyRow
                    CardDivider()
                    CardValueRow(icon: "text.book.closed", title: "Vocabulary", value: vocabularyLabel) { editingVocabulary = true }
                }
            }

            SettingsGroup(
                label: "Typing log",
                footer: logCopied ? "Copied. Paste it into a bug report." : "What the message box recorded on this phone, for a bug report."
            ) {
                Button {
                    UIPasteboard.general.string = ComposerLog.shared.exported
                    logCopied = true
                } label: {
                    CardRow(icon: "doc.on.doc", title: "Copy typing log") { EmptyView() }
                }
                .buttonStyle(.plain)
                CardDivider()
                Button {
                    ComposerLog.shared.clear()
                    logCopied = false
                } label: {
                    CardRow(icon: "trash", title: "Clear typing log") { EmptyView() }
                }
                .buttonStyle(.plain)
            }
        }
        .navigationDestination(isPresented: $editingVocabulary) {
            DictationVocabularyView(saved: vocabulary) { save(vocabulary: $0) }
        }
        .task { await load() }
    }

    private var keyRow: some View {
        CardRow(icon: "key", title: "Service key") {
            if configured && keyDraft.isEmpty {
                Button("Remove") { save(apiKey: "") }
                    .font(.system(.callout))
                    .foregroundStyle(Theme.statusRed)
                    .disabled(saving)
            }
            SecureField(configured ? "Saved" : "Paste a key", text: $keyDraft)
                .multilineTextAlignment(.trailing)
                .font(.system(.callout, design: .monospaced))
                .submitLabel(.done)
                .onSubmit {
                    let key = keyDraft.trimmingCharacters(in: .whitespaces)
                    if !key.isEmpty { save(apiKey: key) }
                }
        }
    }

    private func menuLabel(_ text: String) -> some View {
        HStack(spacing: 4) {
            Text(text).font(.system(.callout)).foregroundStyle(Theme.textMuted)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(Theme.footnote, weight: .medium))
                .foregroundStyle(Theme.chevron)
        }
    }

    private var providerLabel: String {
        switch provider {
        case DictationProvider.deepgram: "Cloud service"
        case DictationProvider.off: "Off"
        default: "Unknown"
        }
    }

    private var languageLabel: String {
        languages.first { $0.code == language }?.label ?? language
    }

    private var vocabularyLabel: String {
        vocabulary.count == 1 ? "1 term" : "\(vocabulary.count) terms"
    }

    private func load() async {
        do {
            adopt(try await api.dictation())
        } catch {
            refusal = error.localizedDescription
        }
        loading = false
    }

    private func save(
        provider newProvider: String? = nil,
        apiKey: String? = nil,
        language newLanguage: String? = nil,
        vocabulary newVocabulary: [String]? = nil
    ) {
        saving = true
        refusal = nil
        Task {
            do {
                let answer = try await api.setDictation(
                    provider: newProvider, apiKey: apiKey, language: newLanguage, vocabulary: newVocabulary
                )
                adopt(answer)
                if apiKey != nil { keyDraft = "" }
            } catch {
                refusal = error.localizedDescription
            }
            saving = false
        }
    }

    private func adopt(_ answer: DictationAnswer) {
        provider = answer.dictation.provider
        configured = answer.dictation.configured
        language = answer.dictation.language ?? DictationLanguages.automatic
        languages = answer.dictation.languages ?? []
        vocabulary = answer.dictation.vocabulary ?? []
    }
}

private struct DictationVocabularyView: View {
    let saved: [String]
    let commit: ([String]) -> Void
    @State private var draft = ""

    private var terms: [String] {
        draft.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    var body: some View {
        SettingsPage(title: "Vocabulary") {
            SettingsGroup(
                label: "One term per line",
                footer: "Names and jargon the service would not expect. Your projects and branches are already sent."
            ) {
                CardField(placeholder: "Kubernetes\nZarigüeya", text: $draft, multiline: true)
            }
        }
        .onAppear { draft = saved.joined(separator: "\n") }
        .onDisappear { if terms != saved { commit(terms) } }
    }
}
