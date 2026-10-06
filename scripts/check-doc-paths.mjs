#!/usr/bin/env node
// Lists every backticked repo path in AGENTS.md and README.md that doesn't exist on disk.
// Run from the repo root: `node scripts/check-doc-paths.mjs`. Exits 1 when any path is missing.
import { existsSync, readFileSync } from 'node:fs';

const DOCS = ['AGENTS.md', 'README.md'];
const PREFIX = /^(src|e2e|functions|mcp|public|scripts)\//;

const missing = [];
for (const doc of DOCS) {
  for (const [, token] of readFileSync(doc, 'utf8').matchAll(/`([^`\n]+)`/g)) {
    if (!PREFIX.test(token)) continue;
    const path = token.replace(/:\d[\d,-]*$/, '');
    if (!existsSync(path)) missing.push(`${doc}: ${token}`);
  }
}

if (missing.length) {
  console.error(`Missing paths:\n${missing.join('\n')}`);
  process.exit(1);
}
console.log(`All backticked paths in ${DOCS.join(' and ')} exist.`);
