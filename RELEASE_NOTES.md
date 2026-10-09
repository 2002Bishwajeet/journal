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

## 2.6.0 (2026-10-09)

### New

- Each author has a public page that lists their public notes. It also has a sitemap, so search engines can find the notes.
- Notes that you hide from search engines are not on this page.
- On a public note, "More notes" opens the page of the author.
- A note can have a second cover for dark mode. Open the cover's "Dark mode" menu to add it.
- Links to your public notes show a designed preview card with the title, a short excerpt and your name.
- You can add footnotes from the slash menu. Footnotes show on the share page and in Markdown export.
- Readers of a shared note can tick its checkboxes and open its toggles. Their changes stay on their device.
- AI agents that use the Journal MCP can update a note and move a note to Trash.
- AI agents that use the Journal MCP can set or remove a note's cover, also for dark mode.

### Changed

- Search engines can show your public notes. You can hide a note from search engines in the share dialog.
- Long note titles wrap onto up to three lines.

### Fixed

- In dark mode, "Reposition" moves the dark mode cover.
- The note list shows the first words of a note, not code from its blocks.
- Contact pictures load again.
- Settings → Account shows "changes waiting to sync" when changes wait to sync.
- On a phone, the close button in Settings does not cover the section tabs.

## 2.5.2 (2026-10-07)

### New

- You can log in to the Journal MCP on a computer without a browser, for example over SSH. Run `journal-mcp login --no-browser`, approve in a browser on another device, and paste the code.

## 2.5.1 (2026-10-06)

### Changed

- On a public note, readers do not see the source of HTML and React blocks.

## 2.5.0 (2026-10-06)

### New

- A React code block can show charts and icons. They work offline.
- The styles of a React code block use the colours and font of your light or dark theme.
- An HTML or React code block can save its state in the note. The state syncs to your other devices.
- On a public note, readers see the saved state of a block. Their changes are not saved.

### Changed

- The app opens faster.
- Shared notes open faster.

### Fixed

- On a new device, a note that changed during the first sync goes to its correct folder.
- A cover image upload does not fail when you edit the note at the same time.
- After you delete an image and add a new one, the note does not show the old image.
- If an image upload fails, the app tries again without a new edit.

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
