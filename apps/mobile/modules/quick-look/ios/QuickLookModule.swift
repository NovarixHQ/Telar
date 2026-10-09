import ExpoModulesCore
import QuickLook

public final class QuickLookModule: Module {
  private var shown: PreviewSource?

  public func definition() -> ModuleDefinition {
    Name("TelarQuickLook")

    AsyncFunction("preview") { (url: URL) -> Bool in
      guard let presenter = self.appContext?.utilities?.currentViewController() else { return false }
      let source = PreviewSource(url: url)
      self.shown = source
      let controller = QLPreviewController()
      controller.dataSource = source
      presenter.present(controller, animated: true)
      return true
    }.runOnQueue(.main)
  }
}

// QLPreviewController holds its data source weakly, so the module keeps the last one alive.
private final class PreviewSource: NSObject, QLPreviewControllerDataSource {
  let url: URL

  init(url: URL) { self.url = url }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
}
