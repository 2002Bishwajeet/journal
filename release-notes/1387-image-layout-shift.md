### Changed

- Images in a note keep their size while they load, so the text below them does not jump when you scroll. A small blurred copy of the image shows in its place until the full image arrives. This works in the editor and on the share page.
- Journal MCP: `get_note` can return `data-width` and `data-height` on an `<img>` tag. They hold the size of the image in pixels. Keep them when you edit the note.
