## [2.3.1](https://github.com/2002Bishwajeet/journal/compare/v2.3.0...v2.3.1) (2026-10-06)


### Bug Fixes

* **agent:** refuse replace_in_note inside toggle/callout; include toggle title in getText ([#159](https://github.com/2002Bishwajeet/journal/issues/159)) ([8bf691b](https://github.com/2002Bishwajeet/journal/commit/8bf691bc864e11de1d79e07316419afb4bdbc728))
* **build:** keep the mermaid chunk off the boot path ([1d6d09c](https://github.com/2002Bishwajeet/journal/commit/1d6d09c3f4b95d8e164b645c5ab4ce3cd93f8ba6))
* **covers:** re-encode every non-GIF cover type and add hermetic EXIF e2e ([#448](https://github.com/2002Bishwajeet/journal/issues/448)) ([eb3e2ef](https://github.com/2002Bishwajeet/journal/commit/eb3e2ef55e282c7959f71d4e4df06741302b4a81))
* **deploy:** a missing /assets/ file is a 404, not the cached SPA shell ([cbb97fb](https://github.com/2002Bishwajeet/journal/commit/cbb97fb9a3a9e3bafe9d6e3637e4ac1d7998af44))
* **editor:** hide version history on peer notes, document snapshots ([#158](https://github.com/2002Bishwajeet/journal/issues/158)) ([c928b05](https://github.com/2002Bishwajeet/journal/commit/c928b05b779e8d88963186a9eb90c2cf464b9823))
* **editor:** paste markup or a fenced block as a live block; readable blockquotes ([3a3ba26](https://github.com/2002Bishwajeet/journal/commit/3a3ba26c21ee4b287955f42b61945192a525bae6))
* **editor:** title-less link previews render instead of loading forever ([#173](https://github.com/2002Bishwajeet/journal/issues/173)) ([5e433ac](https://github.com/2002Bishwajeet/journal/commit/5e433ac001bdc1bd60e460d0099076eca85fd7ae))
* **harness:** expand epics recursively so /implement 163 covers the whole backlog ([1a1fa4f](https://github.com/2002Bishwajeet/journal/commit/1a1fa4f6bd996a2a1a1a2881c9a2db7e67be93f8))
* **harness:** make agents capture and check the screenshots an issue asks for ([3a90852](https://github.com/2002Bishwajeet/journal/commit/3a9085234a6a5187ed35a5becd5e372547d2bccf))
* **harness:** never clean up worktrees mid-wave or with unpushed work ([cb99248](https://github.com/2002Bishwajeet/journal/commit/cb99248914a1b0b2b55077ceaf96395fa939127b))
* **harness:** no attribution line in harness PR bodies ([e09c2f9](https://github.com/2002Bishwajeet/journal/commit/e09c2f9f4a7c91a99d7e68dfb90252390c90db1a))
* **harness:** remove finished agent worktrees at the start of each /implement run ([3398b2d](https://github.com/2002Bishwajeet/journal/commit/3398b2dda6a2cd3f51ec6a04ca751d04d61c7c94))
* **harness:** reuse the agent-evidence draft release instead of creating one per publish ([9f49490](https://github.com/2002Bishwajeet/journal/commit/9f494907f23b304434d2e9a58c6561f23fe9e194))
* **harness:** run heavy commands in the foreground; e2e-live may skip in CI ([df73c10](https://github.com/2002Bishwajeet/journal/commit/df73c10678b519be151b7bd12022f78e82e4ea84))
* **image:** request thumbs at devicePixelRatio so covers are sharp on retina ([#444](https://github.com/2002Bishwajeet/journal/issues/444)) ([883f218](https://github.com/2002Bishwajeet/journal/commit/883f2186e7eb386ec835afd10b8e1523ec493b2b))
* **images:** strip EXIF from note cover uploads ([#448](https://github.com/2002Bishwajeet/journal/issues/448)) ([60427b0](https://github.com/2002Bishwajeet/journal/commit/60427b02e0b96c82b7fde155842b601d93a3a1de))
* **import:** snapshot selected files before resetting the input ([#339](https://github.com/2002Bishwajeet/journal/issues/339)) ([5c33cd7](https://github.com/2002Bishwajeet/journal/commit/5c33cd718f725cd0a1173d10e88645779dc3322d))
* **live-blocks:** mermaid labels are no longer clipped in their node ([#432](https://github.com/2002Bishwajeet/journal/issues/432)) ([9d6c20c](https://github.com/2002Bishwajeet/journal/commit/9d6c20c81083ab998176c414806ba206b1b2fe51))
* **mcp:** a retried edit that was already saved succeeds instead of failing or duplicating ([3c8ba0c](https://github.com/2002Bishwajeet/journal/commit/3c8ba0c21190d75a8eebbb1c8c661ce8594808cb)), closes [#439](https://github.com/2002Bishwajeet/journal/issues/439)
* **settings:** 44px Copy target on mobile, clipboard error toast, about/shortcuts e2e ([#215](https://github.com/2002Bishwajeet/journal/issues/215)) ([108b0b3](https://github.com/2002Bishwajeet/journal/commit/108b0b3533e6c3f3647b812083c8d163e2738678))
* **settings:** accessible controls on theme tokens and stale system-theme listener ([#211](https://github.com/2002Bishwajeet/journal/issues/211)) ([26bc340](https://github.com/2002Bishwajeet/journal/commit/26bc34042b8b119deb2b8302ddbb208556c4b1d7))
* **settings:** distinct focus outline on radio cards; add settings a11y e2e ([#211](https://github.com/2002Bishwajeet/journal/issues/211)) ([2cb192a](https://github.com/2002Bishwajeet/journal/commit/2cb192ab66d3e6d05cf3c4af97491196890b37b7))
* **settings:** Retry loads the selected model; add AI settings e2e ([#212](https://github.com/2002Bishwajeet/journal/issues/212)) ([cc48e8e](https://github.com/2002Bishwajeet/journal/commit/cc48e8e274be6245228e0f087f9781311ee068c0))
* **settings:** stop mobile nav strip widening the dialog content ([#211](https://github.com/2002Bishwajeet/journal/issues/211)) ([1de0126](https://github.com/2002Bishwajeet/journal/commit/1de012637ed19517ab0c961808ca690e40b22ca0))
* **share:** keep avatar inside its circle and let wide tables scroll at desktop width ([#221](https://github.com/2002Bishwajeet/journal/issues/221)) ([e2819e7](https://github.com/2002Bishwajeet/journal/commit/e2819e7cbbdcff1b4b7490df8de569e8962e3663))
* **share:** keep every block in the reading column ([bca245a](https://github.com/2002Bishwajeet/journal/commit/bca245a28261933707edaae3e3578f4f3db7dde7))
* **share:** load author avatar without Buffer, AA contrast for dark th/comments ([#221](https://github.com/2002Bishwajeet/journal/issues/221)) ([5857d59](https://github.com/2002Bishwajeet/journal/commit/5857d59776afec7deb66c38f5349803334da9e45))
* **share:** push a not-yet-uploaded note before making it public ([55e4976](https://github.com/2002Bishwajeet/journal/commit/55e4976e38354235d3b413eed8f494d8b4f0cb27))
* **share:** push the note directly after a link-card edit so it isn't dropped by a concurrent sync ([#222](https://github.com/2002Bishwajeet/journal/issues/222)) ([38b02da](https://github.com/2002Bishwajeet/journal/commit/38b02daf04e02a8fc629f7fef2db3aa6ac9cf620))
* **share:** read payloads with lastModified when making a note public or private ([#451](https://github.com/2002Bishwajeet/journal/issues/451)) ([4b79c4e](https://github.com/2002Bishwajeet/journal/commit/4b79c4e736e09de9512d582a4759104207cc6c39))
* **share:** record the make-public/private re-upload's version tag so its websocket echo can't overwrite a link-card edit ([#222](https://github.com/2002Bishwajeet/journal/issues/222)) ([bdb1ba6](https://github.com/2002Bishwajeet/journal/commit/bdb1ba60e470e57d3a1802e452f15b6dce0c1af2))
* **share:** restore exported fallbackShareDescription ([#216](https://github.com/2002Bishwajeet/journal/issues/216)) ([be17f6c](https://github.com/2002Bishwajeet/journal/commit/be17f6c320e2ffb9e726493a7bb0a4506d6728bc))
* **sidebar:** keep the footer on screen when folders and tags overflow ([02aa408](https://github.com/2002Bishwajeet/journal/commit/02aa40807e550be1003c3019e3880cc58ab04b8e))
* **sync:** a pull keeps a note pending while it has unpushed local edits ([#442](https://github.com/2002Bishwajeet/journal/issues/442)) ([a356443](https://github.com/2002Bishwajeet/journal/commit/a356443de94113fa8bd18d91e427d7317b6a5c5d))
* **sync:** hold a note's payload deletions until its pending images upload ([#219](https://github.com/2002Bishwajeet/journal/issues/219)) ([04c85b5](https://github.com/2002Bishwajeet/journal/commit/04c85b5eb9be80a4ede86045916948cc6a172cc5))
* **sync:** offline edits update the pending count so sign-out warns ([#213](https://github.com/2002Bishwajeet/journal/issues/213)) ([00a9d11](https://github.com/2002Bishwajeet/journal/commit/00a9d114eb4f84ee2deca959acad206f390bf344))
* **sync:** retry notes whose pull failed instead of losing them ([#147](https://github.com/2002Bishwajeet/journal/issues/147)) ([409e0ce](https://github.com/2002Bishwajeet/journal/commit/409e0ce3076f04884db8f9cc927e445c4fb7477d))
* **tables:** keep image-only share headers; test picker and /table insert no header ([#446](https://github.com/2002Bishwajeet/journal/issues/446)) ([8c4b0de](https://github.com/2002Bishwajeet/journal/commit/8c4b0de2894b9698347473ff4e4d6b53a59e5431))
* **tags:** restore getAllTags over TAGS_SQL ([#160](https://github.com/2002Bishwajeet/journal/issues/160)) ([44e4931](https://github.com/2002Bishwajeet/journal/commit/44e4931d79a48c02eaca13ee6a70e6a6b7f088f8))


### Features

* **agent:** parse callout and toggle from markdown ([#392](https://github.com/2002Bishwajeet/journal/issues/392)) ([9836429](https://github.com/2002Bishwajeet/journal/commit/98364299ceab2f41e65ff3d4a66ae090ae909362))
* **editor:** cover image data model in the Yjs doc and upload pipeline ([#218](https://github.com/2002Bishwajeet/journal/issues/218)) ([9fd5d68](https://github.com/2002Bishwajeet/journal/commit/9fd5d68fb004dda0f9593bd503f947f7461b1162))
* **editor:** cover image UI to add, change, reposition and remove ([#219](https://github.com/2002Bishwajeet/journal/issues/219)) ([d2dca5a](https://github.com/2002Bishwajeet/journal/commit/d2dca5ade889edfe99c6d4409970f6111dcc479c))
* **editor:** link preview cards on URL paste ([#173](https://github.com/2002Bishwajeet/journal/issues/173)) ([0171256](https://github.com/2002Bishwajeet/journal/commit/0171256c15e3b48e3ef466c29237ebfb70e8e565))
* **editor:** live Mermaid and SVG preview for code blocks ([#388](https://github.com/2002Bishwajeet/journal/issues/388)) ([5d295a4](https://github.com/2002Bishwajeet/journal/commit/5d295a41001a0e06feacc0e9ba1c23c742c6491a))
* **editor:** run html code blocks in a sandboxed frame ([#389](https://github.com/2002Bishwajeet/journal/issues/389)) ([0c5fbff](https://github.com/2002Bishwajeet/journal/commit/0c5fbff090f5d96947efc4588bce3ac345a7abc9))
* **editor:** table header-row toggle and delete table ([#449](https://github.com/2002Bishwajeet/journal/issues/449)) ([313a948](https://github.com/2002Bishwajeet/journal/commit/313a94893eea39fd93551078c109f7b679befeca))
* **editor:** toggle (collapsible) and callout blocks ([#159](https://github.com/2002Bishwajeet/journal/issues/159)) ([0ed83d2](https://github.com/2002Bishwajeet/journal/commit/0ed83d2ae8d35bad0b1ff64a29d57aefcf348b10))
* **editor:** version history snapshots before compaction, with restore ([#158](https://github.com/2002Bishwajeet/journal/issues/158)) ([840f9e3](https://github.com/2002Bishwajeet/journal/commit/840f9e380f0aab227805f84c0dc0a89e519af5b5)), closes [#146](https://github.com/2002Bishwajeet/journal/issues/146)
* **harness:** /implement — select, implement, verify and PR agent-ready issues ([e0f19ad](https://github.com/2002Bishwajeet/journal/commit/e0f19ad37399ca5df07be36965e7998faa46aef6)), closes [#172](https://github.com/2002Bishwajeet/journal/issues/172)
* **harness:** route implementer model and effort from issue Metadata ([700d185](https://github.com/2002Bishwajeet/journal/commit/700d185b0308642806a00f67b675aed7e7d53efc))
* **harness:** simplify stage before verify, auto-merge green agent-harness PRs ([b972ff5](https://github.com/2002Bishwajeet/journal/commit/b972ff52114fa647cdfe4e92e55ced47770d43a7))
* **live-blocks:** allow scripts, styles and fonts from an allowlisted CDN in html blocks ([#409](https://github.com/2002Bishwajeet/journal/issues/409)) ([63e9474](https://github.com/2002Bishwajeet/journal/commit/63e9474e28e68f8dd13d8989defe83f1afa41e78))
* **live-blocks:** auto-height and full screen for html blocks ([#412](https://github.com/2002Bishwajeet/journal/issues/412)) ([c84c699](https://github.com/2002Bishwajeet/journal/commit/c84c69994f1af8bd9cc2e16d61b50b1e70fdb4ee))
* **live-blocks:** blend live blocks into the note ([#420](https://github.com/2002Bishwajeet/journal/issues/420)) ([b52378c](https://github.com/2002Bishwajeet/journal/commit/b52378c46f8c1975cd3107dad59a2cae3d69c79e))
* **live-blocks:** design polish pass for the editor and share page ([#393](https://github.com/2002Bishwajeet/journal/issues/393)) ([2498477](https://github.com/2002Bishwajeet/journal/commit/2498477da208317be1c8d7659eb5a0f382ea649c))
* **live-blocks:** Journal-styled form controls, chart palette for pies, no fullscreen ([#424](https://github.com/2002Bishwajeet/journal/issues/424)) ([45b9792](https://github.com/2002Bishwajeet/journal/commit/45b9792d659a98e58a4d30db126a3957c0371a38))
* **live-blocks:** label the block and keep its toggles in view while editing ([7230b78](https://github.com/2002Bishwajeet/journal/commit/7230b785adce3619523d817f651174b3b8e82fe6))
* **live-blocks:** React component block on the app's own React ([#426](https://github.com/2002Bishwajeet/journal/issues/426)) ([7139f52](https://github.com/2002Bishwajeet/journal/commit/7139f52e77ca90257afda7e77a1ee0713c8c6f79))
* **mcp:** tell agents about live blocks in write tool descriptions ([#391](https://github.com/2002Bishwajeet/journal/issues/391)) ([50b32ad](https://github.com/2002Bishwajeet/journal/commit/50b32ad55753b2b9c21c697a9f4c79019334151e))
* **settings:** Account section with identity, sync status and honest sign-out ([#213](https://github.com/2002Bishwajeet/journal/issues/213)) ([5e83ac8](https://github.com/2002Bishwajeet/journal/commit/5e83ac8001c0e02185710e1511e56927e356aa52))
* **settings:** editor font and width options in Appearance ([#394](https://github.com/2002Bishwajeet/journal/issues/394)) ([0b99c6d](https://github.com/2002Bishwajeet/journal/commit/0b99c6d911186300ab6c870fa48778a9e99ce361))
* **settings:** keyboard shortcuts section + factual About ([#215](https://github.com/2002Bishwajeet/journal/issues/215)) ([e65ccbb](https://github.com/2002Bishwajeet/journal/commit/e65ccbbf9a446d00bef12aa03f074c1fb5dad07c))
* **settings:** real storage info and accurate import/export copy in Data & storage ([#214](https://github.com/2002Bishwajeet/journal/issues/214)) ([19f2374](https://github.com/2002Bishwajeet/journal/commit/19f237475f24b79466e8b8199305ef043cb17eb5))
* **settings:** truthful AI status, visible errors + retry, mobile notice, confirm model removal ([#212](https://github.com/2002Bishwajeet/journal/issues/212)) ([97157a6](https://github.com/2002Bishwajeet/journal/commit/97157a6567f0a8b0727ab7ef6e024ad971ed4534))
* **settings:** typographic polish pass with preview cards ([#395](https://github.com/2002Bishwajeet/journal/issues/395)) ([8ebdadd](https://github.com/2002Bishwajeet/journal/commit/8ebdadd59257c47ca8781df11e02b0c43f7a78c9))
* **share:** 1200x630 link-card image so previews and og:image show the whole cover ([#441](https://github.com/2002Bishwajeet/journal/issues/441)) ([a412880](https://github.com/2002Bishwajeet/journal/commit/a412880c568b0b641b01fcd545e01aed8bf7f815))
* **share:** cover image on the share page and as og:image ([#220](https://github.com/2002Bishwajeet/journal/issues/220)) ([4de2317](https://github.com/2002Bishwajeet/journal/commit/4de23176ffcdaea64cbecce745437891933aea08))
* **share:** header and footer with the logo ([#425](https://github.com/2002Bishwajeet/journal/issues/425)) ([010c356](https://github.com/2002Bishwajeet/journal/commit/010c356dc8f6a69dd6c473806e3752e6126e629f))
* **share:** link-card preview, custom description and search-indexing toggle in the share dialog ([#222](https://github.com/2002Bishwajeet/journal/issues/222)) ([21481a7](https://github.com/2002Bishwajeet/journal/commit/21481a71d423ccd97000c50b499c7fcbe83aba2e))
* **share:** publish a link-card description and indexable flag in the public note header ([#217](https://github.com/2002Bishwajeet/journal/issues/217)) ([14d0f3f](https://github.com/2002Bishwajeet/journal/commit/14d0f3faaf27e14b9f62372632ea88eabf4e534b))
* **share:** readable article byline, dates, reading time and code highlighting ([#221](https://github.com/2002Bishwajeet/journal/issues/221)) ([4cb50e2](https://github.com/2002Bishwajeet/journal/commit/4cb50e24f114fcc4ade93a8bb1b21fc62b68a8ea))
* **share:** render mermaid, svg and html blocks as previews on the share page ([#390](https://github.com/2002Bishwajeet/journal/issues/390)) ([fae0b5b](https://github.com/2002Bishwajeet/journal/commit/fae0b5b14a82ef353ede7d93e4061e363cba2553))
* **share:** rich link previews for /share/* via a Pages Function ([#216](https://github.com/2002Bishwajeet/journal/issues/216)) ([3b1bf0d](https://github.com/2002Bishwajeet/journal/commit/3b1bf0dff3e320757b3fc9cde04a733b7e37c76d))
* **share:** roomy two-column dialog on desktop, full-screen sheet on mobile ([#443](https://github.com/2002Bishwajeet/journal/issues/443)) ([f9addb0](https://github.com/2002Bishwajeet/journal/commit/f9addb0dbe74d6d3011c75ba5484b5e416a3c349))
* **share:** save a copy of a shared note, and an unverified-content notice ([#411](https://github.com/2002Bishwajeet/journal/issues/411)) ([78f67cf](https://github.com/2002Bishwajeet/journal/commit/78f67cf4fdb4448c160989dccb5b4eeeb96b76f2))
* **share:** wide blocks grow past the reading column, code gets a Copy button ([#408](https://github.com/2002Bishwajeet/journal/issues/408)) ([791f983](https://github.com/2002Bishwajeet/journal/commit/791f98336fa2934137239302961639019cbf85d9))
* **share:** widen the share page to max-w-4xl ([4033a92](https://github.com/2002Bishwajeet/journal/commit/4033a927d7cc323544380109ff7ff5ebda667b84))
* **sidebar:** collapsible Tags and Folders sections remembered across reloads ([#457](https://github.com/2002Bishwajeet/journal/issues/457)) ([712ccc6](https://github.com/2002Bishwajeet/journal/commit/712ccc62d560dcb580cb41c9572f9a82143d5dd6))
* **tables:** no header row by default; empty GFM header means headerless; round-trip ([#446](https://github.com/2002Bishwajeet/journal/issues/446)) ([28817d8](https://github.com/2002Bishwajeet/journal/commit/28817d8fe1b0274a13abe03dfcc179f42989298a))
* **tags:** delete a tag from all notes via the sidebar ([#458](https://github.com/2002Bishwajeet/journal/issues/458)) ([8cc79de](https://github.com/2002Bishwajeet/journal/commit/8cc79de9032a4824f799ac01429f0aaff1f090f3))
* **tags:** make useTags a live query over TAGS_SQL ([#160](https://github.com/2002Bishwajeet/journal/issues/160)) ([a1d3fab](https://github.com/2002Bishwajeet/journal/commit/a1d3fabc8202728e3c2ef992f743b23ce14f4128))
* **theme:** a muted chart palette for light and dark ([#430](https://github.com/2002Bishwajeet/journal/issues/430)) ([b9f32fb](https://github.com/2002Bishwajeet/journal/commit/b9f32fbd6797fe1820d6b27d849aa036a86473b4))


### Performance Improvements

* **editor:** batch per-keystroke Yjs updates into one row per 300 ms window ([#152](https://github.com/2002Bishwajeet/journal/issues/152)) ([0102d5f](https://github.com/2002Bishwajeet/journal/commit/0102d5ffcb5983ef222990a6eed8ffe0d631d57b))
* **note-list:** render rows incrementally with a sentinel ([#154](https://github.com/2002Bishwajeet/journal/issues/154)) ([5e206c6](https://github.com/2002Bishwajeet/journal/commit/5e206c64149c2f325500f8c0fbafcf24805e4bfd))
* **sync:** check versionTag before decrypting remote notes ([#144](https://github.com/2002Bishwajeet/journal/issues/144)) ([128f55d](https://github.com/2002Bishwajeet/journal/commit/128f55d97cdff2f108f22b585277725dcd2b8c87))
* **sync:** process remote notes 5-wide on pull ([#145](https://github.com/2002Bishwajeet/journal/issues/145)) ([1e386e8](https://github.com/2002Bishwajeet/journal/commit/1e386e8793dc9ac8a75a142f43ce337ea27b30b2))
* **sync:** suspend live queries during bulk pulls ([#153](https://github.com/2002Bishwajeet/journal/issues/153)) ([cffa628](https://github.com/2002Bishwajeet/journal/commit/cffa62804e1d8c4211339a7dd1a6bf2e4bc5b9ec))
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
* **ux:** rotating boot quips on the splash screen ([2e3de73](https://github.com/2002Bishwajeet/journal/commit/2e3de7345c736bcfdc314314519359092e5392c5))
# [2.0.0](https://github.com/2002Bishwajeet/journal/compare/v1.1.8...v2.0.0) (2026-07-19)


### Bug Fixes

* **broadcast:** acknowledge same-tab flush instead of a blind 50ms sleep ([5adefe2](https://github.com/2002Bishwajeet/journal/commit/5adefe24d46859988d0af03f97ed608c6b713d72))
* **db:** atomic replaceDocumentUpdates for compaction/merge ([0a27ca3](https://github.com/2002Bishwajeet/journal/commit/0a27ca367a1a1ec142331ec8ce3d699f0c5fbee1))
* **deps:** clear npm audit advisories (lockfile refresh) ([d860bca](https://github.com/2002Bishwajeet/journal/commit/d860bcaf49bba6f7edf291e229fec917e83456ed))
* **editor:** address code-review findings on internal note links ([0bca303](https://github.com/2002Bishwajeet/journal/commit/0bca303f16235d92ece8edae0ad4513d252e92b2))
* **editor:** flush pending save on unmount so trailing edits reach the server ([2e03db3](https://github.com/2002Bishwajeet/journal/commit/2e03db362744ddc9f193c3972a7882830eec3d61))
* **editor:** give slash-commands and note-link suggestions unique plugin keys ([ad13516](https://github.com/2002Bishwajeet/journal/commit/ad13516aac7f979ff55289fa1fd7ac68ae74dd58))
* **editor:** save on first edit; skip only Yjs-origin transactions ([3039d32](https://github.com/2002Bishwajeet/journal/commit/3039d328acaaad81f288d8c07d8deabb4a318726))
* **images:** use the matched server thumbnail size ([f132b4e](https://github.com/2002Bishwajeet/journal/commit/f132b4e7074ff8b0d5111d5b6ef1adea12dd3ff7))
* **notes:** build real heading/paragraph blocks for created notes; copy template Yjs docs on spawn ([e39d598](https://github.com/2002Bishwajeet/journal/commit/e39d598145d987f525812ebecb89bf21ebc425aa))
* **notes:** derive image payload key from max index, not count ([3471cf8](https://github.com/2002Bishwajeet/journal/commit/3471cf875ba31ab23b2b908210ba4137aea6554f))
* **notes:** guard peer note update against missing globalTransitId ([43ddab4](https://github.com/2002Bishwajeet/journal/commit/43ddab4f20c952f24445a7e173eae7aa01b8e408))
* **notes:** honor encrypt option (?? not ||) and isPublic ACL in createNote ([247114b](https://github.com/2002Bishwajeet/journal/commit/247114b32891aabeb5bb8eefd3a4799e171e0488))
* **notes:** preserve encryption/ACL when adding images to public or shared notes ([2a827cf](https://github.com/2002Bishwajeet/journal/commit/2a827cfd79f3058ad5bd6c2ee6ecdace2f14fe85))
* **notes:** stop [[ picker flashing "No notes found" while searching ([78b33c3](https://github.com/2002Bishwajeet/journal/commit/78b33c36872f3549ca30cd03ed973b72256e57ca))
* **search:** advancedSearch always errored and fell back to LIKE ([a0608eb](https://github.com/2002Bishwajeet/journal/commit/a0608eb65b288c52d33ca5075ab732d33e419fb0))
* **security:** project public note content to a minimal, non-sensitive subset ([fbae37d](https://github.com/2002Bishwajeet/journal/commit/fbae37db1b0fbfdca113fcb4bb75a5f0476ebd8f))
* **security:** scope SW api-cache to same-origin and drop opaque responses ([7bab181](https://github.com/2002Bishwajeet/journal/commit/7bab181be09f79d3e4c0ac24b8a4ed21b2d2e6df))
* **security:** validate the /auth/finalize redirect target ([4f3f9ef](https://github.com/2002Bishwajeet/journal/commit/4f3f9ef3197ddb3b678497024903455f242ff5ae))
* **security:** wipe local data on every logout, not just manual logout ([33941c6](https://github.com/2002Bishwajeet/journal/commit/33941c69be4c9ad2a609ea25cf7ca3d00d010bf4))
* **sync:** flush the active editor before reading a note's push blob ([f763c13](https://github.com/2002Bishwajeet/journal/commit/f763c13cdd4243dcc50197c4bf79b90ab4e3e5a1))
* **sync:** generation guard so a slow push can't clobber a pending edit ([2478641](https://github.com/2002Bishwajeet/journal/commit/24786417ce91c63d51a411df52347cd960ce768a))
* **sync:** hash all pushed metadata fields so pin/share changes sync ([ab60b02](https://github.com/2002Bishwajeet/journal/commit/ab60b021d898c45c547e0d28e4f2a783bd60dcee))
* **sync:** never replace real Yjs content with an empty doc ([a0fe257](https://github.com/2002Bishwajeet/journal/commit/a0fe257ac76663dd7fefb53614a39dad94101f80))
* **yjs:** drain updates queued during an in-flight save ([51ed17f](https://github.com/2002Bishwajeet/journal/commit/51ed17f303ee309d71a66d46e602ba565caa3296))


### Features

* **editor:** add a table-of-contents side panel ([950c188](https://github.com/2002Bishwajeet/journal/commit/950c1887106e4e62bd7237018ccf3033cfba149f))
* **editor:** add H4–H6 heading buttons to the toolbar ([2a1f7cc](https://github.com/2002Bishwajeet/journal/commit/2a1f7cc65a0663e2bb3e8a98d18424e8819e976b))
* **editor:** add heading extraction and reading-time helpers ([47a13e5](https://github.com/2002Bishwajeet/journal/commit/47a13e5959bb1498887cf0637316b52dde09a5df))
* **editor:** internal note links [[ + backlinks ([16afb52](https://github.com/2002Bishwajeet/journal/commit/16afb52c9d06be7fc1594948d98acbf5a9a0d6d1))
* **editor:** show reading time beside the word count ([c860131](https://github.com/2002Bishwajeet/journal/commit/c86013156998e9847270ebed85f04c74e85e0434))
* **flags:** gate daily notes and templates UI behind boolean feature flags ([1de71a5](https://github.com/2002Bishwajeet/journal/commit/1de71a569d2fdef8c3a24ca60092a00e4d61b062))
* **notes:** daily note — find-or-create today's note ([89d7c41](https://github.com/2002Bishwajeet/journal/commit/89d7c4106d6c8bf97548d7a330d98a716d4d6e3e))
* **notes:** full search + frequent notes in the [[ link picker ([30c9328](https://github.com/2002Bishwajeet/journal/commit/30c9328c1e7752b0e1b70f060cad1eda5efd0853))
* **notes:** note templates from a Templates folder ([aea0425](https://github.com/2002Bishwajeet/journal/commit/aea04256ac296e2bdd8d2ea917a7a2eeea53dec9))


### Performance Improvements

* **ai:** stop polling engine readiness once ready or disabled ([0172de0](https://github.com/2002Bishwajeet/journal/commit/0172de055f94f5070965c80a05ac51979fcc5f94))
* **db:** load PGlite v3 only when a v3 database actually exists ([80ebce4](https://github.com/2002Bishwajeet/journal/commit/80ebce4ec471b4cd1d9aa86ac880d3c4430ff882))
* **db:** park idle live queries; coalesce emissions ([2c31e46](https://github.com/2002Bishwajeet/journal/commit/2c31e46bcde91a1fecee121350bc91b91dd68278))
* **editor:** compute plain text once per debounce window, not per keystroke ([6c68140](https://github.com/2002Bishwajeet/journal/commit/6c68140cb043bfe055abea44e96c6671f2e07d5a))
* **notes:** fast dedicated query for [[ picker instead of advancedSearch ([fe3c387](https://github.com/2002Bishwajeet/journal/commit/fe3c38733fcec18393cf1f39a039c64bb145682d))
* **notes:** index modified-timestamp sort + debounce [[ picker queries ([662ca21](https://github.com/2002Bishwajeet/journal/commit/662ca21c49899a86eafe10e18e8425135f28c9bb))
* **notes:** stable note-list row identity so memo holds ([c9df839](https://github.com/2002Bishwajeet/journal/commit/c9df839ae7c3d70a6b91aaa4e45cd993273af0db))
* **pwa:** stop precaching WebLLM runtime; cache on first use ([26cfa2d](https://github.com/2002Bishwajeet/journal/commit/26cfa2de9cafe8fdb4747a47ddc7bf8e546abab7))
## [1.1.7](https://github.com/2002Bishwajeet/journal/compare/v1.1.6...v1.1.7) (2026-06-04)


### Bug Fixes

* address Vercel best practices review on find/replace ([8dc1c66](https://github.com/2002Bishwajeet/journal/commit/8dc1c6614bb2bf36c468206d7740f04d3e2a3b9f))
* **deploy:** serve built dist/ on Cloudflare and restore COEP/COOP ([2b6a302](https://github.com/2002Bishwajeet/journal/commit/2b6a302538485f6f379ef397a049c36a280e8557))
* **lint:** resolve eslint errors in peer-note fetch UI ([421109e](https://github.com/2002Bishwajeet/journal/commit/421109e37411063ec8ee3ea55dd143b924fc49ee))
* **test:** correct lifecycle transition in bootstrap test ([51fbd73](https://github.com/2002Bishwajeet/journal/commit/51fbd73a12eb24a6462d3841aa12af989af875e9))
* **types:** resolve tsc -b build errors in collaboration WS code ([5426e76](https://github.com/2002Bishwajeet/journal/commit/5426e76e0ca78359c62b8f03dedbd61f768b7f2c))


### Features

* add in-editor find and replace (Cmd+F / Cmd+H) ([753e3f8](https://github.com/2002Bishwajeet/journal/commit/753e3f8a84320abe203af9b99f2e350c9787c759))
* bootstrap collaborative note with sync record on invitation ([862fd3c](https://github.com/2002Bishwajeet/journal/commit/862fd3c277fa4c25cd1ef57133440b8b4200a0c6))
* collaboration feature — sync fixes, UI, distribution, peer websocket ([8eb8205](https://github.com/2002Bishwajeet/journal/commit/8eb8205cb814fa42f18931be5294b47cc4e1c02e))
* local-first peer-note fetch with revalidate-on-open ([70d4415](https://github.com/2002Bishwajeet/journal/commit/70d4415c0149e59d086ade8f2def3a237740ca0a))
* stamp lastEditedBy on collaborative edits and add peer fetch debug logging ([d3d1022](https://github.com/2002Bishwajeet/journal/commit/d3d10226e363d739f5b8b8370ae0b8015337be41))
* websocket process queue ([2ec2c8a](https://github.com/2002Bishwajeet/journal/commit/2ec2c8a76b22eceeaa5b237b8326c2644b7b33b6))


### Performance Improvements

* parallelize peer fetches and fix excludeFromAI type safety ([4e10b62](https://github.com/2002Bishwajeet/journal/commit/4e10b622cd0d7c2b78b1682a13cdff35bc1c3834))
# Changelog

All notable changes to Journal will be documented in this file.

## [1.1.0] - 2026-04-19

### Features

#### Editor
- **Underline** formatting with Cmd+U
- **Subscript** (Cmd+,) and **Superscript** (Cmd+.) support
- **Text alignment** — left, center, right, justify with keyboard shortcuts (Cmd+Shift+L/E/R/J)
- **Clear formatting** button and Cmd+\ shortcut on all toolbars and bubble menu
- **Duplicate block** via Cmd+Shift+D and slash command
- **Indent / outdent** paragraphs and headings with Tab/Shift+Tab
- **H4, H5, H6** headings in slash commands
- **Word count** and character count status bar at editor bottom
- **Table button** on mobile toolbar

#### Tags
- **Tag input** below note title — type `#` or comma-separated tags with autocomplete from existing tags
- **Tag chips** on note list items (up to 3 with overflow count)
- **Tag filter** in sidebar — click a tag to filter notes across all folders
- **Cross-folder filtering** via `?tag=` query parameter
- Tags sync automatically to Homebase via existing metadata pipeline

#### Navigation & UX
- **Keyboard shortcuts help modal** (Cmd+/) — lists all shortcuts in categorized two-column layout
- **Focus / zen mode** (Cmd+Shift+F) — hides sidebar, note list, and tab bar for distraction-free writing with centered narrow content
- **Note sorting** — sort by last modified, date created, or title A-Z via dropdown in note list header
- **Focus mode toggle button** in tab bar for discoverability

#### AI & Models
- **AI settings hook** with localStorage persistence and cross-tab sync
- **Model registry** — Qwen 2.5 1.5B (default), SmolLM2 360M, Qwen 2.5 0.5B, Llama 3.2 1B
- **Model selection** UI in Settings > AI & Models tab with download size and memory indicators
- **Grammar plugin** re-enabled with hallucination filtering guards
- **Settings modal redesign** — tabbed layout with General, AI & Models, Data & Security, About sections

### Performance
- **WebLLM moved to Web Worker** — zero main-thread blocking for AI inference
- **Note list virtualization** with @tanstack/react-virtual
- **Lightweight NoteListEntry** queries — only title + 150-char preview, no full content transfer
- **GIN/BTREE indexes** on metadata JSONB for faster folder and tag filtering
- **React Compiler** enabled in production builds for automatic memoization
- **NoteItem memoization** to prevent unnecessary re-renders
- **Debounced word count** updates (500ms) with proper cleanup

### Bug Fixes
- Fix settings and checklist save error
- Fix tab notes persisting across sessions
- Fix metadata mutations truncating note content
- Fix ChatBot accessing truncated content instead of full note
- Fix ResizeObserver infinite loop in virtualized list
- Fix WebLLM auto-init freezing UI on load
- Fix React Compiler causing dev server freeze (production-only)
- Fix Switch toggle invisible in light mode (bg-input → bg-zinc-300)
- Fix Settings modal scrollbar causing layout shift
- Fix duplicate Underline extension warning (StarterKit 3.x bundles it)
- Fix tags not appearing in sidebar after sync (missing query invalidation)
- Fix date grouping using wrong timestamp when sorting by creation date
- Fix null preview in tag-filtered note queries
- Fix word count setState after unmount (explicit timeout ref with cleanup)
- Fix EditorProvider initial-load guard preventing false metadata timestamp bumps
- Fix deprecated navigator.platform usage
- Fix AITabProps type mismatch for async return types
- Fix unused imports and lint errors across codebase

### Refactoring
- Consolidate 3 duplicate ToolbarButton components into shared variant system (desktop/mobile/bubble)
- Extract shared Kbd component to `ui/kbd.tsx`, used in KeyboardShortcutsModal and SearchModal
- Extract DuplicateBlock into proper TipTap command, reuse in slash menu
- Use semantic design tokens in TextAlignPicker instead of hardcoded colors
- Tag filtering uses URL query params instead of React state

### Tests
- AI settings and model registry tests (12)
- Editor extensions registration tests (14)
- Slash commands and filterCommands tests (11)
- Keyboard shortcuts tests (9)
- Tag query tests (4)
- **Total: 151 tests passing**

## [1.0.6] - 2026-04-15

Initial tracked release.
