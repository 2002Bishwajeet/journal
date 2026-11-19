//! The native app database's key (#1361, #1364): 32 random bytes in the OS keychain (macOS
//! Keychain, Windows Credential Manager, Linux Secret Service, the iOS Keychain and the Android
//! Keystore). The page asks for it with `database_key` and opens PGlite through pglite-cipher
//! with it (src/lib/db/databaseKey.ts). Every platform has the same commands.
//!
//! With the app lock on (#1363), `database_key` hands the key out only after Touch ID, Windows
//! Hello, Face ID or the fingerprint (app_lock.rs). A Linux without a Secret Service gets a salt
//! instead, and the page derives the key from a passphrase.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

use crate::app_lock::{parent_window, Authenticator, Refusal};

/// The key's length: AES-256.
const KEY_LEN: usize = 32;
/// The passphrase salt's length.
const SALT_LEN: usize = 16;

/// What `database_key` answers: `{ "key": [..32 bytes] }`, `"missing"`,
/// `{ "passphrase": [..16 bytes] }` or `{ "locked": "cancelled" | "failed" }`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum DatabaseKey {
    Key(Vec<u8>),
    /// This device made a key before, and its keychain entry is gone. No second key is made:
    /// the encrypted database opens only with the first one, until the user resets it (#1362).
    Missing,
    /// No keychain on this Linux (#1363): the page derives the key from a passphrase with
    /// this salt (PBKDF2-SHA256).
    Passphrase(Vec<u8>),
    /// The app lock is on, and the owner wasn't confirmed. Never kept: the next call asks again.
    Locked(Refusal),
}

#[derive(Debug)]
enum KeychainError {
    /// There is no keychain at all: a Linux without a Secret Service.
    Unavailable,
    Failed(String),
}

impl From<&str> for KeychainError {
    fn from(error: &str) -> Self {
        KeychainError::Failed(error.to_owned())
    }
}

impl std::fmt::Display for KeychainError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            KeychainError::Unavailable => write!(f, "there is no system keychain"),
            KeychainError::Failed(error) => write!(f, "{error}"),
        }
    }
}

/// Where the key is kept.
trait Keychain: Send + Sync {
    /// The stored key, or `None` when there is no entry.
    fn get(&self) -> Result<Option<Vec<u8>>, KeychainError>;
    fn set(&self, key: &[u8]) -> Result<(), String>;
}

/// The OS keychain, one entry per app identifier.
struct OsKeychain {
    service: String,
}

const ENTRY_USER: &str = "database-key";

impl OsKeychain {
    #[cfg(desktop)]
    fn entry(&self) -> Result<keyring_core::Entry, KeychainError> {
        keyring::Entry::new(&self.service, ENTRY_USER)
            .map(|entry| entry.inner)
            .map_err(keychain_error)
    }

    /// The data protection keychain (#1364): this device only (never synced to iCloud or
    /// restored onto another phone), readable after the first unlock since the phone started.
    #[cfg(target_os = "ios")]
    fn entry(&self) -> Result<keyring_core::Entry, KeychainError> {
        use keyring_core::api::CredentialStoreApi;
        let policy = std::collections::HashMap::from([(
            "access-policy",
            "after-first-unlock-this-device-only",
        )]);
        apple_native_keyring_store::protected::Store::new()
            .and_then(|store| store.build(&self.service, ENTRY_USER, Some(&policy)))
            .map_err(keychain_error)
    }

    /// An app-private SharedPreferences file whose secrets a key in the Android Keystore
    /// encrypts (#1364). The key never leaves the phone, and the file stays out of backups
    /// (res/xml/data_extraction_rules.xml).
    #[cfg(target_os = "android")]
    fn entry(&self) -> Result<keyring_core::Entry, KeychainError> {
        use keyring_core::api::CredentialStoreApi;
        android_native_keyring_store::Store::new()
            .and_then(|store| store.build(&self.service, ENTRY_USER, None))
            .map_err(keychain_error)
    }
}

