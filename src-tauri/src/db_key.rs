//! The desktop database's key (#1361): 32 random bytes in the OS keychain (macOS Keychain,
//! Windows Credential Manager, Linux Secret Service). The page asks for it with
//! `database_key` and opens PGlite through pglite-cipher with it (src/lib/db/databaseKey.ts).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

/// The key's length: AES-256.
const KEY_LEN: usize = 32;

/// What `database_key` answers: `{ "key": [..32 bytes] }` or `"missing"`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum DatabaseKey {
    Key(Vec<u8>),
    /// This device made a key before, and its keychain entry is gone. No second key is made:
    /// the encrypted database opens only with the first one, until the user resets it (#1362).
    Missing,
}

/// Where the key is kept.
trait Keychain: Send + Sync {
    /// The stored key, or `None` when there is no entry.
    fn get(&self) -> Result<Option<Vec<u8>>, String>;
    fn set(&self, key: &[u8]) -> Result<(), String>;
}

/// The OS keychain, one entry per app identifier.
struct OsKeychain {
    service: String,
}

impl OsKeychain {
    fn entry(&self) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, "database-key").map_err(|e| e.to_string())
    }
}

impl Keychain for OsKeychain {
    fn get(&self) -> Result<Option<Vec<u8>>, String> {
        match self.entry()?.get_secret() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, key: &[u8]) -> Result<(), String> {
        self.entry()?.set_secret(key).map_err(|e| e.to_string())
    }
}

/// The key, made on the first launch. `made` is a file in the app data dir that records that
/// this device has made one, so a launch that finds no keychain entry answers `Missing`
/// instead of making a second key. A keychain error is an error: it never makes a key.
fn load_or_create(keychain: &dyn Keychain, made: &Path) -> Result<DatabaseKey, String> {
    if let Some(key) = keychain.get()? {
        if key.len() != KEY_LEN {
            return Err("the database key in the keychain is not 32 bytes".into());
        }
        return Ok(DatabaseKey::Key(key));
    }
    if made.exists() {
        return Ok(DatabaseKey::Missing);
    }
    let mut key = vec![0; KEY_LEN];
    getrandom::fill(&mut key).map_err(|e| e.to_string())?;
    keychain.set(&key)?;
    // After the keychain has the key: a crash between the two leaves a key and no file, and
    // the next launch reads that key.
    if let Some(dir) = made.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(made, b"").map_err(|e| e.to_string())?;
    Ok(DatabaseKey::Key(key))
}

/// After the page deleted the encrypted database (#1362): the key the keychain still has, or a
/// new one when its entry is gone. The old database never opens with a new key, so only the
/// reset makes one.
fn reset(keychain: &dyn Keychain, made: &Path) -> Result<DatabaseKey, String> {
    if keychain.get()?.is_none() && made.exists() {
        fs::remove_file(made).map_err(|e| e.to_string())?;
    }
    load_or_create(keychain, made)
}

struct KeyState {
    keychain: Box<dyn Keychain>,
    made: PathBuf,
    /// The keychain is read once per launch; every window (main, quick capture) and a
    /// reload get this answer. An error isn't kept, so the boot screen's Retry reads again.
    answer: Mutex<Option<DatabaseKey>>,
}

/// Async, so a keychain prompt never blocks the main thread.
#[tauri::command]
async fn database_key(state: tauri::State<'_, KeyState>) -> Result<DatabaseKey, String> {
    let mut answer = state.answer.lock().unwrap();
    if answer.is_none() {
        *answer = Some(load_or_create(state.keychain.as_ref(), &state.made)?);
    }
    Ok(answer.clone().unwrap())
}

/// "Reset local data and sync again" (#1362), after the page deleted the database. This launch's
/// later `database_key` calls (the reload) get the new answer.
#[tauri::command]
async fn reset_database_key(state: tauri::State<'_, KeyState>) -> Result<(), String> {
    let mut answer = state.answer.lock().unwrap();
    *answer = Some(reset(state.keychain.as_ref(), &state.made)?);
    Ok(())
}

/// Only the app's own page, `http://localhost:{PORT}`, may ask for the key. A dev build also
/// allows its dev server (`devUrl`, Tauri's local origin there); a release build allows no
/// local origin at all.
fn capability() -> String {
    format!(
        r#"{{"identifier":"journal-db-key","windows":["*"],"local":{},"remote":{{"urls":["http://localhost:{}"]}},"permissions":["journal-db-key:default"]}}"#,
        tauri::is_dev(),
        crate::PORT
    )
}

