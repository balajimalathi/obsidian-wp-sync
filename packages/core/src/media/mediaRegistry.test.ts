import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { siteAssetsImagesDir } from '../vault/paths.js';
import {
  buildUploadFilename,
  categoryFromVaultPath,
  findDuplicateImageGroups,
  upsertLocalImage,
} from './mediaRegistry.js';

const SITE = 'jsontoimg';

async function tempVault(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'wp-sync-media-'));
}

describe('mediaRegistry', () => {
  it('derives category from vault path', () => {
    expect(categoryFromVaultPath('sites/jsontoimg/assets/images/seo/hero.png')).toBe('seo');
    expect(categoryFromVaultPath('assets/images/seo/hero.png')).toBe('seo');
  });

  it('builds upload filename with category and hash', () => {
    expect(buildUploadFilename('SEO Tools', 'my-post', 'abcdef123456', '.PNG')).toBe(
      'seo-tools--my-post-abcdef12.png',
    );
  });

  it('detects duplicate image hashes', async () => {
    const vault = await tempVault();
    const images = siteAssetsImagesDir(SITE);
    const a = path.join(vault, images, 'seo');
    const b = path.join(vault, images, 'blog');
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    const bytes = Buffer.from('identical-bytes');
    await writeFile(path.join(a, 'one.png'), bytes);
    await writeFile(path.join(b, 'two.png'), bytes);
    const groups = await findDuplicateImageGroups(vault, SITE);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.duplicatePaths).toHaveLength(1);
  });

  it('registers a local image by sha256 once', async () => {
    const vault = await tempVault();
    const rel = `${siteAssetsImagesDir(SITE)}/seo/hero.png`;
    await mkdir(path.dirname(path.join(vault, rel)), { recursive: true });
    await writeFile(path.join(vault, rel), Buffer.from('hero'));
    const first = await upsertLocalImage(vault, SITE, rel);
    const second = await upsertLocalImage(vault, SITE, rel, first.registry);
    expect(first.entry.sha256).toBe(second.entry.sha256);
    expect(Object.keys(second.registry.entries)).toHaveLength(1);
  });
});
