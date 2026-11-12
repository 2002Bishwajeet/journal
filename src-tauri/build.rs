use std::collections::BTreeMap;
use std::path::Path;

use tauri_build::{Attributes, DefaultPermissionRule, InlinedPlugin};

fn main() {
    // Paid features from the optional private submodule at ../native
    // (journal-native-features). When it's checked out, lib.rs compiles
    // native/rust/mod.rs as `mod premium`; otherwise a no-op stub. Its presence,
    // not a Cargo feature, is the switch, so Cargo.toml and Cargo.lock are the
    // same with or without it (CI runs `--locked`). A plain optional path
    // dependency doesn't work: Cargo reads its manifest even when it's off.
    println!("cargo:rustc-check-cfg=cfg(journal_premium)");
    println!("cargo:rerun-if-changed=../native");
    let mut attributes = Attributes::new();
    let mut plugins = Vec::new();
    if Path::new("../native/rust/mod.rs").exists() {
        println!("cargo:rustc-cfg=journal_premium");
        // native/rust/plugins.json names the premium plugins and their commands,
        // e.g. {"premium": ["ping"]}. Tauri denies a plugin command that has no
        // permission, so each plugin gets a `<plugin>:default` allowing all of
        // its commands; lib.rs grants it to the main window.
        let json = std::fs::read_to_string("../native/rust/plugins.json")
            .expect("native/rust/plugins.json");
        let manifest: BTreeMap<String, Vec<String>> =
            serde_json::from_str(&json).expect("native/rust/plugins.json");
        for (name, commands) in manifest {
            let commands: Vec<&'static str> = commands.into_iter().map(|c| &*c.leak()).collect();
            let plugin = InlinedPlugin::new()
                .commands(commands.leak())
                .default_permission(DefaultPermissionRule::AllowAllCommands);
            attributes = attributes.plugin(name.clone().leak(), plugin);
            plugins.push(name);
        }
    }
    // lib.rs: window.__JOURNAL_NATIVE__.plugins and the grants above.
    println!(
        "cargo:rustc-env=JOURNAL_NATIVE_PLUGINS={}",
        plugins.join(",")
    );
    if let Err(e) = tauri_build::try_build(attributes) {
        panic!("{e:#}");
    }
}
