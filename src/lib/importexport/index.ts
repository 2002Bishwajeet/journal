import { getAllDocuments, getDocumentUpdates, upsertSearchIndex, saveDocumentUpdate } from '@/lib/db';
import { getNewId } from '@/lib/utils';
import * as Y from 'yjs';
import type { DocumentMetadata, SearchIndexEntry } from '@/types';
import { MAIN_FOLDER_ID } from '../homebase';

// Re-export Notion import
export { importNotionExport } from './notionImport';


/**
 * Export a single note as a markdown file
 */
export async function exportNoteAsMarkdown(note: SearchIndexEntry): Promise<void> {
    // Get Yjs content
    const updates = await getDocumentUpdates(note.docId);
    const doc = new Y.Doc();
    for (const update of updates) {
        Y.applyUpdate(doc, update);
    }

    // Convert Yjs to plain text (basic conversion)
    const xmlFragment = doc.getXmlFragment('prosemirror');
    const content = xmlFragmentToMarkdown(xmlFragment);

    // Create markdown with frontmatter
    const markdown = generateMarkdownWithFrontmatter(note, content);

    // Download file
    downloadFile(`${sanitizeFilename(note.title || 'Untitled')}.md`, markdown, 'text/markdown');
}

/**
 * Export all notes as a zip file
 */
