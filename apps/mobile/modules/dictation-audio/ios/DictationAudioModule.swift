import AVFoundation
import ExpoModulesCore

public final class DictationAudioModule: Module {
  private let queue = DispatchQueue(label: "telar.dictation-audio")
  private let wire = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
  private var engine: AVAudioEngine?
  private var engineChanged: NSObjectProtocol?
  private var sessionEvents: [NSObjectProtocol] = []
  private var prior: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?

  #if compiler(>=6.2)
  private static let options: AVAudioSession.CategoryOptions = [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP, .allowBluetoothA2DP]
  #else
  private static let options: AVAudioSession.CategoryOptions = [.duckOthers, .defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
  #endif

  public func definition() -> ModuleDefinition {
    Name("TelarDictationAudio")
    Events("onAudio", "onRoute", "onInterruption", "onReset")

    OnDestroy { self.queue.sync { self.release() } }

    AsyncFunction("start") { try self.capture() }.runOnQueue(queue)
    AsyncFunction("rebuild") { try self.capture() }.runOnQueue(queue)
    AsyncFunction("stop") { self.release() }.runOnQueue(queue)
  }

  // Claims the session again and taps the input as it is now: a new route can change the hardware format.
  private func capture() throws {
    teardown()
    let session = AVAudioSession.sharedInstance()
    if prior == nil { prior = (session.category, session.mode, session.categoryOptions) }
    try session.setCategory(.playAndRecord, mode: .spokenAudio, options: Self.options)
    try session.setActive(true)
    observeSession()

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let hardware = input.outputFormat(forBus: 0)
    let wire = self.wire
    guard hardware.sampleRate > 0, hardware.channelCount > 0, let converter = AVAudioConverter(from: hardware, to: wire) else {
      throw NoMicrophoneException()
    }
    input.installTap(onBus: 0, bufferSize: 4096, format: hardware) { [weak self] buffer, _ in
      guard let data = Self.pcm16(buffer, converter, wire) else { return }
      self?.sendEvent("onAudio", ["data": data])
    }
    engineChanged = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
      self?.sendEvent("onReset")
    }
    self.engine = engine
    engine.prepare()
    try engine.start()
  }

  private func release() {
    teardown()
    sessionEvents.forEach(NotificationCenter.default.removeObserver)
    sessionEvents = []
    guard let prior else { return }
    self.prior = nil
    let session = AVAudioSession.sharedInstance()
    try? session.setActive(false, options: [.notifyOthersOnDeactivation])
    try? session.setCategory(prior.0, mode: prior.1, options: prior.2)
  }

  private func teardown() {
    if let engineChanged { NotificationCenter.default.removeObserver(engineChanged) }
    engineChanged = nil
    guard let engine else { return }
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
    engine.reset()
    self.engine = nil
  }

  private func observeSession() {
    guard sessionEvents.isEmpty else { return }
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    sessionEvents = [
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: nil) { [weak self] note in
        let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        self?.sendEvent("onRoute", ["reason": Self.routeReason(raw)])
      },
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] note in
        let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
        self?.sendEvent("onInterruption", ["began": raw == AVAudioSession.InterruptionType.began.rawValue])
      },
      center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: nil) { [weak self] _ in
        self?.sendEvent("onReset")
      },
    ]
  }

  private static func routeReason(_ raw: UInt) -> String {
    switch AVAudioSession.RouteChangeReason(rawValue: raw) {
    case .newDeviceAvailable: "newDeviceAvailable"
    case .oldDeviceUnavailable: "oldDeviceUnavailable"
    case .categoryChange: "categoryChange"
    case .override: "override"
    case .wakeFromSleep: "wakeFromSleep"
    case .noSuitableRouteForCategory: "noSuitableRouteForCategory"
    case .routeConfigurationChange: "routeConfigurationChange"
    default: "unknown"
    }
  }

  private static func pcm16(_ buffer: AVAudioPCMBuffer, _ converter: AVAudioConverter, _ wire: AVAudioFormat) -> ArrayBuffer? {
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * wire.sampleRate / buffer.format.sampleRate) + 1
    guard let out = AVAudioPCMBuffer(pcmFormat: wire, frameCapacity: capacity) else { return nil }
    var handed = false
    var failure: NSError?
    converter.convert(to: out, error: &failure) { _, status in
      if handed {
        status.pointee = .noDataNow
        return nil
      }
      handed = true
      status.pointee = .haveData
      return buffer
    }
    guard failure == nil, out.frameLength > 0, let channel = out.int16ChannelData else { return nil }
    return ArrayBuffer.copy(of: channel[0], count: Int(out.frameLength) * MemoryLayout<Int16>.size)
  }
}

final class NoMicrophoneException: Exception, @unchecked Sendable {
  override var reason: String { "No microphone input is available right now." }
}