/// keyring has no Secret Service to connect to: it set up no store (#1363).
fn keychain_error(error: keyring_core::Error) -> KeychainError {
    match error {
        keyring_core::Error::NoDefaultStore if cfg!(target_os = "linux") => {
            KeychainError::Unavailable
        }
        error => KeychainError::Failed(error.to_string()),
    }
}

impl Keychain for OsKeychain {
    fn get(&self) -> Result<Option<Vec<u8>>, KeychainError> {
        match self.entry()?.get_secret() {
            Ok(key) => Ok(Some(key)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_error(e)),
        }
    }

    fn set(&self, key: &[u8]) -> Result<(), String> {
        self.entry()
            .map_err(|e| e.to_string())?
            .set_secret(key)
            .map_err(|e| e.to_string())
    }
}

/// Files in the app data dir.
struct Files {
    /// This device has made a keychain key.
    made: PathBuf,
    /// The passphrase salt, on a Linux without a keychain.
    salt: PathBuf,
    /// The app lock is on.
    lock: PathBuf,
}

impl Files {
    fn in_dir(dir: PathBuf) -> Self {
        Files {
            made: dir.join("database-key-made"),
            salt: dir.join("database-key-salt"),
            lock: dir.join("app-lock"),
        }
    }
}

fn write_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, contents).map_err(|e| e.to_string())
}

/// The key, made on the first launch. `made` records that this device has made one, so a
/// launch that finds no keychain entry answers `Missing` instead of making a second key. A
/// keychain error is an error: it never makes a key. With no keychain at all on the first
/// launch, the device uses a passphrase from then on, and the salt file records that.
fn load_or_create(keychain: &dyn Keychain, files: &Files) -> Result<DatabaseKey, String> {
    if let Ok(salt) = fs::read(&files.salt) {
        return Ok(DatabaseKey::Passphrase(salt));
    }
    match keychain.get() {
        Ok(Some(key)) if key.len() != KEY_LEN => {
            return Err("the database key in the keychain is not 32 bytes".into())
        }
        Ok(Some(key)) => return Ok(DatabaseKey::Key(key)),
        Ok(None) if files.made.exists() => return Ok(DatabaseKey::Missing),
        Ok(None) => {}
        Err(KeychainError::Unavailable) if !files.made.exists() => {
            let mut salt = vec![0; SALT_LEN];
            getrandom::fill(&mut salt).map_err(|e| e.to_string())?;
            write_file(&files.salt, &salt)?;
            return Ok(DatabaseKey::Passphrase(salt));
        }
        Err(e) => return Err(e.to_string()),
    }
    let mut key = vec![0; KEY_LEN];
    getrandom::fill(&mut key).map_err(|e| e.to_string())?;
    keychain.set(&key)?;
    // After the keychain has the key: a crash between the two leaves a key and no file, and
    // the next launch reads that key.
    write_file(&files.made, b"")?;
    Ok(DatabaseKey::Key(key))
}

/// After the page deleted the encrypted database (#1362): the key the keychain still has, or a
/// new one when its entry is gone. The old database never opens with a new key, so only the
/// reset makes one. A passphrase device gets a new salt, so the user can choose a new one.
fn reset(keychain: &dyn Keychain, files: &Files) -> Result<DatabaseKey, String> {
    if files.salt.exists() {
        fs::remove_file(&files.salt).map_err(|e| e.to_string())?;
    } else if keychain.get().map_err(|e| e.to_string())?.is_none() && files.made.exists() {
        fs::remove_file(&files.made).map_err(|e| e.to_string())?;
    }
    load_or_create(keychain, files)
}

// macOS shows "Journal is trying to <reason>."; the phone shows the reason as it is.
const UNLOCK_REASON: &str = if cfg!(mobile) {
    "Unlock your notes"
} else {
    "unlock your notes"
};
const TURN_ON_REASON: &str = if cfg!(mobile) {
    "Turn on the app lock"
} else {
    "turn on the app lock"
};

struct KeyState {
    keychain: Box<dyn Keychain>,
    auth: Box<dyn Authenticator>,
    files: Files,
    /// The keychain is read once per launch; every window (main, quick capture) and a
    /// reload get this answer, until Lock now or the lock timeout (`lock_database`). An error
    /// or a refused unlock isn't kept, so the boot screen's Retry or Unlock asks again.
    answer: Mutex<Option<DatabaseKey>>,
}

