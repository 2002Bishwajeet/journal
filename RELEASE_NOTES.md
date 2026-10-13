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

### Changed

- On your public page, each shared folder shows in its own box. The box shows the folder name, the number of notes and a link to open the folder.

## 2.11.4 (2026-10-13)

### New

- A shared note shows "On this page" next to the text. It lists the sections of the note. Select a section to go to it. You can hide the list.
- On a phone, "On this page" is a list above the text. Open it to see the sections.
- A link to a section of a shared note opens the note at that section.
- A shared folder has its own link preview. It shows the folder name, the number of notes and the author.

### Fixed

- A shared folder's link opens the folder page. Before, the app opened instead of the folder page.

## 2.11.3 (2026-10-13)

### Changed

- When you collapse the sidebar, each folder shows the first letter of its name. A dot shows a shared folder.

### Fixed

- The sidebar opens smoothly. It does not become too wide first.

## 2.11.2 (2026-10-13)

### Fixed

- Links in HTML and React blocks open in a new tab when you click them.

## 2.11.1 (2026-10-13)

### New

- "Share folder" opens a window. It shows the folder link and a preview of the link. You can copy the link there.
- Your public page shows your shared folders and their notes. Notes that you share one by one show below them.
- You can keep a shared note off your public page. Turn off "Show on my public page" in the Share window. People with the link can still open the note. Search engines do not show it.

### Changed

- Journal shares the notes in a folder faster. It shares 4 notes at the same time.

### Fixed

- The menu of a table row or column opens the first time that you put the pointer on it.

## 2.11.0 (2026-10-13)

### New

- You can share a folder. All notes in the folder become public. New notes that you make in the folder are also public.
- When you stop sharing a folder, all notes in it become private again.
- A shared folder has a public page that shows a list of its notes. Select "Folder link" in the folder menu to copy the link.
- You can rename a folder. Right-click the folder and select "Rename Folder".
- You can move a note to a different folder. Right-click the note and select "Move to folder".
- A note that you move into a shared folder becomes public. A note that you move out of a shared folder becomes private.
- When you share a note that links to private notes, Journal shows them. You can make them public too, or continue without them.
- AI agents that use the Journal MCP make public notes when they write in a shared folder.

### Fixed

- Links to other notes work on shared notes. They open the shared page of the linked note.
- A long folder name in the sidebar ends with "…". Put the pointer on the name to see all of it.

## 2.10.0 (2026-10-12)

### New

- You can write your own caption for an image. You can also hide the caption.
- You can crop, rotate and flip an image. The original image stays the same, so you can change or undo the edit later.
- Put two or more images side by side in a gallery. Drop or paste several images at once, or type "/gallery".
- A gallery has four layouts: row, grid, masonry and carousel. Select the layout below the gallery.
- Drag an image onto another image to make a gallery. Drag images in a gallery to change their order.
- To move an image left or right in a gallery, use the arrow buttons on the image.
- On a phone, a gallery shows two images in each row.
- Shared notes show galleries, captions and image edits.
- AI agents that use the Journal MCP can make galleries. They keep the captions, sizes and edits of images.

## 2.9.1 (2026-10-12)

### Changed

- In the emoji and slash menus, you can search with more than one word, for example ":thumbs up" or "/heading 4".
- The emoji and slash menus show the best match first. They also find common words, for example ":lol", "/todo" or "/img".
- The emoji and slash menus close when no item matches your text. Then Enter starts a new line as usual.

## 2.9.0 (2026-10-12)

### New

- An image with a description shows the description under it, in the editor and on shared notes.

### Fixed

- Zen mode has an "Exit Focus" button in the toolbar. You can also press Esc to leave Zen mode.
- Zen mode no longer adds empty space above the toolbar.
- The full-size view of an uploaded image shows the image again.

## 2.8.0 (2026-10-12)

### New

- You can replace an image and keep its place, size and description.
- You can download an image from its toolbar or from the full-size view.
- In the full-size view of an image, you can zoom up to 4 times and drag to move the image. Double-click to go back to the full image.
- Headings 4, 5 and 6 have their own sizes. You can add them from the toolbar on a phone.

### Changed

- The width setting now also applies in Zen mode.
- AI agents that use the Journal MCP make HTML and React blocks that fit a phone screen. The MCP warns them when a block is too wide.

### Fixed

- The size and alignment of an image stay the same in Markdown export and import, for AI agents, and on the shared page.
- On a phone, the shared page shows every image at the full width of the text.
- In Zen mode, you can use the toolbars and menus at the top of the page again.
- The slash, emoji and note-link menus scroll to the selected item when you use the arrow keys.

## 2.7.1 (2026-10-09)

### Changed

- HTML and React blocks no longer have an Expand button.
- In a code block, Select All selects only the code. Press it again to select the whole note.

### Fixed

- Outlines and shadows at the edge of an HTML or React block are no longer cut off.
- Your author page lists all your public notes. "Hide from search engines" now only keeps a note out of search engines.

## 2.7.0 (2026-10-09)

### New

- An HTML or React block can be wide. A wide block uses more of the page and stays centred under the text.
- Each HTML or React block has an Expand button. It shows the block on the full screen. Press Esc to close it.
- React blocks can use d3, three, lodash, mathjs and papaparse. They also have a set of ready UI parts in the Journal style.
- React blocks can use shadows, custom sizes and colours, and layouts that change with the width of the screen.
- Markdown import makes real headings, lists, code blocks and footnotes. It also imports the images in a zip file.
- AI agents that use the Journal MCP can read a guide to all the blocks a note can have.
- AI agents can change one block of a note, for example one table cell or the text of a callout.
- AI agents can add links to other notes and link preview cards.
- AI agents can put images in the body of a note.

### Fixed

- Images in a note show in full. Before, the bottom of an image was cut off.
- The note title updates when the title changes in a different place.
- The Move to Trash dialog no longer says that you cannot undo the action. You can restore the note from Trash.
- After you change the page layout, the editor no longer adds an empty line.
- A shared note shows its newest text and cover to readers who open it again.

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
