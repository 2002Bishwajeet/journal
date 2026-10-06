#!/usr/bin/env node
// Manual Release: move RELEASE_NOTES.md's "## Unreleased" bullets under a new
// "## <version> (<date>)" heading, and print them for the GitHub release body.
// Exits 1 when Unreleased is empty, so a release never ships without notes.
// Usage: node scripts/release-notes.mjs <version> <yyyy-mm-dd>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UNRELEASED = /^## Unreleased[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m;

export function stampRelease(markdown, version, date) {
  const match = UNRELEASED.exec(markdown);
  if (!match) throw new Error('RELEASE_NOTES.md has no "## Unreleased" section');
  const body = match[1].trim();
  if (!body) throw new Error('"## Unreleased" in RELEASE_NOTES.md is empty: write the release notes first');
  const stamped = `## Unreleased\n\n## ${version} (${date})\n\n${body}\n\n`;
  return { markdown: markdown.replace(match[0], stamped), body };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, date] = process.argv.slice(2);
  if (!version || !date) {
    console.error('usage: release-notes.mjs <version> <yyyy-mm-dd>');
    process.exit(2);
  }
  try {
    const { markdown, body } = stampRelease(readFileSync('RELEASE_NOTES.md', 'utf8'), version, date);
    writeFileSync('RELEASE_NOTES.md', markdown);
    process.stdout.write(`${body}\n`);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
