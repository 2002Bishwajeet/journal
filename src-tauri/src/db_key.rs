//! The native app database's key (#1361, #1364): 32 random bytes in the OS keychain (macOS
//! Keychain, Windows Credential Manager, Linux Secret Service, the iOS Keychain and the Android
//! Keystore). The page asks for it with `database_key` and opens PGlite through pglite-cipher
//! with it (src/lib/db/databaseKey.ts). Every platform has the same commands.
//!
//! With the app lock on (#1363), `database_key` hands the key out only after Touch ID, Windows
//! Hello, Face ID or the fingerprint (app_lock.rs). A Linux without a Secret Service gets a salt
//! instead, and the page derives the key from a passphrase.
//!
//! The Homebase sign-in (the app's shared secret and token) is in a second entry (#1429):
//! `auth_secrets`, `set_auth_secret` and `clear_auth_secrets`, read at boot by
//! src/lib/native/secureStorage.ts in place of localStorage.
//!
//! Closing a desktop window waits up to `CLOSE_FLUSH_TIMEOUT` for its page to seal its unload
//! copies of edits (#1429): `close_flushed` is the page's answer.

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime};

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
    /// Deletes the entry; no entry is fine.
    fn delete(&self) -> Result<(), String>;
}

/// An OS keychain entry of the app identifier.
struct OsKeychain {
    service: String,
    user: &'static str,
}

const ENTRY_USER: &str = "database-key";
const SECRETS_USER: &str = "auth-secrets";

impl OsKeychain {
    #[cfg(desktop)]
    fn entry(&self) -> Result<keyring_core::Entry, KeychainError> {
        keyring::Entry::new(&self.service, self.user)
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
            .and_then(|store| store.build(&self.service, self.user, Some(&policy)))
            .map_err(keychain_error)
    }

    /// An app-private SharedPreferences file whose secrets a key in the Android Keystore
    /// encrypts (#1364). The key never leaves the phone, and the file stays out of backups
    /// (res/xml/data_extraction_rules.xml).
    #[cfg(target_os = "android")]
    fn entry(&self) -> Result<keyring_core::Entry, KeychainError> {
        use keyring_core::api::CredentialStoreApi;
        android_native_keyring_store::Store::new()
            .and_then(|store| store.build(&self.service, self.user, None))
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

    fn delete(&self) -> Result<(), String> {
        match self.entry().map_err(|e| e.to_string())?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
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
    /// The sign-in's entry, and the lock for its read-modify-write (two windows can write).
    secrets: Mutex<Box<dyn Keychain>>,
    closing: CloseGate,
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

/// What `auth_secrets` answers: `{ "secrets": { key: value } }`, or `"unavailable"` on a Linux
/// without a keychain, where the page keeps them in localStorage.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AuthSecrets {
    Secrets(BTreeMap<String, String>),
    Unavailable,
}

/// The only keys the entry keeps: Journal's STORAGE_KEY_SHARED_SECRET and STORAGE_KEY_AUTH_TOKEN
/// (src/lib/homebase/config.ts). odin-js's peer tokens stay in the page's memory: they grow
/// with every collaborator, and Windows refuses an entry over 2560 bytes.
const SIGN_IN_KEYS: [&str; 2] = ["APSS", "BX0900"];
/// The longest value kept. Both are a few dozen characters; with this cap the entry stays far
/// under Windows' 2560 bytes.
const MAX_SECRET_LEN: usize = 512;

/// A map an older build wrote with other keys keeps only the sign-in's. One that isn't JSON
/// at all reads as empty, and the next write replaces it: an error here would sign the user
/// out for good.
fn read_secrets(keychain: &dyn Keychain) -> Result<AuthSecrets, String> {
    match keychain.get() {
        Ok(Some(json)) => {
            let mut secrets: BTreeMap<String, String> = serde_json::from_slice(&json)
                .unwrap_or_else(|e| {
                    eprintln!("the sign-in in the keychain isn't JSON, so it's dropped: {e}");
                    BTreeMap::new()
                });
            secrets.retain(|key, _| SIGN_IN_KEYS.contains(&key.as_str()));
            Ok(AuthSecrets::Secrets(secrets))
        }
        Ok(None) => Ok(AuthSecrets::Secrets(BTreeMap::new())),
        Err(KeychainError::Unavailable) => Ok(AuthSecrets::Unavailable),
        Err(e) => Err(e.to_string()),
    }
}

/// Sets one value, or removes it with `None`, keeping the others.
fn write_secret(keychain: &dyn Keychain, key: String, value: Option<String>) -> Result<(), String> {
    if !SIGN_IN_KEYS.contains(&key.as_str()) {
        return Err(format!("{key} isn't kept in the keychain"));
    }
    if value
        .as_ref()
        .is_some_and(|value| value.len() > MAX_SECRET_LEN)
    {
        return Err(format!("{key} is too long for the keychain"));
    }
    let AuthSecrets::Secrets(mut secrets) = read_secrets(keychain)? else {
        return Err(KeychainError::Unavailable.to_string());
    };
    match value {
        Some(value) => secrets.insert(key, value),
        None => secrets.remove(&key),
    };
    keychain.set(&serde_json::to_vec(&secrets).map_err(|e| e.to_string())?)
}

/// What the other windows hear after a window changed the sign-in: that window's label. They
/// read `auth_secrets` again (secureStorage.ts).
const SECRETS_CHANGED: &str = "journal://auth-secrets-changed";

/// Never behind the app lock: the page needs the sign-in to show the lock screen at all.
#[tauri::command]
async fn auth_secrets(state: tauri::State<'_, KeyState>) -> Result<AuthSecrets, String> {
    read_secrets(state.secrets.lock().unwrap().as_ref())
}

#[tauri::command]
async fn set_auth_secret<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, KeyState>,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    write_secret(state.secrets.lock().unwrap().as_ref(), key, value)?;
    let _ = window.emit(SECRETS_CHANGED, window.label());
    Ok(())
}

/// Sign-out: deletes the whole entry.
#[tauri::command]
async fn clear_auth_secrets<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, KeyState>,
) -> Result<(), String> {
    state.secrets.lock().unwrap().delete()?;
    let _ = window.emit(SECRETS_CHANGED, window.label());
    Ok(())
}

