// The command the web view calls (src/lib/native.ts). `share`, in the Swift and
// Kotlin classes below, has no permission: only `save` in src/lib.rs calls it.
const COMMANDS: &[&str] = &["save"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
