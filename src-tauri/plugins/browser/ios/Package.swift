// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-browser",
  platforms: [
    .iOS(.v13)
  ],
  products: [
    .library(
      name: "tauri-plugin-browser",
      type: .static,
      targets: ["tauri-plugin-browser"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-browser",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
