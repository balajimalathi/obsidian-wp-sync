import { describe, expect, it } from 'vitest';
import {
  extractImagePaths,
  extractWikilinkTargets,
  htmlToMarkdown,
  markdownToHtml,
  rewriteWikilinksToUrls,
} from './converter.js';

describe('converter', () => {
  it('converts html to markdown and back', () => {
    const md = htmlToMarkdown('<h1>Hello</h1><p>World</p>');
    expect(md).toContain('# Hello');
    expect(md).toContain('World');
    const html = markdownToHtml(md);
    expect(html.toLowerCase()).toContain('hello');
  });

  it('converts HTML tables to GFM pipe tables', () => {
    const html = `<table><thead><tr><th></th><th>jsontoimg</th><th>DynaPictures</th></tr></thead><tbody><tr><td>Buyer</td><td>Engineer + designer split</td><td>Marketer + no-code first</td></tr><tr><td>PPTX</td><td>No</td><td>Yes</td></tr></tbody></table>`;
    const md = htmlToMarkdown(html);
    expect(md).toMatch(/\|.*jsontoimg.*\|.*DynaPictures.*\|/);
    expect(md).toMatch(/\|[-: |]+\|/);
    expect(md).toMatch(/\|.*Buyer.*\|.*Engineer/);
    expect(md).toMatch(/\|.*PPTX.*\|.*No.*\|.*Yes.*\|/);
    // Must not flatten to a bare vertical list of cells
    expect(md.trim().split('\n')[0]).toContain('|');
  });

  it('extracts wikilinks and images', () => {
    const md = 'See [[pillars/seo/index|SEO]] and ![[assets/images/seo/a.png]]';
    expect(extractWikilinkTargets(md)).toContain('pillars/seo/index');
    expect(extractImagePaths(md)).toContain('assets/images/seo/a.png');
  });

  it('rewrites wikilinks to urls', () => {
    const out = rewriteWikilinksToUrls('Go [[hello]]', (t) =>
      t === 'hello' ? '/blog/hello' : null,
    );
    expect(out).toBe('Go [hello](/blog/hello)');
  });
});
