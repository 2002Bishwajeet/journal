import Tauri
import UIKit

struct ShareArgs: Decodable {
  let path: String
}

class ExportPlugin: Plugin {
  /// The share sheet for the file at `path` (Save to Files, AirDrop, another app).
  /// Resolves with `shared` false when the user closes it without picking one.
  @objc public func share(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    let url = URL(fileURLWithPath: args.path)
    DispatchQueue.main.async {
      guard let viewController = self.manager.viewController else {
        invoke.reject("no view controller")
        return
      }
      let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
      sheet.completionWithItemsHandler = { _, completed, _, error in
        if let error = error {
          invoke.reject(error.localizedDescription)
        } else {
          invoke.resolve(["shared": completed])
        }
      }
      // On iPad the sheet is a popover, which needs an anchor: the middle of the app.
      if let popover = sheet.popoverPresentationController {
        let view = viewController.view!
        popover.sourceView = view
        popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        popover.permittedArrowDirections = []
      }
      viewController.present(sheet, animated: true)
    }
  }
}

@_cdecl("init_plugin_export")
public func initPlugin() -> Plugin {
  return ExportPlugin()
}
