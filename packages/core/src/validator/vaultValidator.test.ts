import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeVaultNote, createDefaultFrontmatter } from '../schema/frontmatter.js';
import { validateVault } from './vaultValidator.js';

async function tempVault(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'wp-sync-val-'));
}

describe('vaultValidator', () => {
  it('blocks static notes and missing featured images', async () => {
    const vault = await tempVault();
    await mkdir(path.join(vault, 'static/about'), { recursive: true });
    await mkdir(path.join(vault, 'pages'), { recursive: true });

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
    await writeFile(path.join(vault, 'static/about/index.md'), staticNote);

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
    await writeFile(path.join(vault, 'pages/contact.md'), page);

    const issues = await validateVault(vault);
    expect(issues.some((i) => i.code === 'static_source')).toBe(true);
    expect(issues.some((i) => i.code === 'missing_featured_image')).toBe(true);
  });

  it('blocks placeholder images', async () => {
    const vault = await tempVault();
    await mkdir(path.join(vault, 'pages'), { recursive: true });
    await mkdir(path.join(vault, 'assets/placeholders'), { recursive: true });
    await writeFile(path.join(vault, 'assets/placeholders/hero.png'), Buffer.from('x'));

    const page = serializeVaultNote(
      createDefaultFrontmatter({
        title: 'Contact',
        source: 'wordpress',
        role: 'page',
        slug: 'contact',
        url_path: '/contact',
        wp_type: 'page',
        status: 'publish',
        featured_image: 'assets/placeholders/hero.png',
      }),
      'Body\n',
    );
    await writeFile(path.join(vault, 'pages/contact.md'), page);

    const issues = await validateVault(vault);
    expect(issues.some((i) => i.code === 'placeholder_featured_image')).toBe(true);
  });

  it('requires pillar index for cluster posts', async () => {
    const vault = await tempVault();
    await mkdir(path.join(vault, 'pillars/seo'), { recursive: true });
    await mkdir(path.join(vault, 'assets/images/seo'), { recursive: true });
    await writeFile(path.join(vault, 'assets/images/seo/hero.png'), Buffer.from('x'));

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
        featured_image: 'assets/images/seo/hero.png',
      }),
      'Body\n',
    );
    await writeFile(path.join(vault, 'pillars/seo/cluster.md'), cluster);

    const issues = await validateVault(vault);
    expect(issues.some((i) => i.code === 'missing_pillar_index')).toBe(true);
  });
});