export async function exportVaultAsZip(): Promise<void> {
    const notes = await getAllDocuments();

    // Dynamic import for JSZip (only when needed)
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    for (const note of notes) {
        const updates = await getDocumentUpdates(note.docId);
        const doc = new Y.Doc();
        for (const update of updates) {
            Y.applyUpdate(doc, update);
        }

        const xmlFragment = doc.getXmlFragment('prosemirror');
        const content = xmlFragmentToMarkdown(xmlFragment);
        const markdown = generateMarkdownWithFrontmatter(note, content);

        // Create folder structure
        const folder = note.metadata.folderId === MAIN_FOLDER_ID
            ? ''
            : `${note.metadata.folderId}/`;

        zip.file(`${folder}${sanitizeFilename(note.title || 'Untitled')}.md`, markdown);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadFile('journal-export.zip', blob, 'application/zip');
}

/**
 * Import markdown files
 */
export async function importMarkdownFiles(files: FileList): Promise<number> {
    let imported = 0;

    for (const file of files) {
        if (!file.name.endsWith('.md')) continue;

        const text = await file.text();
        const { metadata, content } = parseMarkdownWithFrontmatter(text, file.name);

        // Create Yjs document with content
        const doc = new Y.Doc();
        const xmlFragment = doc.getXmlFragment('prosemirror');

        // Simple conversion: wrap content in paragraph
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.insert(0, [new Y.XmlText(content)]);
        xmlFragment.insert(0, [paragraph]);

        const docId = getNewId();
        const updateBlob = Y.encodeStateAsUpdate(doc);

        // Save to database
        await saveDocumentUpdate(docId, updateBlob);
        await upsertSearchIndex({
            docId,
            title: metadata.title,
            plainTextContent: content,
            metadata,
        });

        imported++;
    }

    return imported;
}

interface ObsidianImportResult {
    imported: number;
    skipped: number;
    errors: string[];
}

/**
 * Import an Obsidian vault
 * Handles folder-to-tag conversion, wikilinks, and filename collisions
 */
export async function importObsidianVault(files: FileList): Promise<ObsidianImportResult> {
    const result: ObsidianImportResult = { imported: 0, skipped: 0, errors: [] };
    const existingTitles = new Map<string, number>(); // Track title counts for collision handling

    // Get existing note titles
    try {
        const existingDocs = await getAllDocuments();
        for (const doc of existingDocs) {
            existingTitles.set(doc.title.toLowerCase(), 1);
        }
    } catch {
        // Ignore errors getting existing docs
    }

    // Sort files to ensure consistent import order
    const sortedFiles = Array.from(files).sort((a, b) =>
        (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name)
    );

    for (const file of sortedFiles) {
        // Skip non-markdown files and hidden files
        if (!file.name.endsWith('.md') || file.name.startsWith('.')) {
            result.skipped++;
            continue;
        }

        // Skip Obsidian config files
        const path = file.webkitRelativePath || file.name;
        if (path.includes('.obsidian/') || path.includes('.trash/')) {
            result.skipped++;
            continue;
        }

        try {
            await importObsidianFile(file, existingTitles, result);
        } catch (error) {
            result.errors.push(`Failed to import ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return result;
}

async function importObsidianFile(
    file: File,
    existingTitles: Map<string, number>,
    result: ObsidianImportResult
): Promise<void> {
    const text = await file.text();
    const { metadata, content } = parseObsidianFile(text, file);

    // Handle title collisions
    let title = metadata.title;
    const lowerTitle = title.toLowerCase();
    if (existingTitles.has(lowerTitle)) {
        const count = existingTitles.get(lowerTitle)! + 1;
        existingTitles.set(lowerTitle, count);
        title = `${metadata.title} (${count})`;
        metadata.title = title;
    } else {
        existingTitles.set(lowerTitle, 1);
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

    result.imported++;
}

/**
 * Parse an Obsidian markdown file
 * Extracts folder path as tags and converts wikilinks
 */
function parseObsidianFile(text: string, file: File): { metadata: DocumentMetadata; content: string } {
    const now = new Date().toISOString();
    const path = file.webkitRelativePath || file.name;

    // Extract folder path for tags
    const pathParts = path.split('/');
    const filename = pathParts.pop() || file.name;
    const title = filename.replace(/\.md$/, '');

    // Convert folder path to tags: Work/Projects/Note.md → #Work/Projects
    const tags: string[] = [];
    if (pathParts.length > 1) { // Skip root vault folder
        const folderPath = pathParts.slice(1).join('/'); // Remove vault root
        if (folderPath) {
            tags.push(folderPath);
        }
    }

    let content = text;
    let parsedTitle = title;
    const additionalTags: string[] = [];

    // Parse Obsidian YAML frontmatter
    const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (frontmatterMatch) {
        content = text.slice(frontmatterMatch[0].length);

        // Extract title from frontmatter
        const titleMatch = frontmatterMatch[1].match(/title:\s*["']?([^"'\n]+)["']?/);
        if (titleMatch) {
            parsedTitle = titleMatch[1].trim();
        }

        // Extract tags from frontmatter
        const tagsMatch = frontmatterMatch[1].match(/tags:\s*\[(.*?)\]/);
        if (tagsMatch) {
            tagsMatch[1].split(',').forEach(tag => {
                const cleaned = tag.trim().replace(/^["']|["']$/g, '');
                if (cleaned) additionalTags.push(cleaned);
            });
        }

        // Also handle YAML list format for tags
        const yamlTagsMatch = frontmatterMatch[1].match(/tags:\s*\n((?:\s*-\s*.+\n?)+)/);
        if (yamlTagsMatch) {
            const tagLines = yamlTagsMatch[1].match(/-\s*(.+)/g);
            if (tagLines) {
                tagLines.forEach(line => {
                    const tag = line.replace(/^-\s*/, '').trim();
                    if (tag) additionalTags.push(tag);
                });
            }
        }
    }

    // Merge tags
    tags.push(...additionalTags);

    // Convert Obsidian wikilinks to standard markdown links
    // [[Note]] → [Note](note)
    // [[Note|Display]] → [Display](note)
    content = content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) => {
        const linkText = display || target;
        const linkTarget = target.toLowerCase().replace(/\s+/g, '-');
        return `[${linkText}](${linkTarget})`;
    });

    // Convert Obsidian embeds to images/links
    // ![[image.png]] → ![image.png](image.png)
    content = content.replace(/!\[\[([^\]]+)\]\]/g, (_, target) => {
        return `![${target}](${target})`;
    });

    // Handle Obsidian callouts → blockquotes
    // > [!note] Title → > **Note:** Title
    content = content.replace(/^>\s*\[!(\w+)\]\s*(.*?)$/gm, (_, type, rest) => {
        const formattedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
        return `> **${formattedType}:** ${rest}`;
    });

    // Handle inline tags: #tag → (kept as-is, already compatible)
    // Extract inline tags and add to metadata
    const inlineTags = content.match(/#[\w-/]+/g);
    if (inlineTags) {
        inlineTags.forEach(tag => {
            const cleanTag = tag.slice(1); // Remove #
            if (!tags.includes(cleanTag)) {
                tags.push(cleanTag);
            }
        });
    }

    return {
        metadata: {
            title: parsedTitle,
            folderId: MAIN_FOLDER_ID, // All imported to Main folder (flattened)
            tags: [...new Set(tags)], // Deduplicate
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
        },
        content: content.trim(),
    };
}

/**
 * Detect import format based on file structure
 */
export function detectImportFormat(files: FileList): 'markdown' | 'obsidian' | 'notion' | 'unknown' {
    let hasObsidianConfig = false;
    let hasNotionFormat = false;
    let hasMarkdown = false;

    for (const file of files) {
        const path = file.webkitRelativePath || file.name;

        if (path.includes('.obsidian/')) {
            hasObsidianConfig = true;
        }

        if (file.name.match(/[a-f0-9]{32}\.md$/i)) {
            hasNotionFormat = true;
        }

        if (file.name.endsWith('.md')) {
            hasMarkdown = true;
        }
    }

    if (hasObsidianConfig) return 'obsidian';
    if (hasNotionFormat) return 'notion';
    if (hasMarkdown) return 'markdown';
    return 'unknown';
}

// Helper functions

function sanitizeFilename(name: string): string {
    return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Untitled';
}

function generateMarkdownWithFrontmatter(note: SearchIndexEntry, content: string): string {
    const frontmatter = [
        '---',
        `title: "${note.title}"`,
        `created: "${note.metadata.timestamps.created}"`,
        `modified: "${note.metadata.timestamps.modified}"`,
        `tags: [${note.metadata.tags.map(t => `"${t}"`).join(', ')}]`,
        '---',
        '',
    ].join('\n');

    return frontmatter + content;
}

function parseMarkdownWithFrontmatter(text: string, filename: string): { metadata: DocumentMetadata; content: string } {
    const now = new Date().toISOString();
    let content = text;
    let title = filename.replace(/\.md$/, '');
    const tags: string[] = [];

    // Parse frontmatter if present
    const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (frontmatterMatch) {
        content = text.slice(frontmatterMatch[0].length);

        const titleMatch = frontmatterMatch[1].match(/title:\s*"?([^"\n]+)"?/);
        if (titleMatch) title = titleMatch[1];

        const tagsMatch = frontmatterMatch[1].match(/tags:\s*\[(.*?)\]/);
        if (tagsMatch) {
            tagsMatch[1].split(',').forEach(tag => {
                const cleaned = tag.trim().replace(/^["']|["']$/g, '');
                if (cleaned) tags.push(cleaned);
            });
        }
    }

    return {
        metadata: {
            title,
            folderId: MAIN_FOLDER_ID,
            tags,
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
        },
        content,
    };
}

function xmlFragmentToMarkdown(fragment: Y.XmlFragment): string {
    const lines: string[] = [];

    for (const child of fragment.toArray()) {
        if (child instanceof Y.XmlElement) {
            lines.push(xmlElementToMarkdown(child));
        } else if (child instanceof Y.XmlText) {
            lines.push(child.toString());
        }
    }

    return lines.join('\n');
}

function xmlElementToMarkdown(element: Y.XmlElement): string {
    const tag = element.nodeName;
    const content = element.toArray().map(child => {
        if (child instanceof Y.XmlElement) return xmlElementToMarkdown(child);
        if (child instanceof Y.XmlText) return child.toString();
        return '';
    }).join('');

    switch (tag) {
        case 'heading': {
            const level = element.getAttribute('level') || 1;
            return '#'.repeat(Number(level)) + ' ' + content;
        }
        case 'paragraph':
            return content + '\n';
        case 'bulletList':
            return content;
        case 'listItem':
            return '- ' + content;
        case 'codeBlock':
            return '```\n' + content + '\n```';
        case 'blockquote':
            return '> ' + content;
        default:
            return content;
    }
}

function downloadFile(filename: string, content: string | Blob, mimeType: string): void {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

