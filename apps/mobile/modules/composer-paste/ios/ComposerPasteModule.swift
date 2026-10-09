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
    let files = UIPasteboard.general.items.compactMap(Self.write)
    guard !files.isEmpty else { return false }
    sendEvent("onPaste", ["files": files])
    return true
  }

  private static func write(_ item: [String: Any]) -> [String: Any]? {
    let images = item.compactMap { key, value in UTType(key).flatMap { $0.conforms(to: .image) ? ($0, value) : nil } }
    guard let (type, value) = images.first(where: { $0.1 is Data }) ?? images.first else { return nil }
    let data: Data?
    var format = type
    if let raw = value as? Data {
      data = raw
    } else {
      data = (value as? UIImage)?.pngData()
      format = .png
    }
    guard let data else { return nil }
    let ext = format.preferredFilenameExtension ?? "png"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("paste-\(UUID().uuidString).\(ext)")
    guard (try? data.write(to: url)) != nil else { return nil }
    return ["uri": url.absoluteString, "name": "Pasted image.\(ext)", "mimeType": format.preferredMIMEType ?? "image/png", "size": data.count]
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
