import SwiftUI

struct SimulatorViewer: View {
    @State private var model: SimulatorViewerModel
    @State private var touching = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    init(api: any SimulatorsAPI, simulators: [SimulatorSummary], selectedId: String? = nil) {
        _model = State(initialValue: SimulatorViewerModel(api: api, simulators: simulators, selectedId: selectedId))
    }

    var body: some View {
        VStack(spacing: 8) {
            controls
            screen
            if let notice = model.notice {
                Text(notice)
                    .font(.system(Theme.footnote))
                    .foregroundStyle(Theme.statusAmber)
                    .lineLimit(2)
                    .padding(.horizontal, 16)
            }
        }
        .padding(.bottom, 8)
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.start() } else { model.stop() }
        }
        .onChange(of: model.closed) { _, closed in
            if closed { dismiss() }
        }
    }

    private var controls: some View {
        HStack(spacing: 4) {
            controlButton("xmark", label: "Close") { dismiss() }
            VStack(spacing: 0) {
                Text(model.selected?.name ?? "Simulator")
                    .font(.system(Theme.subhead, weight: .semibold))
                    .lineLimit(1)
                if !model.canDrive {
                    Text("View only").font(.system(Theme.captionTiny)).foregroundStyle(Theme.textMuted)
                }
            }
            .frame(maxWidth: .infinity)
            if model.canDrive && model.selected?.isWatch != true {
                controlButton("house", label: "Home") { model.press(.home) }
                controlButton("rotate.right", label: "Rotate") { model.rotate() }
            }
            menu
        }
        .foregroundStyle(Theme.text)
        .padding(4)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.horizontal, 12)
        .padding(.top, 4)
    }

    private var menu: some View {
        Menu {
            if model.simulators.count > 1 {
                Picker("Simulator", selection: Binding(get: { model.selectedId ?? "" }, set: { model.select($0) })) {
                    ForEach(model.simulators) { Text("\($0.name) · \($0.version)").tag($0.id) }
                }
            }
            Button("Reload stream", systemImage: "arrow.clockwise") { model.reload() }
            if model.canDrive {
                if model.selected?.isWatch != true {
                    Button("App switcher", systemImage: "square.on.square") { model.press(.appSwitcher) }
                }
                Button(model.shuttingDown ? "Shutting down…" : "Shut down", systemImage: "power", role: .destructive) {
                    Task { await model.shutDown() }
                }
                .disabled(model.shuttingDown)
            }
        } label: {
            Image(systemName: "ellipsis").scaledGlyphBox(44, glyph: 18, weight: .medium)
        }
        .accessibilityLabel("Simulator options")
    }

    private func controlButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).scaledGlyphBox(44, glyph: 18, weight: .medium)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var screen: some View {
        GeometryReader { geometry in
            if let image = model.image {
                let mapping = SimulatorScreenMapping(frame: image.size, screen: model.screen)
                let rect = mapping.fitted(in: geometry.size)
                ZStack {
                    Image(uiImage: image)
                        .resizable()
                        .interpolation(.medium)
                        .frame(width: mapping.sideways ? rect.height : rect.width, height: mapping.sideways ? rect.width : rect.height)
                        .rotationEffect(.degrees(mapping.rotation))
                        .position(x: rect.midX, y: rect.midY)
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .contentShape(Rectangle())
                .gesture(touchGesture(mapping, in: geometry.size, rect: rect), including: model.canDrive ? .all : .none)
                .accessibilityElement()
                .accessibilityLabel("\(model.selected?.name ?? "Simulator") screen")
            } else {
                status.frame(width: geometry.size.width, height: geometry.size.height)
            }
        }
    }

    @ViewBuilder private var status: some View {
        if case .failed(let message) = model.phase {
            VStack(spacing: 12) {
                Text(message)
                    .font(.system(Theme.footnote))
                    .foregroundStyle(Theme.textMuted)
                    .multilineTextAlignment(.center)
                Button("Retry") { model.reload() }
                    .buttonStyle(.bordered)
            }
            .padding(24)
        } else {
            ProgressView().tint(.white)
        }
    }

    private func touchGesture(_ mapping: SimulatorScreenMapping, in container: CGSize, rect: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                if !touching {
                    guard rect.contains(value.startLocation), let start = mapping.devicePoint(value.startLocation, in: container) else { return }
                    touching = true
                    model.touch(.begin, at: start)
                } else if let point = mapping.devicePoint(value.location, in: container) {
                    model.touch(.move, at: point)
                }
            }
            .onEnded { value in
                guard touching else { return }
                touching = false
                if let point = mapping.devicePoint(value.location, in: container) { model.touch(.end, at: point) }
            }
    }
}
