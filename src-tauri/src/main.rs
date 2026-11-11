// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Everything lives in lib.rs so the mobile targets, which build this crate as a
// library and have no `main`, can share the exact same setup.
fn main() {
    journal_lib::run()
}
