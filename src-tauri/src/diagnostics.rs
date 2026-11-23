//! The page's diagnostic lines (#1467): a database that stopped answering, or a navigation that
//! never rendered (src/lib/db/dbHealth.ts, src/lib/navWatch.ts). `append_diagnostic` adds one
//! timestamped line to `db-hangs.log` in the platform log dir (`~/Library/Logs/<bundle id>/` on
//! macOS), where it outlives the page and the app. The page sends no note content: SQL prefixes
//! without their literal values, paths, lock names. Past `MAX_LOG_BYTES` the log moves to
//! `db-hangs.log.1`, replacing the one there. Granted to the main window (capabilities/default.json).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

const LOG_NAME: &str = "db-hangs.log";
const MAX_LOG_BYTES: u64 = 1_000_000;
/// The longest line kept: a diagnostic is a few hundred bytes.
const MAX_LINE_BYTES: usize = 4_096;

/// Appends `line` to the log at `path` as one line after `timestamp`.
fn append(path: &Path, timestamp: &str, line: &str) -> std::io::Result<()> {
    if fs::metadata(path).is_ok_and(|meta| meta.len() >= MAX_LOG_BYTES) {
        fs::rename(path, path.with_extension("log.1"))?;
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut line = line.replace(['\r', '\n'], " ");
    if line.len() > MAX_LINE_BYTES {
        let mut end = MAX_LINE_BYTES;
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        line.truncate(end);
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{timestamp} {line}")
}

#[tauri::command]
fn append_diagnostic<R: Runtime>(app: tauri::AppHandle<R>, line: String) -> Result<(), String> {
    let path = app.path().app_log_dir().map_err(|e| e.to_string())?.join(LOG_NAME);
    append(&path, &time::OffsetDateTime::now_utc().to_string(), &line).map_err(|e| e.to_string())
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("journal-diagnostics")
        .invoke_handler(tauri::generate_handler![append_diagnostic])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_log(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("journal-diagnostics-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("logs").join(LOG_NAME)
    }

    #[test]
    fn appends_one_timestamped_line_per_call() {
        let path = temp_log("append");
        append(&path, "2026-11-23 10:00:00", "db-unresponsive: a").unwrap();
        append(&path, "2026-11-23 10:00:30", "nav-stuck /f/n\nsecond line").unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "2026-11-23 10:00:00 db-unresponsive: a\n2026-11-23 10:00:30 nav-stuck /f/n second line\n"
        );
    }

    #[test]
    fn moves_a_full_log_aside_and_starts_a_new_one() {
        let path = temp_log("rotate");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
        append(&path, "t", "newest").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "t newest\n");
        assert_eq!(fs::metadata(path.with_extension("log.1")).unwrap().len(), MAX_LOG_BYTES);
    }

    #[test]
    fn cuts_a_long_line() {
        let path = temp_log("long");
        append(&path, "t", &"é".repeat(MAX_LINE_BYTES)).unwrap();
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.len() <= MAX_LINE_BYTES + "t \n".len());
    }
}
