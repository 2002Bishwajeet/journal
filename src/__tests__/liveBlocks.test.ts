import { describe, it, expect } from 'vitest';
import { liveBlockKind, svgDataUri } from '@/lib/liveBlocks';

describe('liveBlockKind', () => {
  it('should recognise mermaid and svg languages', () => {
    expect(liveBlockKind('mermaid')).toBe('mermaid');
    expect(liveBlockKind('svg')).toBe('svg');
  });

  it('should ignore case and surrounding whitespace', () => {
    expect(liveBlockKind('Mermaid')).toBe('mermaid');
    expect(liveBlockKind(' SVG ')).toBe('svg');
  });

  it('should return null for other or missing languages', () => {
    expect(liveBlockKind('js')).toBeNull();
    expect(liveBlockKind('html')).toBeNull();
    expect(liveBlockKind('')).toBeNull();
    expect(liveBlockKind(null)).toBeNull();
  });
});

describe('svgDataUri', () => {
  it('should prefix the encoded source with the svg data URI header', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    expect(svgDataUri(source)).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
  });

  it('should not leave raw markup characters in the URI', () => {
    const uri = svgDataUri('<svg onload="alert(1)"></svg>');
    expect(uri).not.toMatch(/[<>"]/);
  });
});
