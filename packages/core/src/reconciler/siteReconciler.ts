import path from 'node:path';
import { htmlToMarkdown, stripHtmlEntitiesTitle } from '../markdown/converter.js';
import {
  createDefaultFrontmatter,
  serializeVaultNote,
} from '../schema/frontmatter.js';
import type { WpPage, WpPost, WpTerm } from '../wp/types.js';
import {
  ensureDir,
  joinVault,
  listFilesRecursive,
  moveFile,
  pathExists,
  readText,
  writeText,
} from '../vault/fs.js';
import {
  CRAWL_SNAPSHOT_FILE,
  INVENTORY_MD_FILE,
  PAGES_DIR,
  PILLARS_DIR,
  SITE_INVENTORY_JSON_FILE,
  STATIC_DIR,
  clusterNotePath,
  pageNotePath,
  pillarIndexPath,
  urlPathToStaticNotePath,
} from '../vault/paths.js';

export interface CrawlPage {
  url: string;
  status: string;
  error?: string | null;
  title?: string | null;
  markdown?: string | null;
  links?: string[];
  images?: string[];
}

export interface CrawlSnapshot {
  site_url: string;
  crawled_at: string;
  page_count: number;
  pages: CrawlPage[];
}

export interface InventoryItem {
  source: 'wordpress' | 'static';
  role: 'pillar' | 'cluster' | 'page' | 'static';
  title: string;
  slug: string;
  url_path: string;
  vault_path: string;
  wp_id: number | null;
  wp_type: 'post' | 'page' | null;
}

export interface SiteInventory {
  generated_at: string;
  site_url: string;
  wordpress: InventoryItem[];
  static: InventoryItem[];
}

export interface ReconcileInput {
  vaultRoot: string;
  siteUrl: string;
  snapshot: CrawlSnapshot;
  posts: WpPost[];
  pages: WpPage[];
  categories: WpTerm[];
}

