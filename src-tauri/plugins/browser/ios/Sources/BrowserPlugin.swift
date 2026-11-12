import AuthenticationServices
import SafariServices
import Tauri
import UIKit

struct OpenUrlArgs: Decodable {
  let url: String
}

struct AuthenticateArgs: Decodable {
  let url: String
  let callbackScheme: String
}

/// The http(s) URL in `string`, or nil. SFSafariViewController throws on any other scheme.
private func webUrl(_ string: String) -> URL? {
  guard let url = URL(string: string), let scheme = url.scheme?.lowercased() else { return nil }
  return scheme == "https" || scheme == "http" ? url : nil
}

class BrowserPlugin: Plugin, ASWebAuthenticationPresentationContextProviding {
  // ASWebAuthenticationSession ends when it is released, so hold it until it calls back.
  private var session: ASWebAuthenticationSession?

  /// External links: a Safari sheet over the app.
  @objc public func openUrl(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(OpenUrlArgs.self)
    guard let url = webUrl(args.url) else {
      invoke.reject("not an http(s) URL")
      return
    }
    DispatchQueue.main.async {
      guard let viewController = self.manager.viewController else {
        invoke.reject("no view controller")
        return
      }
      viewController.present(SFSafariViewController(url: url), animated: true)
      invoke.resolve()
    }
  }

  /// Sign-in: the identity's authorize page in an auth session that shares Safari's
  /// cookies. Resolves with the callback URL once the identity redirects to
  /// `callbackScheme://...`, and with no URL when the user closes the sheet.
  @objc public func authenticate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AuthenticateArgs.self)
    guard let url = webUrl(args.url) else {
      invoke.reject("not an http(s) URL")
      return
    }
    DispatchQueue.main.async {
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: args.callbackScheme) {
        callback, error in
        self.session = nil
        if let callback = callback {
          invoke.resolve(["url": callback.absoluteString])
        } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
          invoke.resolve()
        } else {
          invoke.reject(error?.localizedDescription ?? "sign-in failed")
        }
      }
      session.presentationContextProvider = self
      self.session = session
      if !session.start() {
        self.session = nil
        invoke.reject("can't start the sign-in session")
      }
    }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return manager.viewController?.view.window ?? ASPresentationAnchor()
  }
}

@_cdecl("init_plugin_browser")
public func initPlugin() -> Plugin {
  return BrowserPlugin()
}
