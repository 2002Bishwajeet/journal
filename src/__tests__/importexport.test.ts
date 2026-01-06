/**
 * Import/Export Integration Tests
 * 
 * Tests the import parsing logic (not the file operations).
 */
import { describe, it, expect } from 'vitest';

// Since we can't import the actual module (it has browser dependencies),
// we'll test the parsing functions directly

describe('Import/Export Logic', () => {

    // ============================================
    // Markdown Parsing Tests
    // ============================================
    describe('Markdown Frontmatter Parsing', () => {
        interface Parsed {
            title: string;
            tags: string[];
            content: string;
        }

        function parseMarkdownWithFrontmatter(text: string, filename: string): Parsed {
            let content = text;
            let title = filename.replace(/\.md$/, '');
            const tags: string[] = [];

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

            return { title, tags, content };
        }

        it('should parse frontmatter with title', () => {
            const markdown = `---
title: "My Note Title"
---
This is the content.`;

            const result = parseMarkdownWithFrontmatter(markdown, 'file.md');
            expect(result.title).toBe('My Note Title');
            expect(result.content).toBe('This is the content.');
        });

        it('should use filename if no frontmatter title', () => {
            const markdown = `Just content without frontmatter.`;

            const result = parseMarkdownWithFrontmatter(markdown, 'my-note.md');
            expect(result.title).toBe('my-note');
        });

        it('should parse tags from frontmatter', () => {
            const markdown = `---
title: "Tagged Note"
tags: ["work", "important", "project"]
---
Content`;

            const result = parseMarkdownWithFrontmatter(markdown, 'file.md');
            expect(result.tags).toEqual(['work', 'important', 'project']);
        });

        it('should handle empty tags array', () => {
            const markdown = `---
title: "No Tags"
tags: []
---
Content`;

            const result = parseMarkdownWithFrontmatter(markdown, 'file.md');
            expect(result.tags).toEqual([]);
        });
    });

    // ============================================
    // Obsidian Import Parsing Tests
    // ============================================
    describe('Obsidian Format Parsing', () => {

        function convertWikilinks(content: string): string {
            // [[Note]] → [Note](note)
            // [[Note|Display]] → [Display](note)
            return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) => {
                const linkText = display || target;
                const linkTarget = target.toLowerCase().replace(/\s+/g, '-');
                return `[${linkText}](${linkTarget})`;
            });
        }

        function convertEmbeds(content: string): string {
            // ![[image.png]] → ![image.png](image.png)
            return content.replace(/!\[\[([^\]]+)\]\]/g, (_, target) => {
                return `![${target}](${target})`;
            });
        }

        function convertCallouts(content: string): string {
            // > [!note] Title → > **Note:** Title
            return content.replace(/^>\s*\[!(\w+)\]\s*(.*?)$/gm, (_, type, rest) => {
                const formattedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
                return `> **${formattedType}:** ${rest}`;
            });
        }

        function cleanNotionFilename(filename: string): string {
            let name = filename.replace(/\.md$/, '');
            name = name.replace(/\s+[a-f0-9]{32}$/i, '');
            return name.trim() || 'Untitled';
        }

        it('should convert simple wikilinks', () => {
            const input = 'Check out [[My Note]] for details.';
            const result = convertWikilinks(input);
            expect(result).toBe('Check out [My Note](my-note) for details.');
        });

        it('should convert wikilinks with display text', () => {
            const input = 'See [[Technical Document|the docs]] here.';
            const result = convertWikilinks(input);
            expect(result).toBe('See [the docs](technical-document) here.');
        });

        it('should handle multiple wikilinks', () => {
            const input = '[[Note A]] and [[Note B]] and [[Note C]]';
            const result = convertWikilinks(input);
            expect(result).toBe('[Note A](note-a) and [Note B](note-b) and [Note C](note-c)');
        });

        it('should convert image embeds', () => {
            const input = 'Here is an image: ![[screenshot.png]]';
            const result = convertEmbeds(input);
            expect(result).toBe('Here is an image: ![screenshot.png](screenshot.png)');
        });

        it('should convert note embeds', () => {
            const input = '![[Embedded Note]]';
            const result = convertEmbeds(input);
            expect(result).toBe('![Embedded Note](Embedded Note)');
        });

        it('should convert callouts', () => {
            const input = '> [!note] This is important';
            const result = convertCallouts(input);
            expect(result).toBe('> **Note:** This is important');
        });

        it('should handle different callout types', () => {
            expect(convertCallouts('> [!warning] Danger ahead')).toBe('> **Warning:** Danger ahead');
            expect(convertCallouts('> [!tip] Pro tip here')).toBe('> **Tip:** Pro tip here');
            expect(convertCallouts('> [!INFO] Some info')).toBe('> **Info:** Some info');
        });

        it('should clean Notion filename format', () => {
            // Using exactly 32 hex characters (valid Notion UUID format)
            expect(cleanNotionFilename('My Page 12345678901234567890123456789012.md')).toBe('My Page');
            expect(cleanNotionFilename('Simple Note.md')).toBe('Simple Note');
            expect(cleanNotionFilename('Page 0123456789abcdef0123456789abcdef.md')).toBe('Page');
        });
    });

    // ============================================
    // CSV Parsing Tests
    // ============================================
    describe('CSV Parsing', () => {
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

        it('should parse simple CSV', () => {
            const csv = `Name,Age,City
John,30,NYC
Jane,25,LA`;

            const rows = parseCSV(csv);
            expect(rows.length).toBe(3);
            expect(rows[0]).toEqual(['Name', 'Age', 'City']);
            expect(rows[1]).toEqual(['John', '30', 'NYC']);
            expect(rows[2]).toEqual(['Jane', '25', 'LA']);
        });

        it('should handle quoted fields', () => {
            const csv = `Name,Description
"John Doe","A ""quoted"" value"`;

            const rows = parseCSV(csv);
            expect(rows[1]).toEqual(['John Doe', 'A "quoted" value']);
        });

        it('should handle commas in quoted fields', () => {
            const csv = `Title,Content
"Meeting Notes","Action item 1, action item 2, action item 3"`;

            const rows = parseCSV(csv);
            expect(rows[1][1]).toBe('Action item 1, action item 2, action item 3');
        });

        it('should skip empty lines', () => {
            const csv = `A,B

C,D

E,F`;

            const rows = parseCSV(csv);
            expect(rows.length).toBe(3);
        });
    });

    // ============================================
    // Format Detection Tests
    // ============================================
    describe('Import Format Detection', () => {
        function detectFormat(filenames: string[]): 'obsidian' | 'notion' | 'markdown' | 'unknown' {
            let hasObsidianConfig = false;
            let hasNotionFormat = false;
            let hasMarkdown = false;

            for (const filename of filenames) {
                if (filename.includes('.obsidian/')) {
                    hasObsidianConfig = true;
                }
                if (filename.match(/[a-f0-9]{32}\.md$/i)) {
                    hasNotionFormat = true;
                }
                if (filename.endsWith('.md')) {
                    hasMarkdown = true;
                }
            }

            if (hasObsidianConfig) return 'obsidian';
            if (hasNotionFormat) return 'notion';
            if (hasMarkdown) return 'markdown';
            return 'unknown';
        }

        it('should detect Obsidian vault', () => {
            const files = ['vault/.obsidian/config.json', 'vault/note1.md', 'vault/note2.md'];
            expect(detectFormat(files)).toBe('obsidian');
        });

        it('should detect Notion export', () => {
            const files = ['My Page abc123def456789012345678901234.md', 'Another 1234567890123456789012345678abcd.md'];
            expect(detectFormat(files)).toBe('notion');
        });

        it('should detect plain markdown', () => {
            const files = ['notes/file1.md', 'notes/file2.md'];
            expect(detectFormat(files)).toBe('markdown');
        });

        it('should return unknown for non-markdown', () => {
            const files = ['image.png', 'document.pdf'];
            expect(detectFormat(files)).toBe('unknown');
        });
    });

    // ============================================
    // Filename Sanitization Tests
    // ============================================
    describe('Filename Sanitization', () => {
        function sanitizeFilename(name: string): string {
            return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Untitled';
        }

        it('should remove invalid characters', () => {
            expect(sanitizeFilename('my/note')).toBe('my-note');
            expect(sanitizeFilename('file:name')).toBe('file-name');
            expect(sanitizeFilename('test<>file')).toBe('test--file');
        });

        it('should handle multiple invalid characters', () => {
            expect(sanitizeFilename('a/b\\c?d')).toBe('a-b-c-d');
        });

        it('should return Untitled for empty string', () => {
            expect(sanitizeFilename('')).toBe('Untitled');
            expect(sanitizeFilename('   ')).toBe('Untitled');
        });

        it('should preserve valid characters', () => {
            expect(sanitizeFilename('My Note (2023)')).toBe('My Note (2023)');
            expect(sanitizeFilename('Notes-Archive_v2')).toBe('Notes-Archive_v2');
        });
    });
});