/// How long closing a desktop window waits for its page to seal its unload copies of edits.
#[cfg(desktop)]
const CLOSE_FLUSH_TIMEOUT: Duration = Duration::from_millis(1500);
/// What a closing window's page hears; it answers with `close_flushed`.
#[cfg(desktop)]
const FLUSH_BEFORE_CLOSE: &str = "journal://flush-before-close";

/// The windows whose close waits for their page, by label.
#[derive(Default)]
struct CloseGate(Mutex<HashMap<String, Closing>>);

enum Closing {
    /// The page was asked to flush; this hears its answer.
    Waiting(mpsc::Sender<()>),
    /// The page answered, or the wait ran out: the next close request goes through.
    Released,
}

/// What a close request does.
#[cfg_attr(mobile, allow(dead_code))]
enum CloseRequest {
    /// Hold the close, ask the page, and close again once this hears back or times out.
    Wait(mpsc::Receiver<()>),
    /// A close is already waiting for the page: hold this one too.
    Hold,
    /// Let it close.
    Go,
}

#[cfg_attr(mobile, allow(dead_code))]
impl CloseGate {
    fn requested(&self, label: &str) -> CloseRequest {
        let mut windows = self.0.lock().unwrap();
        match windows.remove(label) {
            Some(Closing::Released) => CloseRequest::Go,
            Some(waiting) => {
                windows.insert(label.to_owned(), waiting);
                CloseRequest::Hold
            }
            None => {
                let (answer, heard) = mpsc::channel();
                windows.insert(label.to_owned(), Closing::Waiting(answer));
                CloseRequest::Wait(heard)
            }
        }
    }

    fn flushed(&self, label: &str) {
        if let Some(Closing::Waiting(answer)) = self.0.lock().unwrap().get(label) {
            let _ = answer.send(());
        }
    }

    /// After the wait: the close that follows goes through.
    fn release(&self, label: &str) {
        self.0
            .lock()
            .unwrap()
            .insert(label.to_owned(), Closing::Released);
    }
}

/// Waits for the page's answer, at most `timeout`, so a page that never answers can't keep the
/// window open.
#[cfg(desktop)]
fn wait_for_flush(heard: &mpsc::Receiver<()>, timeout: Duration) -> bool {
    heard.recv_timeout(timeout).is_ok()
}

/// The page sealed its unload copies: its window can close.
#[tauri::command]
async fn close_flushed<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, KeyState>,
) -> Result<(), String> {
    state.closing.flushed(window.label());
    Ok(())
}

