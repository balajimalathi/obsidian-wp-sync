import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathExists } from '../vault/fs.js';
import { siteRoot } from '../vault/paths.js';
import {
  getSite,
  listSites,
  removeSite,
  upsertSite,
} from './registry.js';

async function tempVault(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'wp-sync-sites-'));
}

describe('sites registry', () => {
  it('upserts, lists, and removes sites without deleting files by default', async () => {
    const vault = await tempVault();
    await upsertSite(vault, {
      id: 'jsontoimg',
      name: 'JSON to Image',
      publicSiteUrl: 'https://jsontoimg.com',
      wpApiUrl: 'https://blog.skndan.com/jsontoimg',
    });

    expect(await listSites(vault)).toHaveLength(1);
    expect(await getSite(vault, 'jsontoimg')).toMatchObject({ id: 'jsontoimg' });
    expect(await pathExists(path.join(vault, siteRoot('jsontoimg'), 'pillars'))).toBe(true);

    await removeSite(vault, 'jsontoimg');
    expect(await listSites(vault)).toHaveLength(0);
    expect(await pathExists(path.join(vault, siteRoot('jsontoimg'), 'pillars'))).toBe(true);
  });

  it('rejects invalid site ids', async () => {
    const vault = await tempVault();
    await expect(
      upsertSite(vault, {
        id: 'Bad_ID',
        name: 'Bad',
        publicSiteUrl: 'https://example.com',
        wpApiUrl: 'https://wp.example.com',
      }),
    ).rejects.toThrow(/Invalid site id/);
  });
});
