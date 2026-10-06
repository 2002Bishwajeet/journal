# [2.3.0](https://github.com/2002Bishwajeet/journal/compare/v2.2.0...v2.3.0) (2026-09-28)


### Bug Fixes

* **images:** full-viewport lightbox with the alt text as a caption ([27c4b76](https://github.com/2002Bishwajeet/journal/commit/27c4b76329d50a1bfb2f2e607e2d321084bd82f8))
* **settings:** restore the previous dialog design and make content scroll ([e12c957](https://github.com/2002Bishwajeet/journal/commit/e12c957ceccb9e780962ca24d27782cc6ed4f504))


### Features

* **mcp:** create_folder tool that grants the agent write on the new folder ([f7745a2](https://github.com/2002Bishwajeet/journal/commit/f7745a247267635a3e2399a8252d9c09367728e9))



# [2.2.0](https://github.com/2002Bishwajeet/journal/compare/v2.1.2...v2.2.0) (2026-09-28)


### Bug Fixes

* **#161:** clear the public flag locally when a public note becomes collaborative ([dfaec2f](https://github.com/2002Bishwajeet/journal/commit/dfaec2fe37e04387a947d3c5e8997033101894db)), closes [#161](https://github.com/2002Bishwajeet/journal/issues/161)
* **#161:** keep a note's archival status through sharing transitions ([0c13307](https://github.com/2002Bishwajeet/journal/commit/0c13307f5c567a84609d27038d55802484dd1a3c)), closes [#161](https://github.com/2002Bishwajeet/journal/issues/161)
* **#89:** push the promoted image src and keep edits made during an upload ([2033c42](https://github.com/2002Bishwajeet/journal/commit/2033c42b6b73f9cbfe21426829624e969c219779)), closes [#89](https://github.com/2002Bishwajeet/journal/issues/89)
* **agent-access:** keep MCP stdout clean and exit on stdin close ([#169](https://github.com/2002Bishwajeet/journal/issues/169)) ([ecd63e3](https://github.com/2002Bishwajeet/journal/commit/ecd63e3a0d630ce1ac7c5206f5a6f241cc46849f))
* **agent-access:** roll back to a removed query, not a no-op setQueryData(undefined) ([#168](https://github.com/2002Bishwajeet/journal/issues/168)) ([afc9e8b](https://github.com/2002Bishwajeet/journal/commit/afc9e8b0e20010b4cd3028622547cb13ef8507ed))
* **agent-access:** show grant controls only once the grants file has loaded ([a3411a5](https://github.com/2002Bishwajeet/journal/commit/a3411a515433afcb063bd6f207811797d53c3ca0))
* **auth:** preserve the requested URL through sign-in and stop Back-button finalize loops ([#186](https://github.com/2002Bishwajeet/journal/issues/186)) ([fa6be26](https://github.com/2002Bishwajeet/journal/commit/fa6be264c0b31c30497128187ba973b8bc8875e3))
* **auth:** register with an empty permission set, not a null one ([#246](https://github.com/2002Bishwajeet/journal/issues/246)) ([b156bba](https://github.com/2002Bishwajeet/journal/commit/b156bba6c094a947c32948e83ee6084e6dcb765a))
* **auth:** reject return URLs that normalise to a protocol-relative path ([#186](https://github.com/2002Bishwajeet/journal/issues/186)) ([b6a892f](https://github.com/2002Bishwajeet/journal/commit/b6a892f05b233132e743a4acc6edc70cd2d9a991))
* **build:** restore PGlite 0.4's process guard that Vite's define folds away ([ae07072](https://github.com/2002Bishwajeet/journal/commit/ae07072ba2f99513dd19538bb6901816b79c62ef))
* **db:** migrate PGlite 0.4 (PG17) data to 0.5 (PG18) via pg_dump ([490c159](https://github.com/2002Bishwajeet/journal/commit/490c1595007c6423c8472d65d254e181d1ce48be)), closes [#130](https://github.com/2002Bishwajeet/journal/issues/130)
* **db:** pass host identity to getCollaborativeNotesForList ([#151](https://github.com/2002Bishwajeet/journal/issues/151)) ([fbf2c52](https://github.com/2002Bishwajeet/journal/commit/fbf2c52aff041484a489f737a4f8655730a82522))
* **db:** release a PGlite lock granted to a tab that already closed ([b9a2ed5](https://github.com/2002Bishwajeet/journal/commit/b9a2ed56ee05fb939763bbf36ca384623d38a6e2))
* **db:** serialize the legacy PGlite migration across tabs with a Web Lock ([#156](https://github.com/2002Bishwajeet/journal/issues/156)) ([4366267](https://github.com/2002Bishwajeet/journal/commit/43662677fa12b5eb5b9f4373e74fd93058f91dae))
* **db:** trigger legacy recovery on data, not schema; harden keep/opt-out ([5957e01](https://github.com/2002Bishwajeet/journal/commit/5957e01ecb1725630c4c1313698aaa1770bdd5e1))
* **e2e:** drop the reload verifytoken network assertion in session-restore.live ([93ca5e7](https://github.com/2002Bishwajeet/journal/commit/93ca5e76c5a04cb9a92cc767e10e331b83323bd0)), closes [#203](https://github.com/2002Bishwajeet/journal/issues/203)
* **e2e:** give the live image spec room past the default 30s test timeout ([dc67265](https://github.com/2002Bishwajeet/journal/commit/dc672653ec3762e9c4322ea28f0d20bd1f3c1ebe))
* **e2e:** live tier fixes from the first CI attempts, drop the temporary push trigger ([ba93128](https://github.com/2002Bishwajeet/journal/commit/ba93128f2f115528699ca9cc710d8e909a86f8f7)), closes [#203](https://github.com/2002Bishwajeet/journal/issues/203)
* **e2e:** read db-ready progress from bootProgress, reject on boot error ([9122f24](https://github.com/2002Bishwajeet/journal/commit/9122f24d207063d07007515c09359c93b63fd572))
* **e2e:** scope note title/editor locators to the active tab ([7324563](https://github.com/2002Bishwajeet/journal/commit/73245630b33be14e82469bf27c10ef1ef43dae64))
* **e2e:** use a 16x16 fixture PNG and detect a failed upload eagerly ([21d3506](https://github.com/2002Bishwajeet/journal/commit/21d3506f5530547fc78ddd22167367c554f7c2fd))
* **e2e:** use a realistic image fixture and retry the flaky share click ([8e53720](https://github.com/2002Bishwajeet/journal/commit/8e53720b698d56f028126516be600d88b6c6d7cb))
* **editor:** announce local edits so other tabs on the note reload ([3b10f91](https://github.com/2002Bishwajeet/journal/commit/3b10f9101f32f3ddcd929060a6f11df94c27d006)), closes [#256](https://github.com/2002Bishwajeet/journal/issues/256)
* **editor:** compose find/replace inside TipTap's own tr/dispatch ([312206f](https://github.com/2002Bishwajeet/journal/commit/312206f088070facc8649a3ed5db15f08a039a4b))
* **editor:** create the TipTap editor after mount, not during render ([3e2f5fe](https://github.com/2002Bishwajeet/journal/commit/3e2f5feee505b367e0107ff84ea95cf642be8668))
* **editor:** don't read editor.commands during render in AISuggestionOverlay ([#247](https://github.com/2002Bishwajeet/journal/issues/247)) ([e995c0a](https://github.com/2002Bishwajeet/journal/commit/e995c0abf510dba5122dcf5f2ec031f707b1a1c4))
* **editor:** don't read editor.commands during render in FindReplaceBar ([#247](https://github.com/2002Bishwajeet/journal/issues/247)) ([1d7c125](https://github.com/2002Bishwajeet/journal/commit/1d7c1253a89d14888b88d1a138437882408e367f)), closes [#520](https://github.com/2002Bishwajeet/journal/issues/520)
* **editor:** give attachment images a definite width so they render ([084f0a8](https://github.com/2002Bishwajeet/journal/commit/084f0a8b83e0606bcd966d08b7b35b18765ce29f)), closes [#85](https://github.com/2002Bishwajeet/journal/issues/85) [#85](https://github.com/2002Bishwajeet/journal/issues/85) [pre-#85](https://github.com/pre-/issues/85) [#93](https://github.com/2002Bishwajeet/journal/issues/93)
* **editor:** render a promoted attachment even with a stale pending id ([ff4f35a](https://github.com/2002Bishwajeet/journal/commit/ff4f35a6c419861b1a3944713d83f54c241c67c3)), closes [#87](https://github.com/2002Bishwajeet/journal/issues/87)
* **editor:** route toolbar image insert through the upload queue ([#90](https://github.com/2002Bishwajeet/journal/issues/90)) ([6f7dfc3](https://github.com/2002Bishwajeet/journal/commit/6f7dfc37e770ea4e5c84a077d4030101e4749ed3))
* **error-boundary:** remove duplicated JSX that rendered as literal text ([638b8a2](https://github.com/2002Bishwajeet/journal/commit/638b8a260762e425c45b01eb556b80c2ac77e083))
* **fonts:** drop Dancing Script, keep the fonts the app actually renders ([d2b2cb1](https://github.com/2002Bishwajeet/journal/commit/d2b2cb1a72361d2d01b1b9320fc617c2d121211d))
* **fonts:** self-host Inter, Playfair Display and Dancing Script ([645d4a6](https://github.com/2002Bishwajeet/journal/commit/645d4a60895a46420dc1574e163e67e3dd7a4b27)), closes [#104](https://github.com/2002Bishwajeet/journal/issues/104)
* **images:** keep pending images visible after reload and show upload state ([#177](https://github.com/2002Bishwajeet/journal/issues/177)) ([1ca9f78](https://github.com/2002Bishwajeet/journal/commit/1ca9f7836973763d8ed899c743e1a8789dc0dce1))
* **images:** keep the retry row when image promotion fails ([#89](https://github.com/2002Bishwajeet/journal/issues/89)) ([deee419](https://github.com/2002Bishwajeet/journal/commit/deee41921b7fc1ad2cd5371d31df24953c4ccd20))
* **images:** only delete this note's own image payloads, never still-referenced ones ([#174](https://github.com/2002Bishwajeet/journal/issues/174)) ([957173d](https://github.com/2002Bishwajeet/journal/commit/957173d9869d7302468dadcfc7778f942c88a2f6))
* **images:** poll only the pending status and queue before inserting ([880c513](https://github.com/2002Bishwajeet/journal/commit/880c5137f2d11a688fd8d020dd6adbb8103145e1))
* **images:** render images in notes shared with you, stop endless peer uploads ([#178](https://github.com/2002Bishwajeet/journal/issues/178)) ([f0406ef](https://github.com/2002Bishwajeet/journal/commit/f0406efb3bc5e3f50d2a138542fef2977cfeafaf))
* keep title, tags, date and public flag on collaboration header rewrites ([#161](https://github.com/2002Bishwajeet/journal/issues/161)) ([4dbc641](https://github.com/2002Bishwajeet/journal/commit/4dbc641f48ec53fd484407b603ac1f06af06f564))
* **markdown:** escape backslashes before pipes in table cells ([#166](https://github.com/2002Bishwajeet/journal/issues/166)) ([8cb1eee](https://github.com/2002Bishwajeet/journal/commit/8cb1eee284c9a16403ab6de845f89a55d659c619))
* **mcp:** give the SDK's finalizeAuthentication a window.crypto in Node ([#167](https://github.com/2002Bishwajeet/journal/issues/167)) ([a3ab6fb](https://github.com/2002Bishwajeet/journal/commit/a3ab6fb67256e1c1f1b73c67e261e55479fada35))
* **mcp:** send drive uploads with their multipart boundary under Node ([929e72d](https://github.com/2002Bishwajeet/journal/commit/929e72de91c69f6072ec96a483b093dfd736e3a1))
* **mcp:** stop drive paging at the first empty page ([594f33a](https://github.com/2002Bishwajeet/journal/commit/594f33ad084787e77057096659d8583fc00055e9))
* **notes:** dedupe thumbnails by dimensions to fix [#292](https://github.com/2002Bishwajeet/journal/issues/292) ([7edd4aa](https://github.com/2002Bishwajeet/journal/commit/7edd4aae22861ec7fe1228f706cf83489f10ff9a))
* **pwa:** dedupe update toast with a stable id ([#288](https://github.com/2002Bishwajeet/journal/issues/288)) ([39894dc](https://github.com/2002Bishwajeet/journal/commit/39894dc3df6a61f6487a320030d113c692d5e68b))
* **pwa:** surface the update prompt when the tab regains focus ([2920683](https://github.com/2002Bishwajeet/journal/commit/29206836c20a3028a48a55775e6b7b1e0657380c))
* **routing:** close tabs for archived or missing notes and skip them on restore ([#188](https://github.com/2002Bishwajeet/journal/issues/188)) ([5c14615](https://github.com/2002Bishwajeet/journal/commit/5c14615627e0455cf45ccfe4af2abfb6177b6db1))
* **routing:** fix PWA "New Note" shortcut on cold and warm start ([#187](https://github.com/2002Bishwajeet/journal/issues/187)) ([a5a5ee1](https://github.com/2002Bishwajeet/journal/commit/a5a5ee15cf14250267893ecda26fd87c8be2ffc9))
* **routing:** reload once on stale/missing lazy chunk instead of crashing ([#189](https://github.com/2002Bishwajeet/journal/issues/189)) ([b2483ed](https://github.com/2002Bishwajeet/journal/commit/b2483ed40adea086ffe468fbddeecf6d2e9bab57))
* **routing:** remove unreachable /:folderId/:noteId/chat route ([#193](https://github.com/2002Bishwajeet/journal/issues/193)) ([11b87f4](https://github.com/2002Bishwajeet/journal/commit/11b87f465bcb7cfebf7b2a4232444e9de70cf656))
* **routing:** resolve real folder for new notes and redirect unknown folder routes ([#185](https://github.com/2002Bishwajeet/journal/issues/185)) ([3156db5](https://github.com/2002Bishwajeet/journal/commit/3156db5a75b210275141eafac218881f842ba74d))
* **routing:** set document.title per screen ([#194](https://github.com/2002Bishwajeet/journal/issues/194)) ([5ca8e15](https://github.com/2002Bishwajeet/journal/commit/5ca8e15739784703c59752109d58dd63f96c13c3))
* **routing:** show the tag's note list on mobile when a tag is tapped ([#190](https://github.com/2002Bishwajeet/journal/issues/190)) ([e1d20d0](https://github.com/2002Bishwajeet/journal/commit/e1d20d0710ecaddcd59474dd35e06bd80d957f1e))
* **share:** read the note header by fileId so sharing works right after create ([#293](https://github.com/2002Bishwajeet/journal/issues/293)) ([2d8115d](https://github.com/2002Bishwajeet/journal/commit/2d8115d303666079819ee0cdd42de5642733c877)), closes [#rewriteNoteHeader](https://github.com/2002Bishwajeet/journal/issues/rewriteNoteHeader)
* **share:** render attachment:// images on the public share page ([2a73fd6](https://github.com/2002Bishwajeet/journal/commit/2a73fd66190bd8241933840f01e4552d8799fde0))
* **share:** version the public-note query key for the new fileId field ([197e9aa](https://github.com/2002Bishwajeet/journal/commit/197e9aa24e3ee693c3cfd3b654db89b246a70678))
* **sidebar:** list only notes shared by others under "Shared with me" ([#151](https://github.com/2002Bishwajeet/journal/issues/151)) ([368d490](https://github.com/2002Bishwajeet/journal/commit/368d4905aeffd07eb972acddd481e1bc02196864))
* **sw-safety:** don't reload for React errors it already recovered from ([#247](https://github.com/2002Bishwajeet/journal/issues/247)) ([320e6af](https://github.com/2002Bishwajeet/journal/commit/320e6af991a7839d0ba68525ef1d49eabf374174))
* **sw-safety:** match the Safari/Firefox hook crash and ignore empty rejections ([fad3745](https://github.com/2002Bishwajeet/journal/commit/fad37451298a1f6e4d9a1a5793cab87fb6888034))
* **sw-safety:** only wipe SW/caches for stale-bundle React errors ([#247](https://github.com/2002Bishwajeet/journal/issues/247)) ([405e9fb](https://github.com/2002Bishwajeet/journal/commit/405e9fbf8f045d6dcac8a7558646366a765e631d)), closes [#185](https://github.com/2002Bishwajeet/journal/issues/185) [#418](https://github.com/2002Bishwajeet/journal/issues/418) [#423](https://github.com/2002Bishwajeet/journal/issues/423) [#321](https://github.com/2002Bishwajeet/journal/issues/321) [#520](https://github.com/2002Bishwajeet/journal/issues/520)
* **sync:** apply remote folder renames locally ([b3abc8f](https://github.com/2002Bishwajeet/journal/commit/b3abc8f4af7d409ca24c8d13ed8ba341e94b49c5)), closes [#150](https://github.com/2002Bishwajeet/journal/issues/150)
* **sync:** apply the same orphaned-folder check to pushNote's conflict retry ([#259](https://github.com/2002Bishwajeet/journal/issues/259)) ([5a56613](https://github.com/2002Bishwajeet/journal/commit/5a56613962f225cba4a87b24e2c8c1f888b6fcb7))
* **sync:** cap sync_errors backoff exponent so repeated failures can't overflow ([e90021d](https://github.com/2002Bishwajeet/journal/commit/e90021d8baba124f19f217e97714692c2b1c694a))
* **sync:** clear only the image deletions a push actually sent ([#242](https://github.com/2002Bishwajeet/journal/issues/242)) ([36f8f14](https://github.com/2002Bishwajeet/journal/commit/36f8f14356bfe44df6a953abc1ed4d703835edf3))
* **sync:** delete folder notes by the folder uniqueId and sweep trashed/archived notes ([5b254f7](https://github.com/2002Bishwajeet/journal/commit/5b254f7fea224c4bf81667bff5a73689b27ae940)), closes [#149](https://github.com/2002Bishwajeet/journal/issues/149)
* **sync:** do not mis-file a note to Main when its folder failed to pull ([#259](https://github.com/2002Bishwajeet/journal/issues/259)) ([d53be60](https://github.com/2002Bishwajeet/journal/commit/d53be6077faf94d1118a8c2ce08e4da80fad3252))
* **sync:** fall back orphaned note folderId to Main on pull ([#259](https://github.com/2002Bishwajeet/journal/issues/259)) ([97fbbb6](https://github.com/2002Bishwajeet/journal/commit/97fbbb6824826fa5a07f9cd372934568d47584c8)), closes [pre-#254](https://github.com/pre-/issues/254)
* **sync:** group-delete folder notes even when the folder file was never uploaded ([36c2d7e](https://github.com/2002Bishwajeet/journal/commit/36c2d7e86ffb4fa86cd7f19e2bc168c3712dd99f))
* **sync:** keep a concurrent local folder change and drop the signed-out folder record ([66e8d1f](https://github.com/2002Bishwajeet/journal/commit/66e8d1f8d855b1bed2d37e4f4b476ee93e209952))
* **sync:** keep pending deletes through in-flight pushes and startup ([#265](https://github.com/2002Bishwajeet/journal/issues/265)) ([741bb73](https://github.com/2002Bishwajeet/journal/commit/741bb731bdbafb0209a613b7328ad4cac8e44e67))
* **sync:** keep the server folder on a note push version conflict ([e9c27bb](https://github.com/2002Bishwajeet/journal/commit/e9c27bb56daa06775850cd739f579a4b9302eb07)), closes [#257](https://github.com/2002Bishwajeet/journal/issues/257)
* **sync:** push the note's real created timestamp as userDate ([d827a71](https://github.com/2002Bishwajeet/journal/commit/d827a710dca4cb4db756026a7ff42d683a2beffe))
* **sync:** resolve push backoff when an immediate save pushes successfully ([4863018](https://github.com/2002Bishwajeet/journal/commit/4863018123a1384a4e02e54566a8336d5b8cf418))
* **sync:** retry a failed remote folder delete instead of dropping it ([b6bd307](https://github.com/2002Bishwajeet/journal/commit/b6bd30782fd1e3ae0939fb0dfc92de66088dcea6)), closes [#258](https://github.com/2002Bishwajeet/journal/issues/258)
* **sync:** retry a failed remote note delete instead of dropping it ([#265](https://github.com/2002Bishwajeet/journal/issues/265)) ([7ef564e](https://github.com/2002Bishwajeet/journal/commit/7ef564ee226a9b2b8ad40c86204e84844734caad))
* **sync:** retry notes skipped for backoff once the backoff ends ([#263](https://github.com/2002Bishwajeet/journal/issues/263)) ([f760949](https://github.com/2002Bishwajeet/journal/commit/f760949ca4abd3e208226551493e0ad78e48e3d8))
* **sync:** sync_errors upsert with backoff instead of append-only rows ([eccb6a7](https://github.com/2002Bishwajeet/journal/commit/eccb6a74400a6ca900c964e1163c0386f4817de3)), closes [#146](https://github.com/2002Bishwajeet/journal/issues/146)
* **tabs:** navigate to the tab closeTab activates when closing the active tab ([#191](https://github.com/2002Bishwajeet/journal/issues/191)) ([9990068](https://github.com/2002Bishwajeet/journal/commit/99900681da3e20dbbbb499a319dcec5ec12a12de))
* **yjs:** merge stored updates before compaction replaces them ([#264](https://github.com/2002Bishwajeet/journal/issues/264)) ([1b4471b](https://github.com/2002Bishwajeet/journal/commit/1b4471ba8618fbef9214b080b071777c2b4b7984))


### Features

* **agent-access:** add grants model — file format, resolver, drive load/save ([#165](https://github.com/2002Bishwajeet/journal/issues/165)) ([8a975c3](https://github.com/2002Bishwajeet/journal/commit/8a975c3f3a1756374bd518bf6582475b558cb572))
* **agent-access:** headless editor schema for the edit engine ([#316](https://github.com/2002Bishwajeet/journal/issues/316)) ([522ad82](https://github.com/2002Bishwajeet/journal/commit/522ad8298fea4dc3595b313ee9cad64bf36d61b7))
* **agent-access:** MCP server foundation, own app registration, read tools ([#167](https://github.com/2002Bishwajeet/journal/issues/167)) ([386c8e7](https://github.com/2002Bishwajeet/journal/commit/386c8e7d94f1bc2be211ba1b180d54b003d82461)), closes [#58](https://github.com/2002Bishwajeet/journal/issues/58) [#165](https://github.com/2002Bishwajeet/journal/issues/165) [#166](https://github.com/2002Bishwajeet/journal/issues/166)
* **agent-access:** MCP write tools with conflict-safe upload ([#169](https://github.com/2002Bishwajeet/journal/issues/169)) ([1be6cd8](https://github.com/2002Bishwajeet/journal/commit/1be6cd886c35208df199932c1681c087389ab2c2))
* **agent-access:** Settings → Agent access screen ([#168](https://github.com/2002Bishwajeet/journal/issues/168)) ([63fb136](https://github.com/2002Bishwajeet/journal/commit/63fb136207f5b759b4df805691b830c0fd6d60ee)), closes [#210](https://github.com/2002Bishwajeet/journal/issues/210)
* **agent-access:** show agent attribution in the note UI ([#170](https://github.com/2002Bishwajeet/journal/issues/170)) ([4769ef5](https://github.com/2002Bishwajeet/journal/commit/4769ef58df44d5b64dac0d7ae3ef05bdb2583497)), closes [#169](https://github.com/2002Bishwajeet/journal/issues/169)
* **agent:** markdown to Yjs edit engine with minimal diff ([#166](https://github.com/2002Bishwajeet/journal/issues/166)) ([45184a6](https://github.com/2002Bishwajeet/journal/commit/45184a6883e8b8a0cac2cfc9e31bf2608e46e8c1))
* **auth:** register with an explicit app slug and drive slugs ([797b2f0](https://github.com/2002Bishwajeet/journal/commit/797b2f0274ac13fed9f783d70026b5be37fba992))
* **e2e:** add e2e-only readiness hooks (window.__journalE2E) ([78c9842](https://github.com/2002Bishwajeet/journal/commit/78c9842f259203f5733e8da2ccfeef440b738893))
* **e2e:** add layer 3 live tier (HTTPS origin, login, live specs, hosted fallback) ([0582765](https://github.com/2002Bishwajeet/journal/commit/058276571f034dfdafbda306d686238b0a12f2f0))
* **e2e:** run the live Docker e2e tier locally with one command ([224a14b](https://github.com/2002Bishwajeet/journal/commit/224a14ba5dd19021f4c6cba054fed1c211471b7e))
* **export:** real markdown with images saved alongside notes ([#183](https://github.com/2002Bishwajeet/journal/issues/183)) ([56731f6](https://github.com/2002Bishwajeet/journal/commit/56731f69a270e168cf28d3d3e047f0e1dcabfa40))
* **images:** add /image slash command ([#180](https://github.com/2002Bishwajeet/journal/issues/180)) ([84f7680](https://github.com/2002Bishwajeet/journal/commit/84f76809a8073456abd8a7ceedabb4a748911441))
* **images:** add alt text control for images ([#181](https://github.com/2002Bishwajeet/journal/issues/181)) ([da0671c](https://github.com/2002Bishwajeet/journal/commit/da0671c1d0118d1f7f75f3c86a329fc4bd7dedbc))
* **images:** add click-to-zoom lightbox for images ([#182](https://github.com/2002Bishwajeet/journal/issues/182)) ([7fdf9fa](https://github.com/2002Bishwajeet/journal/commit/7fdf9fa5a85d3a848d43e6ff9826008411e44553))
* **images:** downscale, re-orient and strip EXIF before upload; accept HEIC ([#176](https://github.com/2002Bishwajeet/journal/issues/176)) ([afb60e5](https://github.com/2002Bishwajeet/journal/commit/afb60e5adef44d21148e1962e0f3dfdaae4f52ae))
* **images:** drop images at the drop point, not the cursor ([#180](https://github.com/2002Bishwajeet/journal/issues/180)) ([30ba7d2](https://github.com/2002Bishwajeet/journal/commit/30ba7d23ccbadc4c9472afec895206d82a32b4f2))
* **images:** keep uploaded images available offline by reusing the local upload row ([#179](https://github.com/2002Bishwajeet/journal/issues/179)) ([f5bb992](https://github.com/2002Bishwajeet/journal/commit/f5bb992f5925b92226606f3416272a2f68ce86c9))
* **mcp:** Claude Code plugin that installs the MCP server in one step ([c8dba6c](https://github.com/2002Bishwajeet/journal/commit/c8dba6c09d066a0e088c20b072e24cf5541565ec))
* **settings:** section registry, left nav on desktop, drill-in on mobile ([#210](https://github.com/2002Bishwajeet/journal/issues/210)) ([12e8d9b](https://github.com/2002Bishwajeet/journal/commit/12e8d9b4cbc8f4deccf0146006835936bf87d7c8)), closes [#168](https://github.com/2002Bishwajeet/journal/issues/168) [#227](https://github.com/2002Bishwajeet/journal/issues/227) [#168](https://github.com/2002Bishwajeet/journal/issues/168)


### Performance Improvements

* **boot:** skip persist() and SW registration on public share pages ([#155](https://github.com/2002Bishwajeet/journal/issues/155)) ([c4ada53](https://github.com/2002Bishwajeet/journal/commit/c4ada53ab9d71676a21ecdce7209f22dc30176df))
* cut boot JS in half by splitting the editor off the boot path ([f95a9f8](https://github.com/2002Bishwajeet/journal/commit/f95a9f8b56dcfc774d5d812f57dd422ac35599a6))
## [2.1.2](https://github.com/2002Bishwajeet/journal/compare/v2.1.1...v2.1.2) (2026-07-27)


### Bug Fixes

* **editor:** debounce a thunk instead of reading refs during render ([1741ab9](https://github.com/2002Bishwajeet/journal/commit/1741ab9b15f9e69b7f2ab8725217e9bb8f851bd6))
* **editor:** move image geometry out of the node view file ([3c433d7](https://github.com/2002Bishwajeet/journal/commit/3c433d70c5c76fc2bdb6fb3be61a2cac5df1c08f))
* **editor:** stop title edits from revoking a note's public share ([507f0eb](https://github.com/2002Bishwajeet/journal/commit/507f0eb59aa1ee7139ba9a795f66057738a5a4c2)), closes [#79](https://github.com/2002Bishwajeet/journal/issues/79)
* **sw:** precache the app shell as / so share links stop failing ([c973f87](https://github.com/2002Bishwajeet/journal/commit/c973f87d40ddb76b3e9302bb0f51f660d367e852)), closes [#105](https://github.com/2002Bishwajeet/journal/issues/105)
* **sync:** drop the cached key header when a note's visibility flips ([d393597](https://github.com/2002Bishwajeet/journal/commit/d39359796938099e7e406ae1413396ce8ea8f9ee)), closes [#80](https://github.com/2002Bishwajeet/journal/issues/80)


### Features

* **editor:** corner resize handles and float alignment for images ([dd2a5c4](https://github.com/2002Bishwajeet/journal/commit/dd2a5c450d5c3f654ddb07b48921f77032141f29))
* **editor:** let images be resized ([9302f5c](https://github.com/2002Bishwajeet/journal/commit/9302f5ce77c8182b64af14da1757b01d432db97b)), closes [#82](https://github.com/2002Bishwajeet/journal/issues/82)
* **editor:** proper drag handles for image resize ([aee2632](https://github.com/2002Bishwajeet/journal/commit/aee263207f4c63b89e99e222c15038f17447c6e1))
* **notes:** add "Open in Owner Console" to the note context menu ([ab28187](https://github.com/2002Bishwajeet/journal/commit/ab28187f7f4241a1e8bffeac2f4d7a609343e574)), closes [#81](https://github.com/2002Bishwajeet/journal/issues/81)
## [2.1.1](https://github.com/2002Bishwajeet/journal/compare/v2.1.0...v2.1.1) (2026-07-20)


### Bug Fixes

* **editor:** remove dead props.loading guard that broke the build ([555219c](https://github.com/2002Bishwajeet/journal/commit/555219cd1f0165077bfda67ab7db865743089e0d))
* **sync:** drop undecryptable cached key headers so notes stop retrying forever ([a6f4c62](https://github.com/2002Bishwajeet/journal/commit/a6f4c62100e24886ea1e9ca190bc9a4139e85675))
# [2.1.0](https://github.com/2002Bishwajeet/journal/compare/v2.0.0...v2.1.0) (2026-07-19)


### Bug Fixes

* **ux:** boot progress bar was permanently invisible ([bb55eb0](https://github.com/2002Bishwajeet/journal/commit/bb55eb04064c99948c34a35dec6aa6b520550c19))


### Features

* **ux:** linear boot-progress bar on the splash screen ([cbada7c](https://github.com/2002Bishwajeet/journal/commit/cbada7cc412883cb868cfa28664f7f90a0d57287))