fn plugin_with<R: Runtime>(keychain: fn(&str) -> Box<dyn Keychain>) -> TauriPlugin<R> {
    Builder::new("journal-db-key")
        .invoke_handler(tauri::generate_handler![database_key, reset_database_key])
        .setup(move |app, _api| {
            app.manage(KeyState {
                keychain: keychain(&app.config().identifier),
                made: app.path().app_data_dir()?.join("database-key-made"),
                answer: Mutex::new(None),
            });
            app.add_capability(capability())?;
            Ok(())
        })
        .build()
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    plugin_with(|service| {
        Box::new(OsKeychain {
            service: service.to_owned(),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

    /// A keychain in memory that counts its writes.
    #[derive(Default)]
    struct MockKeychain {
        entry: Mutex<Option<Vec<u8>>>,
        writes: AtomicUsize,
        broken: bool,
    }

    impl Keychain for MockKeychain {
        fn get(&self) -> Result<Option<Vec<u8>>, String> {
            if self.broken {
                return Err("the keychain is locked".into());
            }
            Ok(self.entry.lock().unwrap().clone())
        }

        fn set(&self, key: &[u8]) -> Result<(), String> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            *self.entry.lock().unwrap() = Some(key.to_vec());
            Ok(())
        }
    }

    /// A scratch directory, removed when dropped.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "journal-db-key-test-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }

        fn made(&self) -> PathBuf {
            self.0.join("app-data").join("database-key-made")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn key_of(answer: DatabaseKey) -> Vec<u8> {
        match answer {
            DatabaseKey::Key(key) => key,
            DatabaseKey::Missing => panic!("expected a key"),
        }
    }

    #[test]
    fn the_first_launch_makes_one_key_and_a_restart_gets_the_same_one() {
        let scratch = Scratch::new();
        let keychain = MockKeychain::default();

        let first = key_of(load_or_create(&keychain, &scratch.made()).unwrap());
        assert_eq!(first.len(), KEY_LEN);
        assert_ne!(first, vec![0; KEY_LEN]);
        assert!(scratch.made().exists());

        // A restart: a new read of the same keychain and app data.
        let again = key_of(load_or_create(&keychain, &scratch.made()).unwrap());
        assert_eq!(again, first);
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_key_whose_entry_is_gone_is_missing_and_never_replaced() {
        let scratch = Scratch::new();
        let keychain = MockKeychain::default();
        load_or_create(&keychain, &scratch.made()).unwrap();

        *keychain.entry.lock().unwrap() = None;
        assert_eq!(
            load_or_create(&keychain, &scratch.made()).unwrap(),
            DatabaseKey::Missing
        );
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 1);
        assert_eq!(*keychain.entry.lock().unwrap(), None);
    }

    #[test]
    fn a_reset_makes_a_new_key_only_when_the_entry_is_gone() {
        let scratch = Scratch::new();
        let keychain = MockKeychain::default();
        let first = key_of(load_or_create(&keychain, &scratch.made()).unwrap());

        // A damaged database: the keychain still has the key, and the reset keeps it.
        assert_eq!(key_of(reset(&keychain, &scratch.made()).unwrap()), first);
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 1);
        assert!(scratch.made().exists());

        *keychain.entry.lock().unwrap() = None;
        let second = key_of(reset(&keychain, &scratch.made()).unwrap());
        assert_ne!(second, first);
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 2);
        // A restart reads the new key.
        assert_eq!(key_of(load_or_create(&keychain, &scratch.made()).unwrap()), second);
    }

    #[test]
    fn a_keychain_error_makes_no_key() {
        let scratch = Scratch::new();
        let keychain = MockKeychain {
            broken: true,
            ..Default::default()
        };
        assert!(load_or_create(&keychain, &scratch.made()).is_err());
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 0);
        assert!(!scratch.made().exists());
    }

    #[test]
    fn a_key_of_the_wrong_length_is_an_error() {
        let scratch = Scratch::new();
        let keychain = MockKeychain::default();
        *keychain.entry.lock().unwrap() = Some(vec![1; 16]);
        assert!(load_or_create(&keychain, &scratch.made()).is_err());
    }

    #[test]
    fn the_answer_serializes_as_the_page_reads_it() {
        assert_eq!(
            serde_json::to_value(DatabaseKey::Key(vec![1, 2])).unwrap(),
            serde_json::json!({ "key": [1, 2] })
        );
        assert_eq!(
            serde_json::to_value(DatabaseKey::Missing).unwrap(),
            serde_json::json!("missing")
        );
    }

    fn ipc(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        url: &str,
    ) -> Result<serde_json::Value, serde_json::Value> {
        tauri::test::get_ipc_response(
            webview,
            tauri::webview::InvokeRequest {
                cmd: "plugin:journal-db-key|database_key".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: url.parse().unwrap(),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize().unwrap())
    }

    /// With the app's real permissions: the page the app serves gets the key, other origins don't.
    #[test]
    fn only_the_apps_own_page_gets_the_key() {
        // A stored key, so the test never makes one or writes the real app data dir.
        let app = tauri::test::mock_builder()
            .plugin(plugin_with(|_| {
                Box::new(MockKeychain {
                    entry: Mutex::new(Some(vec![7; KEY_LEN])),
                    ..Default::default()
                })
            }))
            .build(tauri::generate_context!())
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let own = format!("http://localhost:{}/", crate::PORT);

        let key = serde_json::json!({ "key": vec![7; KEY_LEN] });
        assert_eq!(ipc(&webview, &own).unwrap(), key);
        assert_eq!(
            ipc(&webview, &own).unwrap(),
            key,
            "the same answer all launch"
        );
        assert!(ipc(&webview, "https://example.com/").is_err());
        assert!(ipc(&webview, "http://localhost:1234/").is_err());
        assert!(ipc(&webview, &format!("http://127.0.0.1:{}/", crate::PORT)).is_err());
    }
}
