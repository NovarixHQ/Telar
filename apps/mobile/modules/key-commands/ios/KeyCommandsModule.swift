import ExpoModulesCore
import UIKit

struct KeyCommandRecord: Record {
  @Field var id: String = ""
  @Field var input: String = ""
  @Field var modifiers: [String] = []
  @Field var title: String?
}

public final class KeyCommandsModule: Module {
  fileprivate static weak var current: KeyCommandsModule?
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?

  public func definition() -> ModuleDefinition {
    Name("TelarKeyCommands")
    Events("onKeyCommand")

    OnCreate { KeyCommandsModule.current = self }
    OnDestroy { DispatchQueue.main.async { self.install([]) } }

    Function("setCommands") { (records: [KeyCommandRecord]) in
      DispatchQueue.main.async { self.install(records.map(Self.command)) }
    }
  }

  fileprivate func fire(_ id: String) {
    sendEvent("onKeyCommand", ["id": id])
  }

  // The root view controller ends every responder chain in the window, so its commands work with or without focus, as SwiftUI's shortcuts do.
  private func install(_ commands: [UIKeyCommand]) {
    installed.forEach { host?.removeKeyCommand($0) }
    host = Self.root()
    commands.forEach { host?.addKeyCommand($0) }
    installed = commands
  }

  private static func root() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
    return (windows.first(where: \.isKeyWindow) ?? windows.first)?.rootViewController
  }

  private static func command(_ record: KeyCommandRecord) -> UIKeyCommand {
    let command = UIKeyCommand(
      title: record.title ?? "",
      action: #selector(UIViewController.telarKeyCommand(_:)),
      input: record.input == "escape" ? UIKeyCommand.inputEscape : record.input,
      modifierFlags: modifierFlags(record.modifiers),
      propertyList: record.id
    )
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  private static func modifierFlags(_ names: [String]) -> UIKeyModifierFlags {
    names.reduce(into: []) { flags, name in
      switch name {
      case "command": flags.insert(.command)
      case "option": flags.insert(.alternate)
      case "shift": flags.insert(.shift)
      case "control": flags.insert(.control)
      default: break
      }
    }
  }
}

extension UIViewController {
  @objc func telarKeyCommand(_ command: UIKeyCommand) {
    guard let id = command.propertyList as? String else { return }
    KeyCommandsModule.current?.fire(id)
  }
}
