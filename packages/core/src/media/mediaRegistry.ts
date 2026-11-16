import path from 'node:path';
import {
  ASSETS_IMAGES_DIR,
  isUnderSite,
  siteAssetsImagesDir,
  siteMediaRegistryFile,
  stripSiteRoot,
} from '../vault/paths.js';
import {
  joinVault,
  listFilesRecursive,
  pathExists,
  readText,
  sha256File,
  writeText,
} from '../vault/fs.js';

export interface MediaRegistryEntry {
  sha256: string;
  vaultPath: string;
  category: string;
  wpMediaId: number | null;
  wpSourceUrl: string | null;
}

export interface MediaRegistry {
  version: 1;
  entries: Record<string, MediaRegistryEntry>;
}

export interface DuplicateGroup {
  sha256: string;
  canonicalPath: string;
  duplicatePaths: string[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export function emptyMediaRegistry(): MediaRegistry {
  return { version: 1, entries: {} };
}

export async function loadMediaRegistry(
  vaultRoot: string,
  siteId: string,
): Promise<MediaRegistry> {
  const file = joinVault(vaultRoot, siteMediaRegistryFile(siteId));
  if (!(await pathExists(file))) {
    return emptyMediaRegistry();
  }
  const raw = await readText(file);
  const parsed = JSON.parse(raw) as MediaRegistry;
  return {
    version: 1,
    entries: parsed.entries ?? {},
  };
}

export async function saveMediaRegistry(
  vaultRoot: string,
  siteId: string,
  registry: MediaRegistry,
): Promise<void> {
  const file = joinVault(vaultRoot, siteMediaRegistryFile(siteId));
  await writeText(file, JSON.stringify(registry, null, 2) + '\n');
}

export function categoryFromVaultPath(vaultPath: string): string {
  const normalized = vaultPath.replace(/\\/g, '/');
  const marker = `/${ASSETS_IMAGES_DIR}/`;
  const idx = normalized.indexOf(marker);
  if (idx === -1) {
    if (normalized.startsWith(`${ASSETS_IMAGES_DIR}/`)) {
      return normalized.slice(`${ASSETS_IMAGES_DIR}/`.length).split('/')[0] || 'uncategorized';
    }
    return 'uncategorized';
  }
  const rest = normalized.slice(idx + marker.length);
  return rest.split('/')[0] || 'uncategorized';
}

export function buildUploadFilename(
  category: string,
  slug: string,
  sha256: string,
  ext: string,
): string {
  const safeCategory = category.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const safeSlug = slug.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const hash8 = sha256.slice(0, 8);
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return `${safeCategory}--${safeSlug}-${hash8}${normalizedExt}`;
}

export async function scanVaultImages(
  vaultRoot: string,
  siteId: string,
): Promise<Map<string, string[]>> {
  const imagesRel = siteAssetsImagesDir(siteId);
  const imagesRoot = joinVault(vaultRoot, imagesRel);
  const files = await listFilesRecursive(imagesRoot, (rel) => IMAGE_EXT.test(rel));
  const byHash = new Map<string, string[]>();

  for (const rel of files) {
    const vaultPath = `${imagesRel}/${rel}`.replace(/\\/g, '/');
    const abs = joinVault(vaultRoot, vaultPath);
    const hash = await sha256File(abs);
    const existing = byHash.get(hash) ?? [];
    existing.push(vaultPath);
    byHash.set(hash, existing);
  }

  return byHash;
}

export async function findDuplicateImageGroups(
  vaultRoot: string,
  siteId: string,
): Promise<DuplicateGroup[]> {
  const byHash = await scanVaultImages(vaultRoot, siteId);
  const groups: DuplicateGroup[] = [];
  for (const [sha256, paths] of byHash) {
    if (paths.length > 1) {
      const sorted = [...paths].sort();
      groups.push({
        sha256,
        canonicalPath: sorted[0]!,
        duplicatePaths: sorted.slice(1),
      });
    }
  }
  return groups;
}

export async function upsertLocalImage(
  vaultRoot: string,
  siteId: string,
  vaultPath: string,
  registry?: MediaRegistry,
): Promise<{ registry: MediaRegistry; entry: MediaRegistryEntry; isDuplicate: boolean }> {
  if (!isUnderSite(siteId, vaultPath)) {
    throw new Error(`Image path must be under ${siteAssetsImagesDir(siteId)}: ${vaultPath}`);
  }
  const reg = registry ?? (await loadMediaRegistry(vaultRoot, siteId));
  const abs = joinVault(vaultRoot, vaultPath);
  const sha256 = await sha256File(abs);
  const existing = reg.entries[sha256];
  if (existing) {
    return {
      registry: reg,
      entry: existing,
      isDuplicate: existing.vaultPath !== vaultPath,
    };
  }
  const entry: MediaRegistryEntry = {
    sha256,
    vaultPath,
    category: categoryFromVaultPath(vaultPath),
    wpMediaId: null,
    wpSourceUrl: null,
  };
  reg.entries[sha256] = entry;
  await saveMediaRegistry(vaultRoot, siteId, reg);
  return { registry: reg, entry, isDuplicate: false };
}

export function registerWpMediaByHash(
  registry: MediaRegistry,
  input: {
    sha256: string;
    vaultPath: string;
    category: string;
    wpMediaId: number;
    wpSourceUrl: string;
  },
): MediaRegistry {
  registry.entries[input.sha256] = {
    sha256: input.sha256,
    vaultPath: input.vaultPath,
    category: input.category,
    wpMediaId: input.wpMediaId,
    wpSourceUrl: input.wpSourceUrl,
  };
  return registry;
}

export function findByWpMediaId(
  registry: MediaRegistry,
  wpMediaId: number,
): MediaRegistryEntry | undefined {
  return Object.values(registry.entries).find((e) => e.wpMediaId === wpMediaId);
}

export function findBySha256(
  registry: MediaRegistry,
  sha256: string,
): MediaRegistryEntry | undefined {
  return registry.entries[sha256];
}

export function extFromPath(filePath: string): string {
  return path.extname(filePath) || '.bin';
}

export { stripSiteRoot };
