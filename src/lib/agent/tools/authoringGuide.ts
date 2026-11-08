/**
 * The authoring reference (#519), mcp/AUTHORING.md, served in sections (#1004). The file stays
 * the one source: it is inlined at build time so the packaged server carries it, and cut on
 * its headings here. mcpServer.test.ts checks that the index and sections cover every line.
 */
import GUIDE from '../../../../mcp/AUTHORING.md?raw';

/** The text from the heading `from` up to the heading `to` (or the end), trimmed. */
function part(from: string, to?: string): string {
    const at = (heading: string) => {
        const i = GUIDE.indexOf(`\n${heading}\n`);
        if (i < 0) throw new Error(`AUTHORING.md has no heading ${heading}`);
        return i + 1;
    };
    return GUIDE.slice(at(from), to ? at(to) : undefined).trim();
}

const LIVE_BLOCKS = part('## Live blocks', '### `mermaid`');
const CHECKLIST = part('### Before you finish', '## Examples');

/** Each section's text, and the line the index gives it. */
const SECTIONS = {
    native: {
        about: 'Text, lists, tables, callouts, toggles, math, footnotes, images and galleries, covers, note links, link previews.',
        text: part('## Native blocks', '## Editing one block'),
    },
    editing: {
        about: 'Changing part of a note: get_note outline and blocks, and every edit_block op.',
        text: part('## Editing one block', '## Live blocks'),
    },
    'mermaid-svg': {
        about: 'Live blocks in general (ids, the Code / Preview toggle), mermaid diagrams and svg drawings.',
        text: part('## Live blocks', '### How an `html` block works'),
    },
    html: {
        about: 'How an html block runs: what it can load and do, its size, `wide`, and journal.storage. Ends with the design checklist.',
        text: [LIVE_BLOCKS, part('### How an `html` block works', '### How a `react` block works'), CHECKLIST].join('\n\n'),
    },
    react: {
        about: 'How a react block runs: imports and libraries, the journal-ui kit, Tailwind, journal.storage. Ends with the design checklist.',
        text: [
            LIVE_BLOCKS,
            part('### Saved state: `journal.storage`', '### How a `react` block works'),
            part('### How a `react` block works', '#### Charts in a `react` block'),
            CHECKLIST,
        ].join('\n\n'),
    },
    charts: {
        about: 'Recharts in a react block: theme colours, axes, tooltips, margins.',
        text: part('#### Charts in a `react` block', '## Designing a live block'),
    },
    design: {
        about: 'Designing a live block to match the note: the rules, layout and `wide`, theme variables, chart palette.',
        text: part('## Designing a live block', '## Examples'),
    },
    examples: {
        about: 'Complete examples: a dashboard, a calculator, a chart, a mermaid diagram.',
        text: part('## Examples'),
    },
};

export type GuideSection = keyof typeof SECTIONS;
export const GUIDE_SECTION_IDS = Object.keys(SECTIONS) as [GuideSection, ...GuideSection[]];

/** What get_authoring_guide returns with no section: the guide's introduction and a line per section. */
export const GUIDE_INDEX = [
    GUIDE.slice(0, GUIDE.indexOf('\n## Native blocks\n')).trim(),
    'Call get_authoring_guide with one section for its reference:',
    GUIDE_SECTION_IDS.map((id) => `- \`${id}\`: ${SECTIONS[id].about}`).join('\n'),
].join('\n\n');

export function guideSection(id: GuideSection): string {
    return SECTIONS[id].text;
}