function normalizeUrlPath(url: string, siteUrl: string): string {
  try {
    const u = new URL(url);
    const site = new URL(siteUrl);
    if (u.origin !== site.origin) {
      return u.pathname.replace(/\/+$/, '') || '/';
    }
    return u.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

function slugFromPath(urlPath: string): string {
  const trimmed = urlPath.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return 'home';
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || 'home';
}

function categoryById(categories: WpTerm[]): Map<number, WpTerm> {
  return new Map(categories.map((c) => [c.id, c]));
}

function primaryCategorySlug(post: WpPost, byId: Map<number, WpTerm>): string {
  const first = post.categories?.[0];
  if (first == null) return 'uncategorized';
  return byId.get(first)?.slug ?? 'uncategorized';
}

function titleOf(item: WpPost | WpPage): string {
  return stripHtmlEntitiesTitle(item.title.raw ?? item.title.rendered ?? item.slug);
}

function contentOf(item: WpPost | WpPage): string {
  const raw = item.content.raw ?? item.content.rendered ?? '';
  // Prefer raw Gutenberg/HTML converted to markdown
  return htmlToMarkdown(raw);
}

function statusOf(item: WpPost | WpPage): 'draft' | 'publish' | 'private' {
  if (item.status === 'private') return 'private';
  if (item.status === 'publish') return 'publish';
  return 'draft';
}

async function migrateLegacyStaticRoutes(vaultRoot: string): Promise<void> {
  // Move existing top-level route folders (e.g. jsontoimg/, extractdb/) into static/
  const entries = await listFilesRecursive(vaultRoot, (rel) => {
    const n = rel.replace(/\\/g, '/');
    return n.endsWith('/index.md') && !n.includes('/');
  });

  // Also check one-level folders: jsontoimg/index.md
  const topLevel = await listFilesRecursive(vaultRoot, (rel) => {
    const n = rel.replace(/\\/g, '/');
    const parts = n.split('/');
    return (
      parts.length === 2 &&
      parts[1] === 'index.md' &&
      !['pillars', 'pages', 'static', 'assets', '_archive', '.wp-sync', '.obsidian'].includes(
        parts[0]!,
      )
    );
  });

  for (const rel of [...entries, ...topLevel]) {
    const route = rel.split('/')[0]!;
    const from = joinVault(vaultRoot, rel);
    const toRel = `${STATIC_DIR}/${route}/index.md`;
    const to = joinVault(vaultRoot, toRel);
    if (await pathExists(from)) {
      if (!(await pathExists(to))) {
        await moveFile(from, to);
      }
    }
  }
}

export async function loadCrawlSnapshot(vaultRoot: string): Promise<CrawlSnapshot | null> {
  const file = joinVault(vaultRoot, CRAWL_SNAPSHOT_FILE);
  if (!(await pathExists(file))) return null;
  return JSON.parse(await readText(file)) as CrawlSnapshot;
}

export async function saveCrawlSnapshot(
  vaultRoot: string,
  snapshot: CrawlSnapshot,
): Promise<void> {
  await writeText(
    joinVault(vaultRoot, CRAWL_SNAPSHOT_FILE),
    JSON.stringify(snapshot, null, 2) + '\n',
  );
}

export function buildInventoryMarkdown(inventory: SiteInventory): string {
  const lines: string[] = [
    '# Site Inventory',
    '',
    `Generated: ${inventory.generated_at}`,
    `Site: ${inventory.site_url}`,
    '',
    '## WordPress content (synced via REST API)',
    '',
    '| Role | Title | Vault path | URL | WP ID |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const item of inventory.wordpress) {
    lines.push(
      `| ${item.role} | ${item.title} | \`${item.vault_path}\` | ${item.url_path} | ${item.wp_id ?? ''} |`,
    );
  }
  lines.push('', '## Static content (manual deploy — never pushed to WordPress)', '', '| Title | Vault path | URL |', '| --- | --- | --- |');
  for (const item of inventory.static) {
    lines.push(`| ${item.title} | \`${item.vault_path}\` | ${item.url_path} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function reconcileSite(input: ReconcileInput): Promise<SiteInventory> {
  const { vaultRoot, siteUrl, snapshot, posts, pages, categories } = input;
  await ensureDir(joinVault(vaultRoot, PILLARS_DIR));
  await ensureDir(joinVault(vaultRoot, PAGES_DIR));
  await ensureDir(joinVault(vaultRoot, STATIC_DIR));
  await ensureDir(joinVault(vaultRoot, 'assets/images'));
  await ensureDir(joinVault(vaultRoot, 'assets/placeholders'));
  await ensureDir(joinVault(vaultRoot, '.wp-sync'));

  await migrateLegacyStaticRoutes(vaultRoot);

  const catById = categoryById(categories);
  const wpUrlPaths = new Set<string>();
  const wordpressItems: InventoryItem[] = [];
  const staticItems: InventoryItem[] = [];

  // Pillars = first post per category used as index when only one "main" post;
  // For bootstrap: each category folder gets posts; the first publish post becomes pillar index if named like category, else first post is pillar.
  const postsByCategory = new Map<string, WpPost[]>();
  for (const post of posts) {
    const catSlug = primaryCategorySlug(post, catById);
    const list = postsByCategory.get(catSlug) ?? [];
    list.push(post);
    postsByCategory.set(catSlug, list);
  }

  for (const [catSlug, catPosts] of postsByCategory) {
    // Prefer a post whose slug matches the category as pillar; else first by title.
    const sorted = [...catPosts].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    const pillarPost =
      sorted.find((p) => p.slug === catSlug) ?? sorted[0]!;
    const clusterPosts = sorted.filter((p) => p.id !== pillarPost.id);

    const pillarPath = pillarIndexPath(catSlug);
    const pillarUrl = normalizeUrlPath(pillarPost.link, siteUrl);
    wpUrlPaths.add(pillarUrl);

    const pillarFm = createDefaultFrontmatter({
      title: titleOf(pillarPost),
      source: 'wordpress',
      role: 'pillar',
      wp_id: pillarPost.id,
      wp_type: 'post',
      slug: pillarPost.slug,
      url_path: pillarUrl,
      status: statusOf(pillarPost),
      pillar: catSlug,
      categories: [catSlug],
      tags: [],
      featured_image: null,
      last_synced_hash: null,
    });
    await writeText(
      joinVault(vaultRoot, pillarPath),
      serializeVaultNote(pillarFm, contentOf(pillarPost)),
    );
    wordpressItems.push({
      source: 'wordpress',
      role: 'pillar',
      title: pillarFm.title,
      slug: pillarFm.slug,
      url_path: pillarUrl,
      vault_path: pillarPath,
      wp_id: pillarPost.id,
      wp_type: 'post',
    });

    for (const post of clusterPosts) {
      const notePath = clusterNotePath(catSlug, post.slug);
      const urlPath = normalizeUrlPath(post.link, siteUrl);
      wpUrlPaths.add(urlPath);
      const fm = createDefaultFrontmatter({
        title: titleOf(post),
        source: 'wordpress',
        role: 'cluster',
        wp_id: post.id,
        wp_type: 'post',
        slug: post.slug,
        url_path: urlPath,
        status: statusOf(post),
        pillar: catSlug,
        categories: [catSlug],
        tags: [],
        featured_image: null,
        last_synced_hash: null,
      });
      await writeText(joinVault(vaultRoot, notePath), serializeVaultNote(fm, contentOf(post)));
      wordpressItems.push({
        source: 'wordpress',
        role: 'cluster',
        title: fm.title,
        slug: fm.slug,
        url_path: urlPath,
        vault_path: notePath,
        wp_id: post.id,
        wp_type: 'post',
      });
    }
  }

  for (const page of pages) {
    const urlPath = normalizeUrlPath(page.link, siteUrl);
    wpUrlPaths.add(urlPath);
    const notePath = pageNotePath(page.slug);
    const fm = createDefaultFrontmatter({
      title: titleOf(page),
      source: 'wordpress',
      role: 'page',
      wp_id: page.id,
      wp_type: 'page',
      slug: page.slug,
      url_path: urlPath,
      status: statusOf(page),
      pillar: null,
      categories: [],
      tags: [],
      featured_image: null,
      last_synced_hash: null,
    });
    await writeText(joinVault(vaultRoot, notePath), serializeVaultNote(fm, contentOf(page)));
    wordpressItems.push({
      source: 'wordpress',
      role: 'page',
      title: fm.title,
      slug: fm.slug,
      url_path: urlPath,
      vault_path: notePath,
      wp_id: page.id,
      wp_type: 'page',
    });
  }

  // Crawl pages not matched to WP → static
  for (const page of snapshot.pages) {
    if (page.status !== 'ok') continue;
    const urlPath = normalizeUrlPath(page.url, siteUrl);
    if (wpUrlPaths.has(urlPath)) continue;
    // Skip obvious non-content paths
    if (
      urlPath.includes('/wp-json') ||
      urlPath.includes('/wp-admin') ||
      urlPath.includes('/feed') ||
      urlPath.match(/\.(xml|json|css|js)$/i)
    ) {
      continue;
    }

    const notePath = urlPathToStaticNotePath(urlPath);
    const slug = slugFromPath(urlPath);
    const title = page.title?.trim() || slug;
    const abs = joinVault(vaultRoot, notePath);

    if (!(await pathExists(abs))) {
      const fm = createDefaultFrontmatter({
        title,
        source: 'static',
        role: 'static',
        wp_id: null,
        wp_type: null,
        slug,
        url_path: urlPath,
        status: 'publish',
        pillar: null,
        categories: [],
        tags: [],
        featured_image: null,
        last_synced_hash: null,
      });
      const body = page.markdown?.trim() ? page.markdown.trim() + '\n' : '';
      await writeText(abs, serializeVaultNote(fm, body));
    } else {
      // Ensure existing static note has frontmatter; if legacy empty, wrap it
      const existing = await readText(abs);
      if (!existing.startsWith('---')) {
        const fm = createDefaultFrontmatter({
          title,
          source: 'static',
          role: 'static',
          slug,
          url_path: urlPath,
        });
        await writeText(abs, serializeVaultNote(fm, existing.trim() + '\n'));
      }
    }

    staticItems.push({
      source: 'static',
      role: 'static',
      title,
      slug,
      url_path: urlPath,
      vault_path: notePath,
      wp_id: null,
      wp_type: null,
    });
  }

  // Also inventory any static notes already on disk
  const staticFiles = await listFilesRecursive(joinVault(vaultRoot, STATIC_DIR), (rel) =>
    rel.endsWith('.md'),
  );
  const knownStatic = new Set(staticItems.map((s) => s.vault_path));
  for (const rel of staticFiles) {
    const vaultPath = path.posix.join(STATIC_DIR, rel.replace(/\\/g, '/'));
    if (knownStatic.has(vaultPath)) continue;
    staticItems.push({
      source: 'static',
      role: 'static',
      title: path.posix.basename(rel, '.md'),
      slug: path.posix.basename(rel, '.md'),
      url_path: '/' + rel.replace(/\\/g, '/').replace(/\/index\.md$/, '').replace(/\.md$/, ''),
      vault_path: vaultPath,
      wp_id: null,
      wp_type: null,
    });
  }

  const inventory: SiteInventory = {
    generated_at: new Date().toISOString(),
    site_url: siteUrl,
    wordpress: wordpressItems,
    static: staticItems,
  };

  await writeText(
    joinVault(vaultRoot, SITE_INVENTORY_JSON_FILE),
    JSON.stringify(inventory, null, 2) + '\n',
  );
  await writeText(joinVault(vaultRoot, INVENTORY_MD_FILE), buildInventoryMarkdown(inventory));
  await saveCrawlSnapshot(vaultRoot, snapshot);

  return inventory;
}
