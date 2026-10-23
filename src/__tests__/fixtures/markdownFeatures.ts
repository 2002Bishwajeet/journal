/** One markdown sample per documented editor feature (#519), shared by the MCP and import/export round trips. */
export const FEATURES: Record<string, string> = {
    headings: '# Title\n\n## Section\n\n### Subsection\n\nA paragraph with **bold**, *italic*, ~~strike~~, `code` and a [link](https://journal.cloudx.run).',
    callout: '> [!warning]\n> Back up the database first.\n>\n> Then run the migration.',
    toggle: '<details>\n<summary>Full error log</summary>\n\nThe body, hidden until the reader opens it.\n\n</details>',
    'task list': '- [ ] Book the train\n- [x] Pack',
    'inline math': 'The energy is $E = mc^2$.',
    'block math': '$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$',
    footnotes: 'Journal syncs through Homebase.[^1] It works offline.[^2]\n\n[^1]: Your own identity.\n[^2]: Changes sync later.',
    'link preview': 'Read this:\n\n<https://journal.cloudx.run/blog><!-- preview -->',
    gallery: '<div data-gallery="row">\n\n![Beach](https://e.com/beach.png) <img src="https://e.com/pier.png" alt="Pier" data-caption="The pier"> ![Dunes](https://e.com/dunes.png)\n\n</div>',
    table: '| Day | Distance |\n| --- | --- |\n| Mon | 5 km |\n| Wed | 8 km |',
    'mermaid block': '```mermaid id=r3l5\nflowchart LR\n  A[Write] --> B{Tests pass?}\n  B -- yes --> C[Merge]\n```',
    'svg block': '```svg id=c1rc\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#718968"/></svg>\n```',
    'html block': '```html id=t1p5\n<label>Bill <input id="bill" type="number" value="40"></label>\n<script>journal.storage.get("bill").then((v) => v && (bill.value = v));</script>\n```',
    'wide react block': "```react wide id=w1d3\nfunction App() {\n  return <p>A wide block</p>;\n}\n```",
    'react block': "```react id=d4sh\nimport { Heart } from 'lucide-react';\n\nfunction App() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}><Heart className=\"size-4\" /> {count}</button>;\n}\n```",
};
