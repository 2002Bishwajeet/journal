# Release notes

<!--
Users read this file in the app (What's new) and on the GitHub release.
Write in ASD-STE100 Simplified Technical English:
- One topic in each sentence. Max 20 words in a sentence.
- Active voice. Simple present tense when possible ("The app keeps", not "is being kept").
- Use common words with one meaning. Do not use internal names (Yjs, PGlite, payload, sync pull).
- Tell the user what they can do or what changed for them, not how the code changed.

A PR with a change that users can see adds a bullet under "Unreleased", in one of:
### New, ### Changed, ### Fixed.
Manual Release moves "Unreleased" to the new version and stops if it is empty.
-->

## Unreleased

## 2.4.0 (2026-10-06)

### New

- After an update, the app shows what is new in that version.
- In Settings, About, you can see what changed in recent versions.

## 2.3.1 (2026-10-06)

### New

- You can add a cover image to a note. You can change, move or remove it.
- A public note shows its cover image on the share page and in link previews.
- Code blocks can show Mermaid diagrams, SVG images and HTML pages.
- The editor has toggle blocks and callout blocks.
- When you paste a link, the editor shows a card with the title, description and image of the page.
- The app keeps older versions of a note. You can restore an older version.
- You can delete a tag from all notes. Use the tag menu in the sidebar.
- You can collapse the Folders and Tags sections in the sidebar. The app keeps this setting.
- You can turn the header row of a table on or off. You can delete a table.
- In Settings, Appearance, you can select the editor font and the page width.
- A reader of a shared note can save a copy to their own Journal.
- The share dialog shows the link preview. You can write a description and stop search engines from showing the note.

### Changed

- New tables have no header row. Table columns fit their content.
- The share dialog uses two columns on a computer and the full screen on a phone.
- The share page has a wider column, a header and a footer.
- Settings show the real storage use, the sync status and the app version.
- Cover images are sharp on high-resolution screens.
- The note list and sync are faster when you have many notes.

### Fixed

- Sync does not mark a note as saved before it sends all of your changes.
- "Make public" and "Make private" do not replace your latest changes with an older copy.
- The app removes the location (GPS) data from a cover image before it uploads the image.
- If a note does not download during sync, the app tries again. Before, the app could lose the note.
- After an update, the app does not show an empty page.
