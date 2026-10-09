# Journal positioning (draft for v3.0.0)

Status: draft, 2026-10-09. Claims about Journal come from the repo and issues #555, #563 and #564. Claims about other products are footnoted; a cell we could not check says "—".

## Your notes on your device, private by design.

Journal is a notebook that keeps every note in a database inside your browser, so it opens fast and works offline. Sync is a layer on top, not the place your notes live. AI agents can write in your notes through an MCP server, and only in the folders and notes you allow. They can build live blocks (Mermaid diagrams, SVG, HTML and React) that run inside the note instead of in a separate chat. When you want to publish a note, it goes out from your own private space as a public page. Journal is open source under the AGPL-3.0.

## Under the hood: your own private space

Sync, sharing and sign-in run on Homebase (homebase.id). For you, it is your own private space: your notes, synced and encrypted, on an identity that belongs to you. You do not need to know how it works to use Journal.

What works today, and what is planned:

| | Today | Planned |
|---|---|---|
| Sign in | Needs an identity (your private space) | "Start without an account": a local-only mode on one device (#563, proposal, not decided) |
| Editor, live blocks, import and export | Yes | Also in local-only mode (#563) |
| Local AI (grammar, rewrite, chat) | Yes, runs in the browser, desktop only | Also in local-only mode (#563) |
| AI agents through MCP | Yes, with an identity; the server reads and writes your private space | A local bridge so agents work without an identity while a Journal tab is open (#563, proposal) |
| Sync across devices | Yes, encrypted, with an identity | Connecting later uploads everything, no migration (#563) |
| Public pages | Yes, with an identity | No change |
| Encryption of the copy on your device | No, the browser database is not yet encrypted | Passkey or passphrase unlock (#555, in progress, headline of v3.0.0) |

Do not say "works without an account" until #563 ships.

## How Journal compares

| | Journal | Notion | Obsidian | Claude artifacts |
|---|---|---|---|---|
| Where notes live | In a database in your browser; a synced copy in your private space | Notion's cloud, encrypted at rest [1] | Markdown files in a folder on your device [5] | In your Claude account, in the Artifacts tab [10] |
| Works offline | Yes | Pages you download, in desktop and mobile apps only, not the web [2] | Yes [6] | — |
| End-to-end encryption | Synced copy: yes. Device copy: planned (#555). Public notes are not encrypted, by design | Not listed; Notion lists AES-256 at rest and TLS in transit [1] | Yes, with Obsidian Sync (default for new remote vaults) [7] | — |
| AI agents can edit notes | Yes, through MCP, with per-folder and per-note grants (default: none) | Yes, through Notion MCP, with your full permissions [3] | — | Claude makes and edits artifacts [10] |
| Interactive artifact blocks inside notes | Yes: Mermaid, SVG, HTML and React live blocks | — | — | Yes, as stand-alone artifacts, not inside notes [10] |
| Public sharing on your own domain | Partly: the note is published from your own identity; the reading page is on the Journal site at `/share/<your-identity>/…` | Yes, with Notion Sites on a paid plan, +$10/month per domain [4] | Yes, with Obsidian Publish, a paid add-on [8][14] | Link sharing; viewers need a Claude account, except published legacy chat artifacts [11]. Custom domain: — |
| Open source | Yes, AGPL-3.0 | — | No [9] | — |
| Free core | Yes (a paid Pro plan for hosted extras is planned, #306) | Yes, Free plan [12] | Yes, free for all purposes; Sync and Publish are paid add-ons [13][14] | Yes, artifacts are on the Free plan; storage and app connections need a paid plan [10] |

Notes on the table:

- Journal's "partly" on custom domains is deliberate. The public note lives on your identity's domain, but readers open it on the Journal site. Do not write "on your own domain" without that qualifier.
- Journal's MCP server and public pages need an identity today. Say so next to any claim that uses them, until #563 ships.
- Live blocks are shipped. The "artifact-level" upgrade (#556) and block-level MCP editing (#560) are still open. Do not claim them until they merge.

## Sources

All accessed 2026-10-09.

1. https://www.notion.com/help/security-and-privacy : Notion encrypts customer data at rest with AES-256 and in transit with TLS 1.2+. The page does not mention end-to-end encryption.
2. https://www.notion.com/help/use-pages-offline : all plans can use pages offline; desktop and mobile apps only, "not available on web browsers"; pages are downloaded one by one (automatic for recent and favorite pages on paid plans).
3. https://www.notion.com/help/notion-mcp : Notion MCP lets AI tools "read from and write to your Notion pages"; tools "act with your full Notion permissions".
4. https://www.notion.com/help/connect-a-custom-domain-with-notion-sites : custom domains for Notion Sites, paid plans only, $10/month per domain ($8 annual).
5. https://obsidian.md/help/data-storage : notes are Markdown files in a vault, "a folder on your local file system".
6. https://obsidian.md/ : "Obsidian stores notes privately on your device, so you can access them quickly, even offline."
7. https://obsidian.md/help/sync/security : Obsidian Sync end-to-end encryption, listed as the default for new remote vaults.
8. https://obsidian.md/help/publish/domains : "You can set up a custom domain or subdomain for your Obsidian Publish site."
9. https://github.com/obsidianmd/obsidian-releases (README) : "Obsidian is not open source software".
10. https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them : what artifacts are (including interactive tools and diagrams), saved to the Artifacts tab, available on the Free plan; data storage and app connections need a paid plan.
11. https://support.claude.com/en/articles/9547008-publish-and-share-artifacts : artifacts start private; link sharing on all plans; viewers need a Claude account except for published legacy chat artifacts. The page does not mention custom domains.
12. https://www.notion.com/pricing : a "Free" plan at 0 per member per month.
13. https://obsidian.md/license : "Obsidian is free for all purposes, including personal, commercial, and non-profit use".
14. https://obsidian.md/pricing : the app is free; Sync ($4-5 per user per month) and Publish ($8-10 per site per month) are optional paid add-ons.
