// The commands the web view calls (src/lib/native.ts). Tauri forwards them to
// the Swift and Kotlin classes below, with their names in lowerCamelCase.
const COMMANDS: &[&str] = &["open_url", "authenticate"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
