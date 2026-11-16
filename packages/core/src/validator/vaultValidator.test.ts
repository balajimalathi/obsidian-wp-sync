import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeVaultNote, createDefaultFrontmatter } from '../schema/frontmatter.js';
import {
  pageNotePath,
  pillarIndexPath,
  siteAssetsImagesDir,
  siteAssetsPlaceholdersDir,
  siteStaticDir,
  clusterNotePath,
} from '../vault/paths.js';
import { validateVault } from './vaultValidator.js';

const SITE = 'jsontoimg';

async function tempVault(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'wp-sync-val-'));
}

describe('vaultValidator', () => {
  it('blocks static notes and missing featured images', async () => {
    const vault = await tempVault();
    await mkdir(path.join(vault, siteStaticDir(SITE), 'about'), { recursive: true });
    await mkdir(path.dirname(path.join(vault, pageNotePath(SITE, 'contact'))), {
      recursive: true,
    });

    const staticNote = serializeVaultNote(
      createDefaultFrontmatter({
        title: 'About',
        source: 'static',
        role: 'static',
        slug: 'about',
        url_path: '/about',
        status: 'publish',
      }),
      'Static body\n',
    );
    await writeFile(path.join(vault, siteStaticDir(SITE), 'about/index.md'), staticNote);

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
      'Contact body\n',
    );
    await writeFile(path.join(vault, pageNotePath(SITE, 'contact')), page);

    const issues = await validateVault(vault, SITE);
    expect(issues.some((i) => i.code === 'static_source')).toBe(true);
    expect(issues.some((i) => i.code === 'missing_featured_image')).toBe(true);
  });

  it('blocks placeholder images', async () => {
    const vault = await tempVault();
    const featured = `${siteAssetsPlaceholdersDir(SITE)}/hero.png`;
    await mkdir(path.dirname(path.join(vault, pageNotePath(SITE, 'contact'))), {
      recursive: true,
    });
    await mkdir(path.dirname(path.join(vault, featured)), { recursive: true });
    await writeFile(path.join(vault, featured), Buffer.from('x'));

    const page = serializeVaultNote(
      createDefaultFrontmatter({
        title: 'Contact',
        source: 'wordpress',
        role: 'page',
        slug: 'contact',
        url_path: '/contact',
        wp_type: 'page',
        status: 'publish',
        featured_image: featured,
      }),
      'Body\n',
    );
    await writeFile(path.join(vault, pageNotePath(SITE, 'contact')), page);

    const issues = await validateVault(vault, SITE);
    expect(issues.some((i) => i.code === 'placeholder_featured_image')).toBe(true);
  });

  it('requires pillar index for cluster posts', async () => {
    const vault = await tempVault();
    const featured = `${siteAssetsImagesDir(SITE)}/seo/hero.png`;
    const clusterPath = clusterNotePath(SITE, 'seo', 'cluster');
    await mkdir(path.dirname(path.join(vault, clusterPath)), { recursive: true });
    await mkdir(path.dirname(path.join(vault, featured)), { recursive: true });
    await writeFile(path.join(vault, featured), Buffer.from('x'));

    const cluster = serializeVaultNote(
      createDefaultFrontmatter({
        title: 'Cluster',
        source: 'wordpress',
        role: 'cluster',
        slug: 'cluster',
        url_path: '/cluster',
        wp_type: 'post',
        status: 'draft',
        pillar: 'seo',
        featured_image: featured,
      }),
      'Body\n',
    );
    await writeFile(path.join(vault, clusterPath), cluster);

    const issues = await validateVault(vault, SITE);
    expect(issues.some((i) => i.code === 'missing_pillar_index')).toBe(true);
    expect(issues.some((i) => i.message.includes(pillarIndexPath(SITE, 'seo')))).toBe(true);
  });
});
