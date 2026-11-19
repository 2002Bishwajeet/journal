//! The app lock's check that the owner is at the computer (#1363): Touch ID or the account
//! password through LocalAuthentication on macOS, Windows Hello on Windows. Linux has no
//! biometric API, so the lock isn't offered there. db_key.rs asks before it hands out the key.

use serde::Serialize;

/// Why the owner wasn't confirmed.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Refusal {
    /// They closed the prompt, or the system did.
    #[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
    Cancelled,
    /// Wrong finger or password too often, or the check couldn't run.
    Failed,
}

pub trait Authenticator: Send + Sync {
    /// Whether this computer can confirm its owner.
    fn available(&self) -> bool;
    /// Shows the system prompt and waits for the answer. `window` is the HWND it belongs to
    /// on Windows, unused elsewhere.
    fn authenticate(&self, reason: &str, window: isize) -> Result<(), Refusal>;
}

pub struct OsAuthenticator;

#[cfg(target_os = "macos")]
impl Authenticator for OsAuthenticator {
    fn available(&self) -> bool {
        use objc2_local_authentication::{LAContext, LAPolicy};
        let context = unsafe { LAContext::new() };
        unsafe { context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication) }.is_ok()
    }

    /// Touch ID, with the account password as the fallback, so the lock never shuts out a Mac
    /// whose fingerprints were removed.
    fn authenticate(&self, reason: &str, _window: isize) -> Result<(), Refusal> {
        use objc2::runtime::Bool;
        use objc2_foundation::{NSError, NSString};
        use objc2_local_authentication::{LAContext, LAError, LAPolicy};

        let context = unsafe { LAContext::new() };
        let (answer, reply) = std::sync::mpsc::channel();
        // LocalAuthentication calls this once, on a queue of its own.
        let done = block2::RcBlock::new(move |ok: Bool, error: *mut NSError| {
            let code = unsafe { error.as_ref() }.map_or(0, |error| error.code());
            let _ = answer.send((ok.as_bool(), code));
        });
        unsafe {
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthentication,
                &NSString::from_str(reason),
                &done,
            )
        };
        match reply.recv() {
            Ok((true, _)) => Ok(()),
            Ok((false, code))
                if [
                    LAError::UserCancel,
                    LAError::SystemCancel,
                    LAError::AppCancel,
                ]
                .iter()
                .any(|cancel| cancel.0 == code) =>
            {
                Err(Refusal::Cancelled)
            }
            _ => Err(Refusal::Failed),
        }
    }
}

#[cfg(target_os = "windows")]
impl Authenticator for OsAuthenticator {
    fn available(&self) -> bool {
        use windows::Security::Credentials::UI::{
            UserConsentVerifier, UserConsentVerifierAvailability,
        };
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|check| check.join())
            .is_ok_and(|availability| availability == UserConsentVerifierAvailability::Available)
    }

    /// Windows Hello (face, fingerprint or PIN), its prompt owned by the app's window.
    fn authenticate(&self, reason: &str, window: isize) -> Result<(), Refusal> {
        use windows::core::{factory, HSTRING};
        use windows::Security::Credentials::UI::{
            UserConsentVerificationResult, UserConsentVerifier,
        };
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
        use windows_future::IAsyncOperation;

        let verify = || -> windows::core::Result<UserConsentVerificationResult> {
            let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
            let check: IAsyncOperation<UserConsentVerificationResult> = unsafe {
                interop
                    .RequestVerificationForWindowAsync(HWND(window as _), &HSTRING::from(reason))?
            };
            check.join()
        };
        match verify() {
            Ok(result) if result == UserConsentVerificationResult::Verified => Ok(()),
            Ok(result) if result == UserConsentVerificationResult::Canceled => {
                Err(Refusal::Cancelled)
            }
            _ => Err(Refusal::Failed),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl Authenticator for OsAuthenticator {
    fn available(&self) -> bool {
        false
    }

    fn authenticate(&self, _reason: &str, _window: isize) -> Result<(), Refusal> {
        Err(Refusal::Failed)
    }
}

/// The HWND a Windows Hello prompt belongs to; 0 elsewhere.
pub fn parent_window<R: tauri::Runtime>(window: &tauri::Window<R>) -> isize {
    #[cfg(target_os = "windows")]
    return window.hwnd().map_or(0, |hwnd| hwnd.0 as isize);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        0
    }
}
