// The command the web view calls (src/lib/native.ts). `share` and `shareText`, in the Swift and
// Kotlin classes below, have no permission: only `save` and `share_text` in src/lib.rs call them.
const COMMANDS: &[&str] = &["save", "share_text"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
