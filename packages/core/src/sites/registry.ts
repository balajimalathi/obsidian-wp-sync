import { z } from 'zod';
import { ensureDir, joinVault, pathExists, readText, writeText } from '../vault/fs.js';
import {
  GLOBAL_SITES_REGISTRY_FILE,
  PAGES_DIR,
  PILLARS_DIR,
  STATIC_DIR,
  assertSiteId,
  siteArchiveDir,
  siteAssetsImagesDir,
  siteAssetsPlaceholdersDir,
  sitePath,
  siteRoot,
  siteWpSyncDir,
} from '../vault/paths.js';

export const SiteRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  publicSiteUrl: z.string().url(),
  wpApiUrl: z.string().url(),
});

export type SiteRecord = z.infer<typeof SiteRecordSchema>;

export const SitesRegistrySchema = z.object({
  version: z.literal(1),
  sites: z.array(SiteRecordSchema),
});

export type SitesRegistry = z.infer<typeof SitesRegistrySchema>;

export function emptySitesRegistry(): SitesRegistry {
  return { version: 1, sites: [] };
}

export async function loadSitesRegistry(vaultRoot: string): Promise<SitesRegistry> {
  const file = joinVault(vaultRoot, GLOBAL_SITES_REGISTRY_FILE);
  if (!(await pathExists(file))) {
    return emptySitesRegistry();
  }
  const raw = JSON.parse(await readText(file)) as unknown;
  const parsed = SitesRegistrySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ${GLOBAL_SITES_REGISTRY_FILE}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function saveSitesRegistry(
  vaultRoot: string,
  registry: SitesRegistry,
): Promise<void> {
  const file = joinVault(vaultRoot, GLOBAL_SITES_REGISTRY_FILE);
  await writeText(file, JSON.stringify(registry, null, 2) + '\n');
}

export async function listSites(vaultRoot: string): Promise<SiteRecord[]> {
  return (await loadSitesRegistry(vaultRoot)).sites;
}

export async function getSite(vaultRoot: string, siteId: string): Promise<SiteRecord | null> {
  const id = assertSiteId(siteId);
  const sites = await listSites(vaultRoot);
  return sites.find((s) => s.id === id) ?? null;
}

export async function requireSite(vaultRoot: string, siteId: string): Promise<SiteRecord> {
  const site = await getSite(vaultRoot, siteId);
  if (!site) {
    throw new Error(
      `Unknown site "${siteId}". Add it in Obsidian Settings → WP Sync, or: wp-sync sites add --site ${siteId}`,
    );
  }
  return site;
}

export async function upsertSite(
  vaultRoot: string,
  input: SiteRecord,
): Promise<SitesRegistry> {
  const id = assertSiteId(input.id);
  const record = SiteRecordSchema.parse({ ...input, id });
  const registry = await loadSitesRegistry(vaultRoot);
  const idx = registry.sites.findIndex((s) => s.id === id);
  if (idx >= 0) {
    registry.sites[idx] = record;
  } else {
    registry.sites.push(record);
  }
  await saveSitesRegistry(vaultRoot, registry);
  await ensureSiteDirs(vaultRoot, id);
  return registry;
}

export async function removeSite(
  vaultRoot: string,
  siteId: string,
  options: { deleteFiles?: boolean } = {},
): Promise<SitesRegistry> {
  const id = assertSiteId(siteId);
  const registry = await loadSitesRegistry(vaultRoot);
  registry.sites = registry.sites.filter((s) => s.id !== id);
  await saveSitesRegistry(vaultRoot, registry);
  if (options.deleteFiles) {
    const { rm } = await import('node:fs/promises');
    const abs = joinVault(vaultRoot, siteRoot(id));
    if (await pathExists(abs)) {
      await rm(abs, { recursive: true, force: true });
    }
  }
  return registry;
}

export async function ensureSiteDirs(vaultRoot: string, siteId: string): Promise<void> {
  const id = assertSiteId(siteId);
  const dirs = [
    sitePath(id, PILLARS_DIR),
    sitePath(id, PAGES_DIR),
    sitePath(id, STATIC_DIR),
    siteAssetsImagesDir(id),
    siteAssetsPlaceholdersDir(id),
    siteArchiveDir(id),
    siteWpSyncDir(id),
    WP_SYNC_DIR_GLOBAL,
  ];
  for (const rel of dirs) {
    await ensureDir(joinVault(vaultRoot, rel));
  }
}

const WP_SYNC_DIR_GLOBAL = '.wp-sync';

async function isEmptyDir(dirPath: string): Promise<boolean> {
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dirPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

/** Move Phase-1 flat vault folders into sites/<id>/ and register the site. */
export async function migrateFlatVaultToSite(
  vaultRoot: string,
  site: SiteRecord,
): Promise<{ moved: string[] }> {
  const id = assertSiteId(site.id);
  // Register without creating content dirs first — empty shells would block rename.
  const registry = await loadSitesRegistry(vaultRoot);
  const record = SiteRecordSchema.parse({ ...site, id: assertSiteId(site.id) });
  const idx = registry.sites.findIndex((s) => s.id === id);
  if (idx >= 0) registry.sites[idx] = record;
  else registry.sites.push(record);
  await saveSitesRegistry(vaultRoot, registry);

  const { rename, rm } = await import('node:fs/promises');
  const pathMod = await import('node:path');
  const moved: string[] = [];
  const candidates = [
    'pillars',
    'pages',
    'static',
    'assets',
    '_archive',
    '.wp-sync/crawl-snapshot.json',
    '.wp-sync/media-registry.json',
    '.wp-sync/inventory.md',
    '.wp-sync/site-inventory.json',
  ];

  await ensureDir(joinVault(vaultRoot, siteRoot(id)));
  await ensureDir(joinVault(vaultRoot, siteWpSyncDir(id)));

  for (const rel of candidates) {
    const from = joinVault(vaultRoot, rel);
    if (!(await pathExists(from))) continue;
    const toRel = sitePath(id, rel);
    const to = joinVault(vaultRoot, toRel);
    if (await pathExists(to)) {
      if (await isEmptyDir(to)) {
        await rm(to, { recursive: true, force: true });
      } else {
        continue;
      }
    }
    await ensureDir(pathMod.dirname(to));
    await rename(from, to);
    moved.push(`${rel} → ${toRel}`);
  }

  await ensureSiteDirs(vaultRoot, id);
  await ensureDir(joinVault(vaultRoot, WP_SYNC_DIR_GLOBAL));
  return { moved };
}