/// `database_key`: with the app lock on, the owner confirms before the keychain is read.
fn unlock(state: &KeyState, window: isize) -> Result<DatabaseKey, String> {
    let mut answer = state.answer.lock().unwrap();
    if let Some(answer) = answer.as_ref() {
        return Ok(answer.clone());
    }
    if state.files.lock.exists() {
        if let Err(refusal) = state.auth.authenticate(UNLOCK_REASON, window) {
            return Ok(DatabaseKey::Locked(refusal));
        }
    }
    let key = load_or_create(state.keychain.as_ref(), &state.files)?;
    *answer = Some(key.clone());
    Ok(key)
}

/// Async, so a keychain or biometric prompt never blocks the main thread.
#[tauri::command]
async fn database_key<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, KeyState>,
) -> Result<DatabaseKey, String> {
    unlock(&state, parent_window(&window))
}

/// "Reset local data and sync again" (#1362), after the page deleted the database. This launch's
/// later `database_key` calls (the reload) get the new answer.
#[tauri::command]
async fn reset_database_key(state: tauri::State<'_, KeyState>) -> Result<(), String> {
    let mut answer = state.answer.lock().unwrap();
    *answer = Some(reset(state.keychain.as_ref(), &state.files)?);
    Ok(())
}

/// Settings -> Security (#1363).
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityStatus {
    /// Touch ID, Windows Hello, Face ID or a fingerprint can confirm the owner, so the lock is
    /// offered.
    lock_available: bool,
    lock_on: bool,
    /// The key comes from a passphrase: this Linux has no keychain.
    passphrase: bool,
}

#[tauri::command]
async fn security_status(state: tauri::State<'_, KeyState>) -> Result<SecurityStatus, String> {
    Ok(SecurityStatus {
        lock_available: state.auth.available(),
        lock_on: state.files.lock.exists(),
        passphrase: state.files.salt.exists(),
    })
}

/// Turning the lock on asks the owner first, so it never locks out someone who can't unlock.
/// Answers the refusal, or `None` once it's set.
fn set_lock(state: &KeyState, on: bool, window: isize) -> Result<Option<Refusal>, String> {
    if !on {
        if state.files.lock.exists() {
            fs::remove_file(&state.files.lock).map_err(|e| e.to_string())?;
        }
        return Ok(None);
    }
    if !state.auth.available() {
        return Err("this device can't confirm its owner".into());
    }
    if let Err(refusal) = state.auth.authenticate(TURN_ON_REASON, window) {
        return Ok(Some(refusal));
    }
    write_file(&state.files.lock, b"")?;
    Ok(None)
}

#[tauri::command]
async fn set_app_lock<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, KeyState>,
    on: bool,
) -> Result<Option<Refusal>, String> {
    set_lock(&state, on, parent_window(&window))
}

