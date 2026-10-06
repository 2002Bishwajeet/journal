---
description: Connect the Journal MCP server to your Homebase identity
argument-hint: <identity, e.g. you.dotyou.cloud>
allowed-tools: Bash(npx -y https://github.com/2002Bishwajeet/journal/releases/download/mcp-v1.2.2/journal-mcp-1.2.2.tgz *)
---

Log the Journal MCP server in to the identity `$ARGUMENTS`. If no identity was given, ask for it first.

1. Run `npx -y https://github.com/2002Bishwajeet/journal/releases/download/mcp-v1.2.2/journal-mcp-1.2.2.tgz login $ARGUMENTS` in the background. It prints an authorization URL and waits for approval.
2. Show the user that URL and ask them to approve **Journal MCP** in their owner console.
3. When the command exits, report its result. On success, tell the user to run `/mcp` and reconnect the `journal` server, then grant folders or notes in **Journal → Settings → Agent access** (nothing is visible until they do).
