import Tauri
import UIKit

struct ShareArgs: Decodable {
  let path: String
}

struct ShareTextArgs: Decodable {
  let text: String
  let title: String?
}

class ExportPlugin: Plugin {
  /// The share sheet for the file at `path` (Save to Files, AirDrop, another app).
  /// Resolves with `shared` false when the user closes it without picking one.
  @objc public func share(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    present(invoke, item: URL(fileURLWithPath: args.path))
  }

  /// The share sheet for a piece of text. The web view's `navigator.share` anchors the
  /// sheet to the tapped button and clips it, so this one is centred like `share`'s.
  @objc public func shareText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareTextArgs.self)
    present(invoke, item: args.text, subject: args.title)
  }

  private func present(_ invoke: Invoke, item: Any, subject: String? = nil) {
    DispatchQueue.main.async {
      guard let viewController = self.manager.viewController else {
        invoke.reject("no view controller")
        return
      }
      let sheet = UIActivityViewController(activityItems: [item], applicationActivities: nil)
      if let subject = subject { sheet.setValue(subject, forKey: "subject") }
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
