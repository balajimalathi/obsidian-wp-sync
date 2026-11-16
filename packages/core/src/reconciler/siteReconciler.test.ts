import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathExists, readText } from '../vault/fs.js';
import { reconcileSite, type CrawlSnapshot } from './siteReconciler.js';
import type { WpPage, WpPost, WpTerm } from '../wp/types.js';

async function tempVault(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'wp-sync-rec-'));
}

describe('siteReconciler', () => {
  it('classifies wordpress vs static and migrates legacy routes', async () => {
    const vault = await tempVault();
    await mkdir(path.join(vault, 'jsontoimg'), { recursive: true });
    await writeFile(path.join(vault, 'jsontoimg/index.md'), '# JSON to Image\n');

    const snapshot: CrawlSnapshot = {
      site_url: 'https://example.com/',
      crawled_at: new Date().toISOString(),
      page_count: 3,
      pages: [
        {
          url: 'https://example.com/blog/hello',
          status: 'ok',
          title: 'Hello',
          markdown: 'Hello md',
          links: [],
          images: [],
        },
        {
          url: 'https://example.com/jsontoimg',
          status: 'ok',
          title: 'JSON to Image',
          markdown: 'tool page',
          links: [],
          images: [],
        },
        {
          url: 'https://example.com/extractdb',
          status: 'ok',
          title: 'Extract DB',
          markdown: 'extract',
          links: [],
          images: [],
        },
      ],
    };

    const posts: WpPost[] = [
      {
        id: 1,
        slug: 'hello',
        status: 'publish',
        type: 'post',
        title: { rendered: 'Hello', raw: 'Hello' },
        content: { rendered: '<p>Hi</p>', raw: '<p>Hi</p>' },
        link: 'https://example.com/blog/hello',
        categories: [5],
        tags: [],
        featured_media: 0,
      },
    ];
    const pages: WpPage[] = [
      {
        id: 2,
        slug: 'contact',
        status: 'publish',
        type: 'page',
        title: { rendered: 'Contact', raw: 'Contact' },
        content: { rendered: '<p>Contact</p>', raw: '<p>Contact</p>' },
        link: 'https://example.com/contact',
        featured_media: 0,
      },
    ];
    const categories: WpTerm[] = [{ id: 5, name: 'SEO', slug: 'seo' }];

    const inventory = await reconcileSite({
      vaultRoot: vault,
      siteUrl: 'https://example.com',
      snapshot,
      posts,
      pages,
      categories,
    });

    expect(inventory.wordpress.some((i) => i.slug === 'hello')).toBe(true);
    expect(inventory.wordpress.some((i) => i.slug === 'contact')).toBe(true);
    expect(inventory.static.some((i) => i.url_path.includes('jsontoimg'))).toBe(true);
    expect(inventory.static.some((i) => i.url_path.includes('extractdb'))).toBe(true);

    expect(await pathExists(path.join(vault, 'static/jsontoimg/index.md'))).toBe(true);
    expect(await pathExists(path.join(vault, 'pillars/seo/index.md'))).toBe(true);
    expect(await pathExists(path.join(vault, 'pages/contact.md'))).toBe(true);
    expect(await pathExists(path.join(vault, '.wp-sync/inventory.md'))).toBe(true);

    const invMd = await readText(path.join(vault, '.wp-sync/inventory.md'));
    expect(invMd).toContain('WordPress content');
    expect(invMd).toContain('Static content');
  });
});
