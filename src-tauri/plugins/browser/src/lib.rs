//! Opens web pages outside the app's web view on iOS and Android (#1188):
//!
//! - `open_url`: an in-app browser sheet, SFSafariViewController on iOS and
//!   Custom Tabs on Android, for external links.
//! - `authenticate` (iOS): an ASWebAuthenticationSession for the YouAuth sign-in,
//!   resolving with the `journal://` callback URL. Android signs in through
//!   `open_url`, and the callback comes back as a deep link.
//!
//! The commands run in `ios/` and `android/`; this crate only registers them.
//! Desktop opens links with tauri-plugin-opener instead.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_browser);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("browser")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("app.tauri.browser", "BrowserPlugin")?;
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_browser)?;
            Ok(())
        })
        .build()
}
