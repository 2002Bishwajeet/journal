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
    let mut attributes = tauri_build::Attributes::new();
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
    }
    // lib.rs puts the names in window.__JOURNAL_NATIVE__.plugins.
    println!("cargo:rustc-env=JOURNAL_NATIVE_PLUGINS={}", names.join(","));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
