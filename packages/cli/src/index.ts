#!/usr/bin/env node
import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import {
  createNodeFetchTransport,
  createWpRestClient,
  loadCrawlSnapshot,
  pullFromWordPress,
  pushToWordPress,
  reconcileSite,
  runBootstrap,
  validateVault,
  type CrawlSnapshot,
} from '@obsidian-wp-sync/core';

loadEnv({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} (set in .env or environment)`);
  return v;
}

function clientFromEnv() {
  return createWpRestClient(
    {
      siteUrl: requireEnv('WP_SITE_URL'),
      username: requireEnv('WP_USERNAME'),
      applicationPassword: requireEnv('WP_APPLICATION_PASSWORD'),
    },
    createNodeFetchTransport(),
  );
}

function vaultPath(flag?: string): string {
  return path.resolve(flag ?? process.env.VAULT_PATH ?? process.cwd());
}

const program = new Command();
program.name('wp-sync').description('Obsidian ↔ WordPress sync (Phase 1)').version('0.1.0');

program
  .command('bootstrap')
  .option('--vault <path>', 'Obsidian vault root')
  .option('--skip-crawl', 'Reuse existing .wp-sync/crawl-snapshot.json')
  .option('--max-pages <n>', 'crawl4ai page cap', '500')
  .action(async (opts: { vault?: string; skipCrawl?: boolean; maxPages?: string }) => {
    const vault = vaultPath(opts.vault);
    const inventory = await runBootstrap({
      vaultRoot: vault,
      siteUrl: requireEnv('WP_SITE_URL'),
      client: clientFromEnv(),
      skipCrawl: Boolean(opts.skipCrawl),
      maxPages: Number(opts.maxPages ?? 500),
    });
    console.log(
      `Bootstrap done: ${inventory.wordpress.length} wordpress, ${inventory.static.length} static → ${vault}`,
    );
  });

program
  .command('inventory')
  .option('--vault <path>', 'Obsidian vault root')
  .action(async (opts: { vault?: string }) => {
    const vault = vaultPath(opts.vault);
    const snapshot =
      (await loadCrawlSnapshot(vault)) ??
      ({
        site_url: requireEnv('WP_SITE_URL'),
        crawled_at: new Date().toISOString(),
        page_count: 0,
        pages: [],
      } satisfies CrawlSnapshot);
    const client = clientFromEnv();
    const [posts, pages, categories] = await Promise.all([
      client.listPosts(),
      client.listPages(),
      client.listCategories(),
    ]);
    const inventory = await reconcileSite({
      vaultRoot: vault,
      siteUrl: requireEnv('WP_SITE_URL'),
      snapshot,
      posts,
      pages,
      categories,
    });
    console.log(
      `Inventory: ${inventory.wordpress.length} wordpress, ${inventory.static.length} static`,
    );
  });

program
  .command('validate')
  .option('--vault <path>', 'Obsidian vault root')
  .option('--allow-draft-links', 'Allow publish→draft links')
  .action(async (opts: { vault?: string; allowDraftLinks?: boolean }) => {
    const issues = await validateVault(vaultPath(opts.vault), {
      allowDraftLinks: Boolean(opts.allowDraftLinks),
    });
    if (issues.length === 0) {
      console.log('OK — no validation issues');
      return;
    }
    for (const i of issues) {
      console.log(`[${i.severity}] ${i.code}: ${i.message}`);
    }
    process.exitCode = issues.some((i) => i.severity === 'error') ? 1 : 0;
  });

program
  .command('pull')
  .option('--vault <path>', 'Obsidian vault root')
  .option('--dry-run', 'Do not write vault files')
  .action(async (opts: { vault?: string; dryRun?: boolean }) => {
    const result = await pullFromWordPress({
      vaultRoot: vaultPath(opts.vault),
      client: clientFromEnv(),
      dryRun: Boolean(opts.dryRun),
    });
    console.log(
      `Pull: ${result.pulled.length} pulled, ${result.archived.length} archived${result.dryRun ? ' (dry-run)' : ''}`,
    );
  });

program
  .command('push')
  .option('--vault <path>', 'Obsidian vault root')
  .option('--dry-run', 'Validate and report without WP writes')
  .option('--allow-draft-links', 'Allow publish→draft links')
  .action(async (opts: { vault?: string; dryRun?: boolean; allowDraftLinks?: boolean }) => {
    const result = await pushToWordPress({
      vaultRoot: vaultPath(opts.vault),
      client: clientFromEnv(),
      dryRun: Boolean(opts.dryRun),
      allowDraftLinks: Boolean(opts.allowDraftLinks),
    });
    console.log(
      `Push: ${result.pushed.length} notes, ${result.uploadedMedia.length} media${result.dryRun ? ' (dry-run)' : ''}`,
    );
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
