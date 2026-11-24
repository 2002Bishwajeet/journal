//! Saves a file the user exports (#1205), only where the user picks:
//!
//! - Desktop: a native Save dialog (rfd, as in the app's lib.rs), and the file is
//!   written to the path picked there.
//! - iOS and Android: the system share sheet (UIActivityViewController, an
//!   ACTION_SEND chooser), so it can go to Files, Drive or AirDrop. The sheet reads
//!   the file from `<app cache>/export/`, which the next export empties. Android
//!   hands it out through the app's FileProvider (gen/android's
//!   AndroidManifest.xml), which covers the cache directory.

use std::ffi::OsStr;
use std::path::Path;

use base64::Engine;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

#[cfg(mobile)]
use tauri::Manager;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_export);

/// The Swift or Kotlin plugin that shows the share sheet.
#[cfg(mobile)]
struct Share<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// Saves `data` (base64) as `name`. False when the user cancels the Save dialog or
/// the iOS share sheet; Android can't tell, so true once its share sheet is open.
#[tauri::command]
async fn save<R: Runtime>(app: AppHandle<R>, name: String, data: String) -> Result<bool, String> {
    // A plain file name, so the phone's copy stays in the export folder.
    if Path::new(&name).file_name() != Some(OsStr::new(&name)) {
        return Err("not a file name".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    deliver(app, name, bytes).await
}

/// Asks where to save with the Save dialog and writes the file there.
#[cfg(desktop)]
async fn deliver<R: Runtime>(app: AppHandle<R>, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    // rfd runs on the main thread once GTK's event loop owns it, as in the app's lib.rs.
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(rfd::FileDialog::new().set_file_name(name).save_file());
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rx.recv().map_err(|e| e.to_string())? else {
            return Ok(false);
        };
        std::fs::write(path, bytes).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes the file to the app's cache and hands it to the share sheet.
#[cfg(mobile)]
async fn deliver<R: Runtime>(app: AppHandle<R>, name: String, bytes: Vec<u8>) -> Result<bool, String> {
    #[derive(serde::Serialize)]
    struct ShareArgs {
        path: std::path::PathBuf,
    }
    #[derive(serde::Deserialize)]
    struct Shared {
        shared: bool,
    }

    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("export");
    // Only this export stays: the share sheet is done with the last one.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let shared: Shared = app
        .state::<Share<R>>()
        .0
        .run_mobile_plugin_async("share", ShareArgs { path })
        .await
        .map_err(|e| e.to_string())?;
    Ok(shared.shared)
}

/// Shares `text` through the system share sheet. Centred like `save`'s, because the
/// web view's `navigator.share` anchors the iOS sheet to the tapped button and clips it.
/// False when the user closes it; Android can't tell, so true once its sheet is open.
#[tauri::command]
async fn share_text<R: Runtime>(app: AppHandle<R>, text: String, title: Option<String>) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        #[derive(serde::Serialize)]
        struct TextArgs {
            text: String,
            title: Option<String>,
        }
        #[derive(serde::Deserialize)]
        struct Shared {
            shared: bool,
        }
        let shared: Shared = app
            .state::<Share<R>>()
            .0
            .run_mobile_plugin_async("shareText", TextArgs { text, title })
            .await
            .map_err(|e| e.to_string())?;
        Ok(shared.shared)
    }
    // Diagnostics shows Share on mobile only.
    #[cfg(desktop)]
    {
        let _ = (app, text, title);
        Ok(false)
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("export")
        .invoke_handler(tauri::generate_handler![save, share_text])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin("app.tauri.export", "ExportPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_export)?;
            #[cfg(mobile)]
            _app.manage(Share(handle));
            Ok(())
        })
        .build()
}
