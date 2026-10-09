import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

public final class ComposerPasteModule: Module {
  fileprivate static weak var current: ComposerPasteModule?
  fileprivate var listening = false

  public func definition() -> ModuleDefinition {
    Name("TelarComposerPaste")
    Events("onPaste")

    OnCreate {
      Self.current = self
      Self.install()
    }
    OnStartObserving { self.listening = true }
    OnStopObserving { self.listening = false }
  }

  fileprivate var wantsImages: Bool { listening && UIPasteboard.general.hasImages }

  // Writes each pasted image to a temp file and sends them; text pastes never reach here.
  fileprivate func take() -> Bool {
    let providers = UIPasteboard.general.itemProviders.compactMap { provider in
      provider.registeredTypeIdentifiers.lazy.compactMap(UTType.init).first { $0.conforms(to: .image) }.map { (provider, $0) }
    }
    guard !providers.isEmpty else { return false }
    let group = DispatchGroup()
    var files: [[String: Any]?] = Array(repeating: nil, count: providers.count)
    for (index, (provider, type)) in providers.enumerated() {
      group.enter()
      provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
        let file = data.flatMap { Self.write($0, type) }
        DispatchQueue.main.async {
          files[index] = file
          group.leave()
        }
      }
    }
    group.notify(queue: .main) { [weak self] in
      let written = files.compactMap { $0 }
      if !written.isEmpty { self?.sendEvent("onPaste", ["files": written]) }
    }
    return true
  }

  private static func write(_ data: Data, _ type: UTType) -> [String: Any]? {
    let ext = type.preferredFilenameExtension ?? "png"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("paste-\(UUID().uuidString).\(ext)")
    guard (try? data.write(to: url)) != nil else { return nil }
    return ["uri": url.absoluteString, "name": "Pasted image.\(ext)", "mimeType": type.preferredMIMEType ?? "image/png", "size": data.count]
  }

  private typealias CanPerform = @convention(c) (AnyObject, Selector, Selector, Any?) -> Bool
  private typealias Paste = @convention(c) (AnyObject, Selector, Any?) -> Void
  private static var installed = false

  // React Native's multiline field offers Paste only for text; this widens it to images while a composer listens.
  private static func install() {
    guard !installed, let field = NSClassFromString("RCTUITextView") else { return }
    installed = true
    let canPerform = #selector(UIResponder.canPerformAction(_:withSender:))
    replace(field, canPerform) { original in
      let call = unsafeBitCast(original, to: CanPerform.self)
      let block: @convention(block) (AnyObject, Selector, Any?) -> Bool = { view, action, sender in
        if action == #selector(UIResponder.paste(_:)), current?.wantsImages == true { return true }
        return call(view, canPerform, action, sender)
      }
      return block
    }
    let paste = #selector(UIResponder.paste(_:))
    replace(field, paste) { original in
      let call = unsafeBitCast(original, to: Paste.self)
      let block: @convention(block) (AnyObject, Any?) -> Void = { view, sender in
        if let module = current, module.wantsImages, module.take() { return }
        call(view, paste, sender)
      }
      return block
    }
  }

  private static func replace(_ cls: AnyClass, _ selector: Selector, _ make: (IMP) -> Any) {
    guard let method = class_getInstanceMethod(cls, selector) else { return }
    let imp = imp_implementationWithBlock(make(method_getImplementation(method)))
    if !class_addMethod(cls, selector, imp, method_getTypeEncoding(method)) { method_setImplementation(method, imp) }
  }
}
