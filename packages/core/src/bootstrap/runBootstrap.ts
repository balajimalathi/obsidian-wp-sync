import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCrawlSnapshot,
  reconcileSite,
  type CrawlSnapshot,
  type SiteInventory,
} from '../reconciler/siteReconciler.js';
import { ensureSiteDirs, requireSite, upsertSite, type SiteRecord } from '../sites/registry.js';
import type { WpRestClient } from '../wp/wpRestClient.js';
import { joinVault } from '../vault/fs.js';
import { siteCrawlSnapshotFile } from '../vault/paths.js';

export interface BootstrapOptions {
  vaultRoot: string;
  siteId: string;
  /** Override public crawl URL; defaults to registry publicSiteUrl. */
  siteUrl?: string;
  client: WpRestClient;
  /** Absolute path to Python executable (default: crawler/.venv or python3). */
  pythonPath?: string;
  /** Skip crawl4ai and reuse existing crawl-snapshot.json */
  skipCrawl?: boolean;
  maxPages?: number;
  /** Optional path to crawler package root; defaults to monorepo crawler/ */
  crawlerRoot?: string;
  /** If site is missing from registry, register with these URLs. */
  registerIfMissing?: Omit<SiteRecord, 'id'> & { id?: string };
}

function defaultCrawlerRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../crawler');
}

export function resolvePythonPath(crawlerRoot: string, override?: string): string {
  if (override) return override;
  if (process.env.PYTHON) return process.env.PYTHON;
  const venvPython = path.join(
    crawlerRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  if (existsSync(venvPython)) return venvPython;
  return 'python3';
}

export function runPythonCrawler(options: {
  siteUrl: string;
  outPath: string;
  pythonPath?: string;
  crawlerRoot?: string;
  maxPages?: number;
}): Promise<void> {
  const crawlerRoot = options.crawlerRoot ?? defaultCrawlerRoot();
  const python = resolvePythonPath(crawlerRoot, options.pythonPath);
  const modulePath = path.join(crawlerRoot, 'src');

  return new Promise((resolve, reject) => {
    const child = spawn(
      python,
      [
        '-m',
        'wp_vault_crawler.crawl_site',
        '--site-url',
        options.siteUrl,
        '--out',
        options.outPath,
        '--max-pages',
        String(options.maxPages ?? 500),
      ],
      {
        cwd: crawlerRoot,
        env: {
          ...process.env,
          PYTHONPATH: [modulePath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
          PLAYWRIGHT_BROWSERS_PATH:
            process.env.PLAYWRIGHT_BROWSERS_PATH ||
            path.join(
              process.env.HOME || process.env.USERPROFILE || '',
              'Library/Caches/ms-playwright',
            ),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`crawl4ai runner failed (exit ${code}): ${stderr}`));
    });
  });
}

export async function runBootstrap(options: BootstrapOptions): Promise<SiteInventory> {
  const { vaultRoot, siteId } = options;
  await ensureSiteDirs(vaultRoot, siteId);

  let siteUrl = options.siteUrl;
  try {
    const site = await requireSite(vaultRoot, siteId);
    siteUrl = siteUrl ?? site.publicSiteUrl;
  } catch {
    if (!options.registerIfMissing || !siteUrl) {
      throw new Error(
        `Unknown site "${siteId}". Add it in Obsidian Settings → WP Sync, or pass registerIfMissing / sites add.`,
      );
    }
    await upsertSite(vaultRoot, {
      id: siteId,
      name: options.registerIfMissing.name,
      publicSiteUrl: options.registerIfMissing.publicSiteUrl || siteUrl,
      wpApiUrl: options.registerIfMissing.wpApiUrl,
    });
  }

  if (!siteUrl) {
    throw new Error(`Missing public site URL for site "${siteId}"`);
  }

  const outPath = joinVault(vaultRoot, siteCrawlSnapshotFile(siteId));

  if (!options.skipCrawl) {
    await runPythonCrawler({
      siteUrl,
      outPath,
      pythonPath: options.pythonPath,
      crawlerRoot: options.crawlerRoot,
      maxPages: options.maxPages,
    });
  }

  let snapshot = await loadCrawlSnapshot(vaultRoot, siteId);
  if (!snapshot) {
    snapshot = {
      site_url: siteUrl,
      crawled_at: new Date().toISOString(),
      page_count: 0,
      pages: [],
    } satisfies CrawlSnapshot;
  }

  let posts: Awaited<ReturnType<WpRestClient['listPosts']>> = [];
  let pages: Awaited<ReturnType<WpRestClient['listPages']>> = [];
  let categories: Awaited<ReturnType<WpRestClient['listCategories']>> = [];
  let wpWarning: string | null = null;

  try {
    [posts, pages, categories] = await Promise.all([
      options.client.listPosts(),
      options.client.listPages(),
      options.client.listCategories(),
    ]);
  } catch (err) {
    wpWarning = err instanceof Error ? err.message : 'WordPress REST API request failed';
    console.warn(
      `[wp-sync] WordPress REST unavailable — classifying all crawled URLs as static.\n` +
        `  ${wpWarning}\n` +
        `  Tip: set WP_API_URL to your actual WordPress origin if the public site is not WP.`,
    );
  }

  const inventory = await reconcileSite({
    vaultRoot,
    siteId,
    siteUrl,
    snapshot,
    posts,
    pages,
    categories,
  });

  if (wpWarning) {
    (inventory as SiteInventory & { wp_warning?: string }).wp_warning = wpWarning;
  }
  return inventory;
}
