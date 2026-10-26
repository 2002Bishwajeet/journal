#!/usr/bin/env node
// Manual Release: gather the user notes for the next version and put them under
// a new "## <version> (<date>)" heading in RELEASE_NOTES.md, and print them for
// the GitHub release body. Notes come from one file per PR in release-notes/
// (so two open PRs never edit the same lines) plus anything still written under
// RELEASE_NOTES.md's "## Unreleased". The used files are deleted.
// Exits 1 when there are no notes, so a release never ships without notes.
// Usage: node scripts/release-notes.mjs <version> <yyyy-mm-dd>
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UNRELEASED = /^## Unreleased[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
const ORDER = ['New', 'Changed', 'Fixed'];
const FRAGMENTS = 'release-notes';

// Joins note bodies ("### Section" + bullets) into one body, one heading per section.
function mergeNotes(bodies) {
  const sections = new Map();
  for (const body of bodies) {
    let current = '';
    for (const line of body.split(/\r?\n/)) {
      const heading = /^### (.+?)\s*$/.exec(line);
      if (heading) current = heading[1];
      else if (line.trim()) sections.set(current, [...(sections.get(current) ?? []), line]);
    }
  }
  const names = [...sections.keys()].sort((a, b) => rank(a) - rank(b));
  return names
    .map((name) => (name ? `### ${name}\n\n` : '') + sections.get(name).join('\n'))
    .join('\n\n');
}

const rank = (name) => (ORDER.includes(name) ? ORDER.indexOf(name) : name ? ORDER.length : -1);

export function stampRelease(markdown, version, date, fragments = []) {
  const match = UNRELEASED.exec(markdown);
  if (!match) throw new Error('RELEASE_NOTES.md has no "## Unreleased" section');
  const body = mergeNotes([match[1], ...fragments]).trim();
  if (!body) throw new Error(`No release notes: "## Unreleased" is empty and ${FRAGMENTS}/ has no files`);
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
    const files = readdirSync(FRAGMENTS)
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .sort()
      .map((f) => `${FRAGMENTS}/${f}`);
    const fragments = files.map((f) => readFileSync(f, 'utf8'));
    const { markdown, body } = stampRelease(readFileSync('RELEASE_NOTES.md', 'utf8'), version, date, fragments);
    writeFileSync('RELEASE_NOTES.md', markdown);
    for (const f of files) rmSync(f);
    process.stdout.write(`${body}\n`);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
