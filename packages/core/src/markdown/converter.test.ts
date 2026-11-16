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
