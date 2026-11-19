//! The app lock's check that the owner is at the device (#1363, #1364): Touch ID or the account
//! password through LocalAuthentication on macOS, Windows Hello on Windows, and on the phone
//! Face ID / Touch ID (iOS) or BiometricPrompt (Android) through tauri-plugin-biometric, with the
//! passcode or screen lock as the fallback. Linux has no biometric API, so the lock isn't
//! offered there. db_key.rs asks before it hands out the key.

use serde::Serialize;

/// Why the owner wasn't confirmed.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Refusal {
    /// They closed the prompt, or the system did.
    #[cfg_attr(target_os = "linux", allow(dead_code))]
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

#[cfg(desktop)]
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

#[cfg(target_os = "linux")]
impl Authenticator for OsAuthenticator {
    fn available(&self) -> bool {
        false
    }

    fn authenticate(&self, _reason: &str, _window: isize) -> Result<(), Refusal> {
        Err(Refusal::Failed)
    }
}

/// The phone's check, through the biometric plugin (registered in lib.rs).
#[cfg(mobile)]
pub struct MobileAuthenticator<R: tauri::Runtime>(pub tauri::AppHandle<R>);

#[cfg(mobile)]
impl<R: tauri::Runtime> Authenticator for MobileAuthenticator<R> {
    /// Face ID, Touch ID or a fingerprint or face is set up, so the lock is offered.
    fn available(&self) -> bool {
        use tauri_plugin_biometric::BiometricExt;
        self.0
            .biometric()
            .status()
            .is_ok_and(|status| status.is_available)
    }

    /// The passcode or screen lock is the fallback, so the lock never shuts out a phone whose
    /// fingerprints or face were removed.
    fn authenticate(&self, reason: &str, _window: isize) -> Result<(), Refusal> {
        use tauri::plugin::mobile::PluginInvokeError;
        use tauri_plugin_biometric::{AuthOptions, BiometricExt, Error};

        let options = AuthOptions {
            allow_device_credential: true,
            // The prompt's title on Android; iOS shows the app's name itself.
            title: Some(self.0.package_info().name.clone()),
            ..Default::default()
        };
        match self.0.biometric().authenticate(reason.to_owned(), options) {
            Ok(()) => Ok(()),
            Err(Error::PluginInvoke(PluginInvokeError::InvokeRejected(rejected))) => {
                Err(refusal(rejected.code.as_deref()))
            }
            Err(_) => Err(Refusal::Failed),
        }
    }
}

/// The biometric plugin's rejection code: LAError on iOS, BiometricPrompt's on Android, which
/// the plugin names alike.
#[cfg(any(mobile, test))]
fn refusal(code: Option<&str>) -> Refusal {
    match code {
        Some("userCancel" | "systemCancel" | "appCancel") => Refusal::Cancelled,
        _ => Refusal::Failed,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_phone_prompt_is_a_cancel_and_anything_else_a_failure() {
        for code in ["userCancel", "systemCancel", "appCancel"] {
            assert_eq!(refusal(Some(code)), Refusal::Cancelled, "{code}");
        }
        // Too many tries, no passcode, a prompt that couldn't show, or no code at all.
        for code in [
            Some("biometryLockout"),
            Some("authenticationFailed"),
            Some("passcodeNotSet"),
            Some("invalidContext"),
            None,
        ] {
            assert_eq!(refusal(code), Refusal::Failed, "{code:?}");
        }
    }
}
