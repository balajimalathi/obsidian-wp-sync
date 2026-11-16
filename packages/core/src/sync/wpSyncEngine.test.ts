import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultFrontmatter, serializeVaultNote } from '../schema/frontmatter.js';
import type { WpRestClient } from '../wp/wpRestClient.js';
import type { WpMediaItem, WpPage, WpPost, WpTerm } from '../wp/types.js';
import { pathExists } from '../vault/fs.js';
import {
  clusterNotePath,
  pageNotePath,
  pillarIndexPath,
  siteArchiveDir,
  siteAssetsImagesDir,
} from '../vault/paths.js';
import { pullFromWordPress, pushToWordPress } from './wpSyncEngine.js';

const SITE = 'jsontoimg';

async function tempVault(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'wp-sync-engine-'));
}

function mockClient(overrides: Partial<WpRestClient> = {}): WpRestClient {
  const posts: WpPost[] = [
    {
      id: 10,
      slug: 'pillar',
      status: 'publish',
      type: 'post',
      title: { rendered: 'Pillar', raw: 'Pillar' },
      content: { rendered: '<p>P</p>', raw: '<p>P</p>' },
      link: 'https://example.com/pillar',
      categories: [1],
      tags: [],
      featured_media: 0,
    },
  ];
  const pages: WpPage[] = [];
  const categories: WpTerm[] = [{ id: 1, name: 'SEO', slug: 'seo' }];
  const media: WpMediaItem[] = [];

  return {
    listPosts: async () => posts,
    listPages: async () => pages,
    listCategories: async () => categories,
    listTags: async () => [],
    listMedia: async () => media,
    uploadMedia: async () => ({
      id: 99,
      source_url: 'https://example.com/wp-content/uploads/x.png',
      slug: 'x',
      title: 'x',
      mime_type: 'image/png',
    }),
    upsertPost: async (input) => ({
      id: input.id ?? 11,
      slug: input.slug,
      status: input.status,
      type: 'post',
      title: { rendered: input.title, raw: input.title },
      content: { rendered: input.content, raw: input.content },
      link: `https://example.com/${input.slug}`,
      categories: input.categories ?? [],
      tags: [],
      featured_media: input.featured_media ?? 0,
    }),
    upsertPage: async (input) => ({
      id: input.id ?? 12,
      slug: input.slug,
      status: input.status,
      type: 'page',
      title: { rendered: input.title, raw: input.title },
      content: { rendered: input.content, raw: input.content },
      link: `https://example.com/${input.slug}`,
      featured_media: input.featured_media ?? 0,
    }),
    ...overrides,
  };
}

describe('wpSyncEngine', () => {
  it('pulls posts into pillars and archives missing remote ids', async () => {
    const vault = await tempVault();
    const featured = `${siteAssetsImagesDir(SITE)}/seo/hero.png`;
    const orphanPath = clusterNotePath(SITE, 'seo', 'gone');
    await mkdir(path.dirname(path.join(vault, orphanPath)), { recursive: true });
    await mkdir(path.dirname(path.join(vault, featured)), { recursive: true });
    await writeFile(path.join(vault, featured), Buffer.from('img'));

    const orphan = serializeVaultNote(
      createDefaultFrontmatter({
        title: 'Gone',
        source: 'wordpress',
        role: 'cluster',
        slug: 'gone',
        url_path: '/gone',
        wp_id: 999,
        wp_type: 'post',
        status: 'publish',
        pillar: 'seo',
        featured_image: featured,
      }),
      'orphan\n',
    );
    await writeFile(path.join(vault, orphanPath), orphan);

    const pillar = serializeVaultNote(
      createDefaultFrontmatter({
        title: 'Old Pillar',
        source: 'wordpress',
        role: 'pillar',
        slug: 'old',
        url_path: '/old',
        wp_id: 10,
        wp_type: 'post',
        status: 'publish',
        pillar: 'seo',
        featured_image: featured,
      }),
      'old\n',
    );
    await writeFile(path.join(vault, pillarIndexPath(SITE, 'seo')), pillar);

    const result = await pullFromWordPress({
      vaultRoot: vault,
      siteId: SITE,
      client: mockClient(),
      dryRun: false,
    });

    expect(result.archived).toContain(orphanPath);
    expect(
      await pathExists(path.join(vault, siteArchiveDir(SITE), 'pillars/seo/gone.md')),
    ).toBe(true);
    expect(await pathExists(path.join(vault, pillarIndexPath(SITE, 'seo')))).toBe(true);
  });

  it('push dry-run validates and reports without calling upsert when invalid', async () => {
    const vault = await tempVault();
    const notePath = pageNotePath(SITE, 'contact');
    await mkdir(path.dirname(path.join(vault, notePath)), { recursive: true });
    const page = serializeVaultNote(
      createDefaultFrontmatter({
        title: 'Contact',
        source: 'wordpress',
        role: 'page',
        slug: 'contact',
        url_path: '/contact',
        wp_type: 'page',
        status: 'publish',
      }),
      'Body\n',
    );
    await writeFile(path.join(vault, notePath), page);

    await expect(
      pushToWordPress({
        vaultRoot: vault,
        siteId: SITE,
        client: mockClient(),
        dryRun: true,
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('pushes a valid page with featured image', async () => {
    const vault = await tempVault();
    const featured = `${siteAssetsImagesDir(SITE)}/general/hero.png`;
    const notePath = pageNotePath(SITE, 'contact');
    await mkdir(path.dirname(path.join(vault, notePath)), { recursive: true });
    await mkdir(path.dirname(path.join(vault, featured)), { recursive: true });
    await writeFile(path.join(vault, featured), Buffer.from('hero'));

    const page = serializeVaultNote(
      createDefaultFrontmatter({
        title: 'Contact',
        source: 'wordpress',
        role: 'page',
        slug: 'contact',
        url_path: '/contact',
        wp_type: 'page',
        status: 'draft',
        featured_image: featured,
      }),
      'Hello [[contact]]\n',
    );
    await writeFile(path.join(vault, notePath), page);

    let uploaded = false;
    const client = mockClient({
      uploadMedia: async () => {
        uploaded = true;
        return {
          id: 55,
          source_url: 'https://example.com/wp-content/uploads/general--contact-abc.png',
          slug: 'hero',
          title: 'hero',
          mime_type: 'image/png',
        };
      },
    });

    const result = await pushToWordPress({
      vaultRoot: vault,
      siteId: SITE,
      client,
      dryRun: false,
    });
    expect(uploaded).toBe(true);
    expect(result.pushed).toContain(notePath);
    expect(result.uploadedMedia).toContain(featured);
  });
});
