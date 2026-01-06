import { upsertSearchIndex, saveDocumentUpdate, getAllDocuments } from '@/lib/db';
import { getNewId } from '@/lib/utils';
import * as Y from 'yjs';
import type { DocumentMetadata } from '@/types';
import { MAIN_FOLDER_ID } from '../homebase';



interface ImportResult {
    imported: number;
    skipped: number;
    errors: string[];
}

/**
 * Import Notion export (markdown and CSV files)
 * Handles Notion's specific markdown format and database exports
 */
export async function importNotionExport(files: FileList): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
    const existingTitles = new Set<string>();

    // Get existing note titles to avoid duplicates
    try {
        const existingDocs = await getAllDocuments();
        for (const doc of existingDocs) {
            existingTitles.add(doc.title.toLowerCase());
        }
    } catch {
        // Ignore errors getting existing docs
    }

    for (const file of files) {
        try {
            if (file.name.endsWith('.md')) {
                await importNotionMarkdown(file, existingTitles, result);
            } else if (file.name.endsWith('.csv')) {
                await importNotionCSV(file, existingTitles, result);
            } else {
                result.skipped++;
            }
        } catch (error) {
            result.errors.push(`Failed to import ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return result;
}

/**
 * Import a Notion markdown file
 */
async function importNotionMarkdown(
    file: File,
    existingTitles: Set<string>,
    result: ImportResult
): Promise<void> {
    const text = await file.text();
    const { metadata, content } = parseNotionMarkdown(text, file.name);

    // Check for duplicate
    if (existingTitles.has(metadata.title.toLowerCase())) {
        result.skipped++;
        return;
    }

    // Create Yjs document
    const doc = new Y.Doc();
    const xmlFragment = doc.getXmlFragment('prosemirror');

    // Convert content to ProseMirror structure
    const paragraphs = content.split('\n\n').filter(p => p.trim());
    for (const para of paragraphs) {
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.insert(0, [new Y.XmlText(para.trim())]);
        xmlFragment.push([paragraph]);
    }

    const docId = getNewId();
    const updateBlob = Y.encodeStateAsUpdate(doc);

    await saveDocumentUpdate(docId, updateBlob);
    await upsertSearchIndex({
        docId,
        title: metadata.title,
        plainTextContent: content,
        metadata,
    });

    existingTitles.add(metadata.title.toLowerCase());
    result.imported++;
}

/**
 * Parse Notion markdown format
 * Handles Notion-specific formatting like callouts, toggles, etc.
 */
function parseNotionMarkdown(text: string, filename: string): { metadata: DocumentMetadata; content: string } {
    const now = new Date().toISOString();
    let content = text;
    let title = cleanNotionFilename(filename);
    const tags: string[] = [];

    // Parse Notion's frontmatter-like properties at the top
    // Notion uses this format:
    // # Page Title
    // 
    // Property: Value
    // Tags: tag1, tag2

    // Extract title from first h1
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
        title = h1Match[1].trim();
        content = content.replace(h1Match[0], '').trim();
    }

    // Extract tags if present
    const tagsMatch = content.match(/^Tags?:\s*(.+)$/mi);
    if (tagsMatch) {
        const tagList = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        tags.push(...tagList);
        content = content.replace(tagsMatch[0], '').trim();
    }

    // Convert Notion callouts to blockquotes
    // > 💡 Callout text → > Callout text
    content = content.replace(/^>\s*[🔶💡⚠️❗📌🎯]\s*/gm, '> ');

    // Convert Notion toggle syntax
    // <details><summary>Toggle</summary>Content</details>
    content = content.replace(/<details>\s*<summary>(.+?)<\/summary>([\s\S]*?)<\/details>/g, (_, summary, body) => {
        return `**${summary}**\n${body.trim()}`;
    });

    // Convert Notion database links
    // [Page Title](notion://...)  → [Page Title]
    content = content.replace(/\[([^\]]+)\]\(notion:\/\/[^)]+\)/g, '[[$1]]');

    // Clean up Notion-specific artifacts
    content = content.replace(/\n{3,}/g, '\n\n'); // Multiple newlines

    return {
        metadata: {
            title,
            folderId: MAIN_FOLDER_ID,
            tags,
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
        },
        content: content.trim(),
    };
}

/**
 * Import a Notion CSV database export
 * Each row becomes a separate note
 */
async function importNotionCSV(
    file: File,
    existingTitles: Set<string>,
    result: ImportResult
): Promise<void> {
    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length < 2) {
        result.skipped++;
        return;
    }

    const headers = rows[0].map(h => h.toLowerCase().trim());
    const titleIndex = headers.findIndex(h => h === 'name' || h === 'title');
    const tagsIndex = headers.findIndex(h => h === 'tags' || h === 'labels');
    const contentIndex = headers.findIndex(h => h === 'content' || h === 'description' || h === 'notes');

    if (titleIndex === -1) {
        result.errors.push(`CSV ${file.name}: No 'Name' or 'Title' column found`);
        return;
    }

    const now = new Date().toISOString();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const title = row[titleIndex]?.trim() || `Untitled ${i}`;

        if (existingTitles.has(title.toLowerCase())) {
            result.skipped++;
            continue;
        }

        const tags: string[] = [];
        if (tagsIndex !== -1 && row[tagsIndex]) {
            tags.push(...row[tagsIndex].split(',').map(t => t.trim()).filter(Boolean));
        }

        const content = contentIndex !== -1 ? row[contentIndex] || '' : '';

        // Build a note from all columns
        const allContent = headers
            .map((header, idx) => {
                if (idx === titleIndex || !row[idx]) return null;
                return `**${capitalize(header)}:** ${row[idx]}`;
            })
            .filter(Boolean)
            .join('\n\n');

        const finalContent = content || allContent;

        const doc = new Y.Doc();
        const xmlFragment = doc.getXmlFragment('prosemirror');
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.insert(0, [new Y.XmlText(finalContent)]);
        xmlFragment.push([paragraph]);

        const docId = getNewId();
        const updateBlob = Y.encodeStateAsUpdate(doc);

        const metadata: DocumentMetadata = {
            title,
            folderId: MAIN_FOLDER_ID,
            tags,
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
        };

        await saveDocumentUpdate(docId, updateBlob);
        await upsertSearchIndex({
            docId,
            title,
            plainTextContent: finalContent,
            metadata,
        });

        existingTitles.add(title.toLowerCase());
        result.imported++;
    }
}

/**
 * Simple CSV parser
 */
function parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    const lines = text.split('\n');

    for (const line of lines) {
        if (!line.trim()) continue;

        const cells: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                cells.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        cells.push(current.trim());
        rows.push(cells);
    }

    return rows;
}

/**
 * Clean up Notion's filename format
 * Example: "My Page abc123def456.md" → "My Page"
 */
function cleanNotionFilename(filename: string): string {
    // Remove .md extension
    let name = filename.replace(/\.md$/, '');

    // Remove Notion's UUID suffix (32 hex chars at the end)
    name = name.replace(/\s+[a-f0-9]{32}$/i, '');

    return name.trim() || 'Untitled';
}

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
