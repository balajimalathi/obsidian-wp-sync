import { describe, expect, it } from 'vitest';
import {
  buildCrawlPathIndex,
  resolvePublicPathForSlug,
} from './siteReconciler.js';

describe('resolvePublicPathForSlug', () => {
  const crawlBySlug = buildCrawlPathIndex([
    '/blog/mcp-server-for-image-generation',
    '/alternatives/creatomate',
    '/privacy',
  ]);

  it('maps posts to /blog/<slug>', () => {
    expect(
      resolvePublicPathForSlug('mcp-server-for-image-generation', 'post', crawlBySlug),
    ).toBe('/blog/mcp-server-for-image-generation');
  });

  it('maps *-alternative pages onto /alternatives/<base>', () => {
    expect(resolvePublicPathForSlug('creatomate-alternative', 'page', crawlBySlug)).toBe(
      '/alternatives/creatomate',
    );
  });

  it('maps exact page slug hits', () => {
    expect(resolvePublicPathForSlug('privacy', 'page', crawlBySlug)).toBe('/privacy');
  });
});
