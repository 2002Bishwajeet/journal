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
    if Path::new("../native/rust/mod.rs").exists() {
        println!("cargo:rustc-cfg=journal_premium");
    }
    tauri_build::build()
}
