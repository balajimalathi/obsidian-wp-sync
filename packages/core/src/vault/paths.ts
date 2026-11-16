export const SITES_DIR = 'sites';
export const WP_SYNC_DIR = '.wp-sync';
export const GLOBAL_SITES_REGISTRY_FILE = `${WP_SYNC_DIR}/sites.json`;
export const MEDIA_REGISTRY_FILE = `${WP_SYNC_DIR}/media-registry.json`;
export const CRAWL_SNAPSHOT_FILE = `${WP_SYNC_DIR}/crawl-snapshot.json`;
export const INVENTORY_MD_FILE = `${WP_SYNC_DIR}/inventory.md`;
export const SITE_INVENTORY_JSON_FILE = `${WP_SYNC_DIR}/site-inventory.json`;
export const ASSETS_IMAGES_DIR = 'assets/images';
export const ASSETS_PLACEHOLDERS_DIR = 'assets/placeholders';
export const PILLARS_DIR = 'pillars';
export const PAGES_DIR = 'pages';
export const STATIC_DIR = 'static';
export const ARCHIVE_DELETED_ON_WP_DIR = '_archive/deleted-on-wp';

const SITE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertSiteId(siteId: string): string {
  const id = siteId.trim();
  if (!SITE_ID_RE.test(id)) {
    throw new Error(
      `Invalid site id "${siteId}". Use lowercase letters, numbers, and hyphens (e.g. jsontoimg).`,
    );
  }
  return id;
}

/** Vault-relative root for a site: sites/<id> */
export function siteRoot(siteId: string): string {
  return `${SITES_DIR}/${assertSiteId(siteId)}`;
}

export function sitePath(siteId: string, ...parts: string[]): string {
  return [siteRoot(siteId), ...parts].filter(Boolean).join('/');
}

export function sitePillarsDir(siteId: string): string {
  return sitePath(siteId, PILLARS_DIR);
}

export function sitePagesDir(siteId: string): string {
  return sitePath(siteId, PAGES_DIR);
}

export function siteStaticDir(siteId: string): string {
  return sitePath(siteId, STATIC_DIR);
}

export function siteAssetsImagesDir(siteId: string): string {
  return sitePath(siteId, ASSETS_IMAGES_DIR);
}

export function siteAssetsPlaceholdersDir(siteId: string): string {
  return sitePath(siteId, ASSETS_PLACEHOLDERS_DIR);
}

export function siteArchiveDir(siteId: string): string {
  return sitePath(siteId, ARCHIVE_DELETED_ON_WP_DIR);
}

export function siteWpSyncDir(siteId: string): string {
  return sitePath(siteId, WP_SYNC_DIR);
}

export function siteMediaRegistryFile(siteId: string): string {
  return sitePath(siteId, MEDIA_REGISTRY_FILE);
}

export function siteCrawlSnapshotFile(siteId: string): string {
  return sitePath(siteId, CRAWL_SNAPSHOT_FILE);
}

export function siteInventoryJsonFile(siteId: string): string {
  return sitePath(siteId, SITE_INVENTORY_JSON_FILE);
}

export function siteInventoryMdFile(siteId: string): string {
  return sitePath(siteId, INVENTORY_MD_FILE);
}

/** Strip sites/<id>/ prefix → path relative to site root. */
export function stripSiteRoot(siteId: string, vaultRelPath: string): string {
  const root = siteRoot(siteId) + '/';
  const n = vaultRelPath.replace(/\\/g, '/');
  if (n === siteRoot(siteId)) return '';
  if (n.startsWith(root)) return n.slice(root.length);
  return n;
}

export function isUnderSite(siteId: string, vaultRelPath: string): boolean {
  const n = vaultRelPath.replace(/\\/g, '/');
  const root = siteRoot(siteId);
  return n === root || n.startsWith(`${root}/`);
}

export function isPlaceholderPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (
    normalized.includes(`/${ASSETS_PLACEHOLDERS_DIR}/`) ||
    normalized.startsWith(`${ASSETS_PLACEHOLDERS_DIR}/`) ||
    normalized.includes('/assets/placeholders/')
  ) {
    return true;
  }
  const basename = normalized.split('/').pop() ?? '';
  return /placeholder/i.test(basename);
}

export function urlPathToStaticNotePath(siteId: string, urlPath: string): string {
  const trimmed = urlPath.replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed === '/') {
    return sitePath(siteId, STATIC_DIR, 'index.md');
  }
  return sitePath(siteId, STATIC_DIR, trimmed, 'index.md');
}

export function pillarIndexPath(siteId: string, pillarSlug: string): string {
  return sitePath(siteId, PILLARS_DIR, pillarSlug, 'index.md');
}

export function clusterNotePath(siteId: string, pillarSlug: string, postSlug: string): string {
  return sitePath(siteId, PILLARS_DIR, pillarSlug, `${postSlug}.md`);
}

export function pageNotePath(siteId: string, slug: string): string {
  return sitePath(siteId, PAGES_DIR, `${slug}.md`);
}

/** Paths that are WP multisite mirrors or non-content artifacts from crawl. */
export function isJunkCrawlPath(urlPath: string, siteId: string): boolean {
  const p = urlPath.replace(/\\/g, '/');
  if (
    p.includes('/wp-json') ||
    p.includes('/wp-admin') ||
    p.includes('/feed') ||
    /\.(xml|json|css|js|txt)$/i.test(p)
  ) {
    return true;
  }
  if (p === `/${siteId}` || p.startsWith(`/${siteId}/`)) {
    return true;
  }
  if (/^\/\d{4}\/\d{2}\/\d{2}\//.test(p)) {
    return true;
  }
  return false;
}
