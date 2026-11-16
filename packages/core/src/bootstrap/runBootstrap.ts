import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCrawlSnapshot,
  reconcileSite,
  type CrawlSnapshot,
  type SiteInventory,
} from '../reconciler/siteReconciler.js';
import type { WpRestClient } from '../wp/wpRestClient.js';
import { joinVault } from '../vault/fs.js';
import { CRAWL_SNAPSHOT_FILE } from '../vault/paths.js';

export interface BootstrapOptions {
  vaultRoot: string;
  siteUrl: string;
  client: WpRestClient;
  /** Absolute path to Python executable (default: python3). */
  pythonPath?: string;
  /** Skip crawl4ai and reuse existing crawl-snapshot.json */
  skipCrawl?: boolean;
  maxPages?: number;
  /** Optional path to crawler package root; defaults to monorepo crawler/ */
  crawlerRoot?: string;
}

function defaultCrawlerRoot(): string {
  // packages/core/src/bootstrap -> repo root ../..
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../crawler');
}

export function runPythonCrawler(options: {
  siteUrl: string;
  outPath: string;
  pythonPath?: string;
  crawlerRoot?: string;
  maxPages?: number;
}): Promise<void> {
  const python = options.pythonPath ?? process.env.PYTHON ?? 'python3';
  const crawlerRoot = options.crawlerRoot ?? defaultCrawlerRoot();
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
  const outPath = joinVault(options.vaultRoot, CRAWL_SNAPSHOT_FILE);

  if (!options.skipCrawl) {
    await runPythonCrawler({
      siteUrl: options.siteUrl,
      outPath,
      pythonPath: options.pythonPath,
      crawlerRoot: options.crawlerRoot,
      maxPages: options.maxPages,
    });
  }

  let snapshot = await loadCrawlSnapshot(options.vaultRoot);
  if (!snapshot) {
    // Minimal empty snapshot so reconcile can still materialize WP content
    snapshot = {
      site_url: options.siteUrl,
      crawled_at: new Date().toISOString(),
      page_count: 0,
      pages: [],
    } satisfies CrawlSnapshot;
  }

  const [posts, pages, categories] = await Promise.all([
    options.client.listPosts(),
    options.client.listPages(),
    options.client.listCategories(),
  ]);

  return reconcileSite({
    vaultRoot: options.vaultRoot,
    siteUrl: options.siteUrl,
    snapshot,
    posts,
    pages,
    categories,
  });
}
