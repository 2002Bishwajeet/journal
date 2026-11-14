use std::path::Path;

fn main() {
    // Paid features from the optional private submodule at ../native
    // (journal-native-features). When it's checked out, lib.rs compiles
    // native/rust/mod.rs as `mod premium`; otherwise a no-op stub. Its presence,
    // not a Cargo feature, is the switch, so Cargo.toml and Cargo.lock are the
    // same with or without it (CI runs `--locked`). A plain optional path
    // dependency doesn't work: Cargo reads its manifest even when it's off.
    println!("cargo:rustc-check-cfg=cfg(journal_premium)");
    println!("cargo:rerun-if-changed=../native");
    // set_style in lib.rs: the iOS status bar follows the in-app theme (#1080).
    let mut attributes = tauri_build::Attributes::new().plugin(
        "system-bars",
        tauri_build::InlinedPlugin::new()
            .commands(&["set_style"])
            .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
    );
    // Benchmark-only commands (src/bench.rs, #1245). Their capability is in
    // capabilities/encfs-bench/, read only with the feature. The app's own
    // permissions are the generated ones for these commands and nothing in
    // ./permissions, where a bench build leaves its generated files behind.
    let bench = std::env::var_os("CARGO_FEATURE_ENCFS_BENCH").is_some();
    let commands: &[&str] = if bench {
        &["bench_blob_put", "bench_blob_get", "bench_reset", "bench_token"]
    } else {
        &[]
    };
    attributes = attributes.app_manifest(tauri_build::AppManifest::new().commands(commands).permissions_path_pattern("./permissions/*.toml"));
    if !bench {
        println!("cargo:rerun-if-changed=capabilities");
        attributes = attributes.capabilities_path_pattern("./capabilities/*.json");
    }
    let mut names = Vec::new();
    if Path::new("../native/rust/mod.rs").exists() {
        println!("cargo:rustc-cfg=journal_premium");
        // The premium plugins' commands (native/rust/plugins.txt, one plugin per line:
        // its name, then its commands). Each gets an `allow-<command>` permission, which
        // the plugin grants the main window at runtime (`app.add_capability`), so the
        // public capabilities/ never names them.
        if let Ok(plugins) = std::fs::read_to_string("../native/rust/plugins.txt") {
            for line in plugins.lines().filter(|l| !l.trim().is_empty()) {
                let mut words = line.split_whitespace().map(|w| &*Box::leak(w.to_owned().into_boxed_str()));
                let name = words.next().unwrap();
                let commands: &'static [&'static str] = Box::leak(words.collect::<Vec<_>>().into_boxed_slice());
                attributes = attributes.plugin(
                    name,
                    tauri_build::InlinedPlugin::new()
                        .commands(commands)
                        .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
                );
                names.push(name);
            }
        }
        // The store purchase's StoreKit 2 plugin (native/rust/iap.rs) and Apple's on-device model
        // (native/rust/apple_ai.rs, #1266) are Swift packages native/apple/<name>, built and
        // linked for iOS as tauri-plugin builds a plugin's ios/ folder: a crate can't be a
        // dependency only when native/ is there.
        #[cfg(target_os = "macos")]
        for name in ["JournalIap", "JournalAppleAi"] {
            if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") && Path::new(&format!("../native/apple/{name}/Package.swift")).exists() {
                link_premium_swift(name);
            }
        }
    }
    // lib.rs puts the names in window.__JOURNAL_NATIVE__.plugins.
    println!("cargo:rustc-env=JOURNAL_NATIVE_PLUGINS={}", names.join(","));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

/// Builds and links the Swift package native/apple/<name>, which depends on Tauri's Swift API
/// at native/apple/.tauri/tauri-api (git-ignored there), copied from the tauri crate.
#[cfg(target_os = "macos")]
fn link_premium_swift(name: &str) {
    fn copy(from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            if [".build", "Package.resolved", "Tests"].iter().any(|skip| entry.file_name() == *skip) {
                continue;
            }
            if entry.file_type()?.is_dir() {
                copy(&entry.path(), &to.join(entry.file_name()))?;
            } else {
                std::fs::copy(entry.path(), to.join(entry.file_name()))?;
            }
        }
        Ok(())
    }
    let tauri_api = std::env::var("DEP_TAURI_IOS_LIBRARY_PATH").expect("tauri gives its Swift API's path to the crates that depend on it");
    let target = Path::new("../native/apple/.tauri/tauri-api");
    let _ = std::fs::remove_dir_all(target);
    copy(Path::new(&tauri_api), target).expect("failed to copy Tauri's Swift API to native/apple/.tauri");
    let source = std::fs::canonicalize(format!("../native/apple/{name}")).unwrap();
    tauri_utils::build::link_apple_library(name, source);
}
