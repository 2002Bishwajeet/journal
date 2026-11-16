### Changed

- The MCP `search_notes` tool matches notes that hold every word of the query, ignoring case and accents, and "double quotes" keep a phrase together. It lists title matches first, then tag matches, then body matches, each with a snippet of the text around the match. It also takes `folderId`, `tag`, `modifiedAfter` and `modifiedBefore`, and keeps note text it has read so repeated searches are faster.
