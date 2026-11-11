# Changelog

One line per release. The page a block runs in and the bridge to its host (the srcdoc, the CSP, `sandbox="allow-scripts"`, the bridge `token` and its message shapes) are versioned with the package: a change that would break a block rendered by an older runtime is a major version.

## 0.1.0

- First release: the live-block runtime from Journal (#1075). `LiveBlockPreview`, `LiveBlock` for a host that shows notes it did not write, `parseCodeInfo` and `liveBlockKind`; `@2002bishwajeet/live-blocks/core` without React, and the `journal-ui` kit as `@2002bishwajeet/live-blocks/ui`.