/// A window's close waits for its page (`CLOSE_FLUSH_TIMEOUT` at most), then closes again.
/// Another plugin may still keep the window (the menu bar app hides it instead).
#[cfg(desktop)]
fn on_close_requested<R: Runtime>(app: &AppHandle<R>, label: &str, api: &tauri::CloseRequestApi) {
    let Some(state) = app.try_state::<KeyState>() else {
        return;
    };
    let heard = match state.closing.requested(label) {
        CloseRequest::Go => return,
        CloseRequest::Hold => {
            api.prevent_close();
            return;
        }
        CloseRequest::Wait(heard) => heard,
    };
    api.prevent_close();
    let _ = app.emit_to(
        tauri::EventTarget::webview_window(label),
        FLUSH_BEFORE_CLOSE,
        (),
    );
    let app = app.clone();
    let label = label.to_owned();
    std::thread::spawn(move || {
        wait_for_flush(&heard, CLOSE_FLUSH_TIMEOUT);
        app.state::<KeyState>().closing.release(&label);
        match app.get_webview_window(&label) {
            Some(window) => {
                let _ = window.close();
            }
            None => {
                app.state::<KeyState>()
                    .closing
                    .0
                    .lock()
                    .unwrap()
                    .remove(&label);
            }
        }
    });
}

/// Only the app's own page, `http://localhost:{PORT}`, may ask for the key. A dev build also
/// allows its dev server (`devUrl`, Tauri's local origin there); a release build allows no
/// local origin at all. Every window may listen for events: the quick capture window has no
/// other capability, and it hears the main window's sign-in changes and its own close.
fn capability() -> String {
    format!(
        r#"{{"identifier":"journal-db-key","windows":["*"],"local":{},"remote":{{"urls":["http://localhost:{}"]}},"permissions":["journal-db-key:default","core:event:allow-listen","core:event:allow-unlisten"]}}"#,
        tauri::is_dev(),
        crate::PORT
    )
}