/// Lock now, or the lock timeout: the next `database_key` asks the owner again. The page
/// reloads, so the key it had goes with the worker.
#[tauri::command]
async fn lock_database(state: tauri::State<'_, KeyState>) -> Result<(), String> {
    if state.files.lock.exists() {
        *state.answer.lock().unwrap() = None;
    }
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

fn plugin_with<R: Runtime>(
    keychain: fn(&str) -> Box<dyn Keychain>,
    auth: fn(&AppHandle<R>) -> Box<dyn Authenticator>,
) -> TauriPlugin<R> {
    Builder::new("journal-db-key")
        .invoke_handler(tauri::generate_handler![
            database_key,
            reset_database_key,
            security_status,
            set_app_lock,
            lock_database
        ])
        .setup(move |app, _api| {
            app.manage(KeyState {
                keychain: keychain(&app.config().identifier),
                auth: auth(app),
                files: Files::in_dir(app.path().app_data_dir()?),
                answer: Mutex::new(None),
            });
            app.add_capability(capability())?;
            Ok(())
        })
        .build()
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    #[cfg(desktop)]
    let auth: fn(&AppHandle<R>) -> Box<dyn Authenticator> =
        |_| Box::new(crate::app_lock::OsAuthenticator);
    #[cfg(mobile)]
    let auth: fn(&AppHandle<R>) -> Box<dyn Authenticator> =
        |app| Box::new(crate::app_lock::MobileAuthenticator(app.clone()));
    plugin_with(
        |service| {
            Box::new(OsKeychain {
                service: service.to_owned(),
            })
        },
        auth,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

    /// A keychain in memory that counts its reads and writes.
    #[derive(Default)]
    struct MockKeychain {
        entry: Mutex<Option<Vec<u8>>>,
        reads: AtomicUsize,
        writes: AtomicUsize,
        broken: bool,
        /// A Linux without a Secret Service.
        absent: bool,
    }

    impl Keychain for MockKeychain {
        fn get(&self) -> Result<Option<Vec<u8>>, KeychainError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.absent {
                return Err(KeychainError::Unavailable);
            }
            if self.broken {
                return Err("the keychain is locked".into());
            }
            Ok(self.entry.lock().unwrap().clone())
        }

        fn set(&self, key: &[u8]) -> Result<(), String> {
            if self.absent {
                return Err("there is no system keychain".into());
            }
            self.writes.fetch_add(1, Ordering::SeqCst);
            *self.entry.lock().unwrap() = Some(key.to_vec());
            Ok(())
        }
    }

    /// Touch ID that answers `answer` and counts its prompts.
    struct MockAuth {
        answer: Mutex<Result<(), Refusal>>,
        prompts: AtomicUsize,
    }

    impl MockAuth {
        fn answering(answer: Result<(), Refusal>) -> Self {
            MockAuth {
                answer: Mutex::new(answer),
                prompts: AtomicUsize::new(0),
            }
        }
    }

    impl Authenticator for MockAuth {
        fn available(&self) -> bool {
            true
        }

        fn authenticate(&self, _reason: &str, _window: isize) -> Result<(), Refusal> {
            self.prompts.fetch_add(1, Ordering::SeqCst);
            self.answer.lock().unwrap().clone()
        }
    }

    /// Lets a test change and count the answers of the state's keychain and Touch ID.
    impl Authenticator for std::sync::Arc<MockAuth> {
        fn available(&self) -> bool {
            true
        }

        fn authenticate(&self, reason: &str, window: isize) -> Result<(), Refusal> {
            self.as_ref().authenticate(reason, window)
        }
    }

    impl Keychain for std::sync::Arc<MockKeychain> {
        fn get(&self) -> Result<Option<Vec<u8>>, KeychainError> {
            self.as_ref().get()
        }

        fn set(&self, key: &[u8]) -> Result<(), String> {
            self.as_ref().set(key)
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

        fn files(&self) -> Files {
            Files::in_dir(self.0.join("app-data"))
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
            other => panic!("expected a key, got {other:?}"),
        }
    }

    #[test]
    fn the_first_launch_makes_one_key_and_a_restart_gets_the_same_one() {
        let scratch = Scratch::new();
        let keychain = MockKeychain::default();

        let first = key_of(load_or_create(&keychain, &scratch.files()).unwrap());
        assert_eq!(first.len(), KEY_LEN);
        assert_ne!(first, vec![0; KEY_LEN]);
        assert!(scratch.files().made.exists());

        // A restart: a new read of the same keychain and app data.
        let again = key_of(load_or_create(&keychain, &scratch.files()).unwrap());
        assert_eq!(again, first);
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_key_whose_entry_is_gone_is_missing_and_never_replaced() {
        let scratch = Scratch::new();
        let keychain = MockKeychain::default();
        load_or_create(&keychain, &scratch.files()).unwrap();

        *keychain.entry.lock().unwrap() = None;
        assert_eq!(
            load_or_create(&keychain, &scratch.files()).unwrap(),
            DatabaseKey::Missing
        );
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 1);
        assert_eq!(*keychain.entry.lock().unwrap(), None);
    }

    #[test]
    fn a_reset_makes_a_new_key_only_when_the_entry_is_gone() {
        let scratch = Scratch::new();
        let keychain = MockKeychain::default();
        let first = key_of(load_or_create(&keychain, &scratch.files()).unwrap());

        // A damaged database: the keychain still has the key, and the reset keeps it.
        assert_eq!(key_of(reset(&keychain, &scratch.files()).unwrap()), first);
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 1);
        assert!(scratch.files().made.exists());

        *keychain.entry.lock().unwrap() = None;
        let second = key_of(reset(&keychain, &scratch.files()).unwrap());
        assert_ne!(second, first);
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 2);
        // A restart reads the new key.
        assert_eq!(
            key_of(load_or_create(&keychain, &scratch.files()).unwrap()),
            second
        );
    }

    #[test]
    fn a_keychain_error_makes_no_key() {
        let scratch = Scratch::new();
        let keychain = MockKeychain {
            broken: true,
            ..Default::default()
        };
        assert!(load_or_create(&keychain, &scratch.files()).is_err());
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 0);
        assert!(!scratch.files().made.exists());
    }

    #[test]
    fn a_key_of_the_wrong_length_is_an_error() {
        let scratch = Scratch::new();
        let keychain = MockKeychain::default();
        *keychain.entry.lock().unwrap() = Some(vec![1; 16]);
        assert!(load_or_create(&keychain, &scratch.files()).is_err());
    }

    fn salt_of(answer: DatabaseKey) -> Vec<u8> {
        match answer {
            DatabaseKey::Passphrase(salt) => salt,
            other => panic!("expected a passphrase, got {other:?}"),
        }
    }

    #[test]
    fn no_keychain_on_the_first_launch_means_a_passphrase_with_one_salt() {
        let scratch = Scratch::new();
        let keychain = MockKeychain {
            absent: true,
            ..Default::default()
        };
        let salt = salt_of(load_or_create(&keychain, &scratch.files()).unwrap());
        assert_eq!(salt.len(), SALT_LEN);
        assert_eq!(
            salt_of(load_or_create(&keychain, &scratch.files()).unwrap()),
            salt
        );

        // A Secret Service that turns up later doesn't change the key: the salt decides.
        let keychain = MockKeychain::default();
        assert_eq!(
            salt_of(load_or_create(&keychain, &scratch.files()).unwrap()),
            salt
        );
        assert_eq!(keychain.writes.load(Ordering::SeqCst), 0);

        // A reset lets the user choose a new passphrase.
        let keychain = MockKeychain {
            absent: true,
            ..Default::default()
        };
        assert_ne!(salt_of(reset(&keychain, &scratch.files()).unwrap()), salt);
    }

    #[test]
    fn a_keychain_that_goes_away_after_a_key_is_an_error_not_a_passphrase() {
        let scratch = Scratch::new();
        load_or_create(&MockKeychain::default(), &scratch.files()).unwrap();
        let keychain = MockKeychain {
            absent: true,
            ..Default::default()
        };
        assert!(load_or_create(&keychain, &scratch.files()).is_err());
        assert!(!scratch.files().salt.exists());
    }

    fn state(
        scratch: &Scratch,
        keychain: std::sync::Arc<MockKeychain>,
        auth: std::sync::Arc<MockAuth>,
    ) -> KeyState {
        KeyState {
            keychain: Box::new(keychain),
            auth: Box::new(auth),
            files: scratch.files(),
            answer: Mutex::new(None),
        }
    }

    #[test]
    fn the_key_command_refuses_while_the_lock_is_on_and_the_owner_isnt_confirmed() {
        let scratch = Scratch::new();
        let keychain = std::sync::Arc::new(MockKeychain {
            entry: Mutex::new(Some(vec![7; KEY_LEN])),
            ..Default::default()
        });
        let auth = std::sync::Arc::new(MockAuth::answering(Err(Refusal::Failed)));
        let state = state(&scratch, keychain.clone(), auth.clone());
        write_file(&state.files.lock, b"").unwrap();

        assert_eq!(
            unlock(&state, 0).unwrap(),
            DatabaseKey::Locked(Refusal::Failed)
        );
        *auth.answer.lock().unwrap() = Err(Refusal::Cancelled);
        assert_eq!(
            unlock(&state, 0).unwrap(),
            DatabaseKey::Locked(Refusal::Cancelled)
        );
        // The keychain was never read, and nothing was kept.
        assert_eq!(keychain.reads.load(Ordering::SeqCst), 0);
        assert_eq!(*state.answer.lock().unwrap(), None);

        *auth.answer.lock().unwrap() = Ok(());
        assert_eq!(key_of(unlock(&state, 0).unwrap()), vec![7; KEY_LEN]);
        // Kept for the rest of the launch (a reload), until Lock now.
        assert_eq!(key_of(unlock(&state, 0).unwrap()), vec![7; KEY_LEN]);
        assert_eq!(auth.prompts.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn without_the_lock_the_key_command_never_prompts() {
        let scratch = Scratch::new();
        let keychain = std::sync::Arc::new(MockKeychain::default());
        let auth = std::sync::Arc::new(MockAuth::answering(Err(Refusal::Failed)));
        let state = state(&scratch, keychain, auth.clone());
        key_of(unlock(&state, 0).unwrap());
        assert_eq!(auth.prompts.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn turning_the_lock_on_needs_the_owner_and_off_does_not() {
        let scratch = Scratch::new();
        let auth = std::sync::Arc::new(MockAuth::answering(Err(Refusal::Cancelled)));
        let state = state(
            &scratch,
            std::sync::Arc::new(MockKeychain::default()),
            auth.clone(),
        );

        assert_eq!(set_lock(&state, true, 0).unwrap(), Some(Refusal::Cancelled));
        assert!(!state.files.lock.exists());

        *auth.answer.lock().unwrap() = Ok(());
        assert_eq!(set_lock(&state, true, 0).unwrap(), None);
        assert!(state.files.lock.exists());

        *auth.answer.lock().unwrap() = Err(Refusal::Failed);
        assert_eq!(set_lock(&state, false, 0).unwrap(), None);
        assert!(!state.files.lock.exists());
        assert_eq!(auth.prompts.load(Ordering::SeqCst), 2);
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
        assert_eq!(
            serde_json::to_value(DatabaseKey::Passphrase(vec![3])).unwrap(),
            serde_json::json!({ "passphrase": [3] })
        );
        assert_eq!(
            serde_json::to_value(DatabaseKey::Locked(Refusal::Cancelled)).unwrap(),
            serde_json::json!({ "locked": "cancelled" })
        );
        assert_eq!(
            serde_json::to_value(SecurityStatus {
                lock_available: true,
                lock_on: false,
                passphrase: false
            })
            .unwrap(),
            serde_json::json!({ "lockAvailable": true, "lockOn": false, "passphrase": false })
        );
    }

    fn ipc(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        command: &str,
        url: &str,
    ) -> Result<serde_json::Value, serde_json::Value> {
        tauri::test::get_ipc_response(
            webview,
            tauri::webview::InvokeRequest {
                cmd: format!("plugin:journal-db-key|{command}"),
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
            .plugin(plugin_with(
                |_| {
                    Box::new(MockKeychain {
                        entry: Mutex::new(Some(vec![7; KEY_LEN])),
                        ..Default::default()
                    })
                },
                |_| Box::new(MockAuth::answering(Ok(()))),
            ))
            .build(tauri::generate_context!())
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let own = format!("http://localhost:{}/", crate::PORT);

        let key = serde_json::json!({ "key": vec![7; KEY_LEN] });
        assert_eq!(ipc(&webview, "database_key", &own).unwrap(), key);
        assert_eq!(
            ipc(&webview, "database_key", &own).unwrap(),
            key,
            "the same answer all launch"
        );
        assert!(ipc(&webview, "database_key", "https://example.com/").is_err());
        assert!(ipc(&webview, "database_key", "http://localhost:1234/").is_err());
        assert!(ipc(
            &webview,
            "database_key",
            &format!("http://127.0.0.1:{}/", crate::PORT)
        )
        .is_err());
        // The lock's commands have the same guard.
        assert!(ipc(&webview, "security_status", &own).is_ok());
        assert!(ipc(&webview, "lock_database", &own).is_ok());
        assert!(ipc(&webview, "security_status", "https://example.com/").is_err());
        assert!(ipc(&webview, "lock_database", "https://example.com/").is_err());
    }
}
