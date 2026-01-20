/**
 * Markdown Table Parser
 * 
 * Converts markdown table syntax into TipTap table node structure.
 * Used by AI menu to properly render tables instead of plain text.
 */

import type { JSONContent } from '@tiptap/react';

/**
 * Parses markdown table syntax into TipTap table node structure
 * 
 * @param markdown - Markdown table string like "| Header1 | Header2 |\n|---|---|\n| Cell1 | Cell2 |"
 * @returns TipTap-compatible JSONContent for table, or plain text node if parsing fails
 * 
 * @example
 * parseMarkdownTable("| Name | Age |\n|---|---|\n| John | 25 |")
 * // Returns: { type: 'table', content: [...] }
 */
export function parseMarkdownTable(markdown: string): JSONContent {
    try {
        const lines = markdown.trim().split('\n').map(line => line.trim());

        // Need at least 3 lines: header, separator, one data row
        if (lines.length < 3) {
            return createFallbackContent(markdown);
        }

        // Parse header row
        const headerCells = parseTableRow(lines[0]);
        if (headerCells.length === 0) {
            return createFallbackContent(markdown);
        }

        // Validate separator row (should be like |---|---|)
        const separatorRow = lines[1];
        if (!isSeparatorRow(separatorRow)) {
            return createFallbackContent(markdown);
        }

        // Parse data rows
        const dataRows: string[][] = [];
        for (let i = 2; i < lines.length; i++) {
            const cells = parseTableRow(lines[i]);
            if (cells.length > 0) {
                dataRows.push(cells);
            }
        }

        // Build TipTap table structure
        const tableContent: JSONContent[] = [];

        // Header row with tableHeader cells
        tableContent.push({
            type: 'tableRow',
            content: headerCells.map(cell => ({
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: cell }] }],
            })),
        });

        // Data rows with tableCell cells
        for (const row of dataRows) {
            // Pad or trim row to match header column count
            const paddedRow = [...row];
            while (paddedRow.length < headerCells.length) {
                paddedRow.push('');
            }

            tableContent.push({
                type: 'tableRow',
                content: paddedRow.slice(0, headerCells.length).map(cell => ({
                    type: 'tableCell',
                    content: [{ type: 'paragraph', content: cell ? [{ type: 'text', text: cell }] : [] }],
                })),
            });
        }

        return {
            type: 'table',
            content: tableContent,
        };
    } catch (error) {
        console.warn('[markdownTableParser] Failed to parse table:', error);
        return createFallbackContent(markdown);
    }
}

/**
 * Parse a table row into an array of cell values
 */
function parseTableRow(row: string): string[] {
    // Remove leading/trailing pipes and split
    const trimmed = row.replace(/^\||\|$/g, '');
    return trimmed.split('|').map(cell => cell.trim());
}

/**
 * Check if a line is a separator row (e.g., |---|---|)
 */
function isSeparatorRow(row: string): boolean {
    // Should contain only |, -, :, and whitespace
    return /^\|?[\s\-:]+(\|[\s\-:]+)+\|?$/.test(row);
}

/**
 * Creates fallback content when table parsing fails
 * Returns the original text as a paragraph
 */
function createFallbackContent(text: string): JSONContent {
    return {
        type: 'paragraph',
        content: [{ type: 'text', text }],
    };
}

/**
 * Checks if a string looks like a markdown table
 */
export function looksLikeMarkdownTable(text: string): boolean {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return false;

    // Check if first line has pipes
    if (!lines[0].includes('|')) return false;

    // Check if second line is a separator
    return isSeparatorRow(lines[1]);
}