fn plugin_with<R: Runtime>(
    keychain: fn(&str, &'static str) -> Box<dyn Keychain>,
    auth: fn(&AppHandle<R>) -> Box<dyn Authenticator>,
) -> TauriPlugin<R> {
    Builder::new("journal-db-key")
        .invoke_handler(tauri::generate_handler![
            database_key,
            reset_database_key,
            security_status,
            set_app_lock,
            lock_database,
            auth_secrets,
            set_auth_secret,
            clear_auth_secrets,
            close_flushed
        ])
        .setup(move |app, _api| {
            app.manage(KeyState {
                keychain: keychain(&app.config().identifier, ENTRY_USER),
                auth: auth(app),
                files: Files::in_dir(app.path().app_data_dir()?),
                answer: Mutex::new(None),
                secrets: Mutex::new(keychain(&app.config().identifier, SECRETS_USER)),
                closing: CloseGate::default(),
            });
            app.add_capability(capability())?;
            Ok(())
        })
        .on_event(|_app, _event| {
            #[cfg(desktop)]
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } = _event
            {
                on_close_requested(_app, label, api);
            }
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
        |service, user| {
            Box::new(OsKeychain {
                service: service.to_owned(),
                user,
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

        fn delete(&self) -> Result<(), String> {
            *self.entry.lock().unwrap() = None;
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

        fn delete(&self) -> Result<(), String> {
            self.as_ref().delete()
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
            secrets: Mutex::new(Box::new(MockKeychain::default())),
            closing: CloseGate::default(),
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
                |_, user| {
                    let entry = (user == ENTRY_USER).then(|| vec![7; KEY_LEN]);
                    Box::new(MockKeychain {
                        entry: Mutex::new(entry),
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
        // And the sign-in's (#1429).
        assert_eq!(
            ipc(&webview, "auth_secrets", &own).unwrap(),
            serde_json::json!({ "secrets": {} })
        );
        assert!(ipc(&webview, "auth_secrets", "https://example.com/").is_err());
        assert!(ipc(&webview, "auth_secrets", "http://localhost:1234/").is_err());
        assert!(ipc(&webview, "clear_auth_secrets", "https://example.com/").is_err());
        assert!(ipc(&webview, "close_flushed", &own).is_ok());
        assert!(ipc(&webview, "close_flushed", "https://example.com/").is_err());
    }

    fn secrets_of(keychain: &MockKeychain) -> BTreeMap<String, String> {
        match read_secrets(keychain).unwrap() {
            AuthSecrets::Secrets(secrets) => secrets,
            other => panic!("expected secrets, got {other:?}"),
        }
    }

    #[test]
    fn the_sign_in_secrets_are_set_and_removed_one_at_a_time() {
        let keychain = MockKeychain::default();
        assert!(secrets_of(&keychain).is_empty());

        write_secret(&keychain, "APSS".into(), Some("secret".into())).unwrap();
        write_secret(&keychain, "BX0900".into(), Some("token".into())).unwrap();
        assert_eq!(
            secrets_of(&keychain),
            BTreeMap::from([
                ("APSS".to_owned(), "secret".to_owned()),
                ("BX0900".to_owned(), "token".to_owned())
            ])
        );

        // Sign-out removes them, and clearing deletes the entry itself.
        write_secret(&keychain, "APSS".into(), None).unwrap();
        assert_eq!(
            secrets_of(&keychain),
            BTreeMap::from([("BX0900".to_owned(), "token".to_owned())])
        );
        keychain.delete().unwrap();
        assert!(keychain.entry.lock().unwrap().is_none());
        assert!(secrets_of(&keychain).is_empty());
    }

    /// Windows refuses a credential over 2560 bytes (CRED_MAX_CREDENTIAL_BLOB_SIZE), and every
    /// write after that would fail: the entry keeps only the two sign-in values, each capped.
    #[test]
    fn the_sign_in_entry_stays_far_under_the_windows_limit() {
        let keychain = MockKeychain::default();
        // Peer tokens, one per collaborator, stay out.
        assert!(write_secret(
            &keychain,
            "odin_peer_token_frodo.dotyou.cloud".into(),
            Some("{}".into())
        )
        .is_err());
        assert!(write_secret(
            &keychain,
            "APSS".into(),
            Some("x".repeat(MAX_SECRET_LEN + 1))
        )
        .is_err());

        for key in SIGN_IN_KEYS {
            write_secret(&keychain, key.into(), Some("x".repeat(MAX_SECRET_LEN))).unwrap();
        }
        let stored = keychain.entry.lock().unwrap().clone().unwrap();
        assert!(stored.len() < 2560 / 2, "{} bytes", stored.len());
    }

    #[test]
    fn an_older_entry_keeps_only_the_sign_in_and_a_damaged_one_reads_as_empty() {
        let keychain = MockKeychain {
            entry: Mutex::new(Some(
                br#"{"APSS":"secret","odin_peer_token_a":"{}"}"#.to_vec(),
            )),
            ..Default::default()
        };
        assert_eq!(
            secrets_of(&keychain),
            BTreeMap::from([("APSS".to_owned(), "secret".to_owned())])
        );
        write_secret(&keychain, "BX0900".into(), Some("token".into())).unwrap();
        assert_eq!(
            keychain.entry.lock().unwrap().clone().unwrap(),
            br#"{"APSS":"secret","BX0900":"token"}"#.to_vec()
        );

        // Not JSON: empty, then overwritten by the next write.
        *keychain.entry.lock().unwrap() = Some(b"\xff not json".to_vec());
        assert!(secrets_of(&keychain).is_empty());
        write_secret(&keychain, "APSS".into(), Some("new".into())).unwrap();
        assert_eq!(
            secrets_of(&keychain),
            BTreeMap::from([("APSS".to_owned(), "new".to_owned())])
        );
    }

    #[test]
    fn a_close_waits_for_the_page_once_then_goes_through() {
        let gate = CloseGate::default();
        let CloseRequest::Wait(heard) = gate.requested("main") else {
            panic!("the first close request waits for the page");
        };
        // A second click while it waits is held too.
        assert!(matches!(gate.requested("main"), CloseRequest::Hold));
        // Another window has its own wait.
        assert!(matches!(gate.requested("capture"), CloseRequest::Wait(_)));

        gate.flushed("main");
        assert!(wait_for_flush(&heard, Duration::from_secs(5)));
        gate.release("main");
        assert!(matches!(gate.requested("main"), CloseRequest::Go));
        // The next close (a window the menu bar app kept, shown again) waits again.
        assert!(matches!(gate.requested("main"), CloseRequest::Wait(_)));
    }

    #[test]
    fn a_page_that_never_answers_doesnt_keep_the_window_open() {
        let gate = CloseGate::default();
        let CloseRequest::Wait(heard) = gate.requested("main") else {
            panic!("the first close request waits for the page");
        };
        let started = std::time::Instant::now();
        assert!(!wait_for_flush(&heard, Duration::from_millis(50)));
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(CLOSE_FLUSH_TIMEOUT <= Duration::from_millis(1500));
    }

    #[test]
    fn no_keychain_means_the_sign_in_stays_where_it_was() {
        let keychain = MockKeychain {
            absent: true,
            ..Default::default()
        };
        assert_eq!(read_secrets(&keychain).unwrap(), AuthSecrets::Unavailable);
        assert!(write_secret(&keychain, "APSS".into(), Some("secret".into())).is_err());
        assert_eq!(
            serde_json::to_value(AuthSecrets::Unavailable).unwrap(),
            serde_json::json!("unavailable")
        );

        let broken = MockKeychain {
            broken: true,
            ..Default::default()
        };
        assert!(read_secrets(&broken).is_err());
    }
}
