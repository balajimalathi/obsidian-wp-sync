export const WP_SYNC_DIR = '.wp-sync';
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

export function isPlaceholderPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes(`${ASSETS_PLACEHOLDERS_DIR}/`)) {
    return true;
  }
  const basename = normalized.split('/').pop() ?? '';
  return /placeholder/i.test(basename);
}

export function urlPathToStaticNotePath(urlPath: string): string {
  const trimmed = urlPath.replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed === '/') {
    return `${STATIC_DIR}/index.md`;
  }
  return `${STATIC_DIR}/${trimmed}/index.md`;
}

export function pillarIndexPath(pillarSlug: string): string {
  return `${PILLARS_DIR}/${pillarSlug}/index.md`;
}

export function clusterNotePath(pillarSlug: string, postSlug: string): string {
  return `${PILLARS_DIR}/${pillarSlug}/${postSlug}.md`;
}

export function pageNotePath(slug: string): string {
  return `${PAGES_DIR}/${slug}.md`;
}
