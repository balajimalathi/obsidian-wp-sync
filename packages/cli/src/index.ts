#!/usr/bin/env node
import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFetchTransport,
  createWpRestClient,
  listSites,
  loadCrawlSnapshot,
  migrateFlatVaultToSite,
  pullFromWordPress,
  pushToWordPress,
  reconcileSite,
  requireSite,
  runBootstrap,
  upsertSite,
  validateVault,
  type CrawlSnapshot,
} from '@obsidian-wp-sync/core';

function resolveEnvPath(): string {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', '.env'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', '.env'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

loadEnv({ path: resolveEnvPath() });

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} (set in .env or environment)`);
  return v;
}

function requireSiteFlag(site?: string): string {
  const id = site?.trim();
  if (!id) {
    throw new Error(
      'Site id required (no default). Use --site <id> or Obsidian Settings → WP Sync.',
    );
  }
  return id;
}

function clientFromEnv(apiUrl: string) {
  return createWpRestClient(
    {
      siteUrl: apiUrl,
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
program.name('wp-sync').description('Obsidian ↔ WordPress sync').version('0.2.0');

const sitesCmd = program.command('sites').description('Manage multi-site registry');

sitesCmd
  .command('list')
  .option('--vault <path>', 'Obsidian vault root')
  .action(async (opts: { vault?: string }) => {
    const sites = await listSites(vaultPath(opts.vault));
    if (sites.length === 0) {
      console.log('No sites registered. Add one in Obsidian Settings → WP Sync or: wp-sync sites add');
      return;
    }
    for (const s of sites) {
      console.log(`${s.id}\t${s.name}\t${s.publicSiteUrl}\t${s.wpApiUrl}`);
    }
  });

sitesCmd
  .command('add')
  .requiredOption('--id <id>', 'Site folder id (e.g. jsontoimg)')
  .requiredOption('--name <name>', 'Display name')
  .requiredOption('--public-url <url>', 'Public consumer site URL')
  .requiredOption('--wp-api-url <url>', 'WordPress REST API origin')
  .option('--vault <path>', 'Obsidian vault root')
  .action(
    async (opts: {
      id: string;
      name: string;
      publicUrl: string;
      wpApiUrl: string;
      vault?: string;
    }) => {
      await upsertSite(vaultPath(opts.vault), {
        id: opts.id,
        name: opts.name,
        publicSiteUrl: opts.publicUrl,
        wpApiUrl: opts.wpApiUrl,
      });
      console.log(`Registered site ${opts.id}`);
    },
  );

sitesCmd
  .command('migrate-flat')
  .description('Move Phase-1 flat vault folders into sites/<id>/')
  .requiredOption('--site <id>', 'Target site id')
  .requiredOption('--name <name>', 'Display name')
  .requiredOption('--public-url <url>', 'Public consumer site URL')
  .requiredOption('--wp-api-url <url>', 'WordPress REST API origin')
  .option('--vault <path>', 'Obsidian vault root')
  .action(
    async (opts: {
      site: string;
      name: string;
      publicUrl: string;
      wpApiUrl: string;
      vault?: string;
    }) => {
      const result = await migrateFlatVaultToSite(vaultPath(opts.vault), {
        id: opts.site,
        name: opts.name,
        publicSiteUrl: opts.publicUrl,
        wpApiUrl: opts.wpApiUrl,
      });
      console.log(`Migrated ${result.moved.length} path(s) into sites/${opts.site}/`);
      for (const line of result.moved) console.log(`  ${line}`);
    },
  );

program
  .command('bootstrap')
  .requiredOption('--site <id>', 'Site id (required, no default)')
  .option('--vault <path>', 'Obsidian vault root')
  .option('--skip-crawl', 'Reuse existing crawl-snapshot.json')
  .option('--max-pages <n>', 'crawl4ai page cap', '500')
  .action(async (opts: { site: string; vault?: string; skipCrawl?: boolean; maxPages?: string }) => {
    const siteId = requireSiteFlag(opts.site);
    const vault = vaultPath(opts.vault);
    const site = await requireSite(vault, siteId);
    console.log(`Site:       ${siteId}`);
    console.log(`Crawl site: ${site.publicSiteUrl}`);
    console.log(`WP API:     ${site.wpApiUrl}`);
    const inventory = await runBootstrap({
      vaultRoot: vault,
      siteId,
      siteUrl: site.publicSiteUrl,
      client: clientFromEnv(site.wpApiUrl),
      skipCrawl: Boolean(opts.skipCrawl),
      maxPages: Number(opts.maxPages ?? 500),
    });
    console.log(
      `Bootstrap done: ${inventory.wordpress.length} wordpress, ${inventory.static.length} static → sites/${siteId}`,
    );
  });

program
  .command('inventory')
  .requiredOption('--site <id>', 'Site id (required, no default)')
  .option('--vault <path>', 'Obsidian vault root')
  .action(async (opts: { site: string; vault?: string }) => {
    const siteId = requireSiteFlag(opts.site);
    const vault = vaultPath(opts.vault);
    const site = await requireSite(vault, siteId);
    const snapshot =
      (await loadCrawlSnapshot(vault, siteId)) ??
      ({
        site_url: site.publicSiteUrl,
        crawled_at: new Date().toISOString(),
        page_count: 0,
        pages: [],
      } satisfies CrawlSnapshot);
    const client = clientFromEnv(site.wpApiUrl);
    const [posts, pages, categories] = await Promise.all([
      client.listPosts(),
      client.listPages(),
      client.listCategories(),
    ]);
    const inventory = await reconcileSite({
      vaultRoot: vault,
      siteId,
      siteUrl: site.publicSiteUrl,
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
  .requiredOption('--site <id>', 'Site id (required, no default)')
  .option('--vault <path>', 'Obsidian vault root')
  .option('--allow-draft-links', 'Allow publish→draft links')
  .action(async (opts: { site: string; vault?: string; allowDraftLinks?: boolean }) => {
    const siteId = requireSiteFlag(opts.site);
    const issues = await validateVault(vaultPath(opts.vault), siteId, {
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
  .requiredOption('--site <id>', 'Site id (required, no default)')
  .option('--vault <path>', 'Obsidian vault root')
  .option('--dry-run', 'Do not write vault files')
  .action(async (opts: { site: string; vault?: string; dryRun?: boolean }) => {
    const siteId = requireSiteFlag(opts.site);
    const vault = vaultPath(opts.vault);
    const site = await requireSite(vault, siteId);
    const result = await pullFromWordPress({
      vaultRoot: vault,
      siteId,
      client: clientFromEnv(site.wpApiUrl),
      dryRun: Boolean(opts.dryRun),
    });
    console.log(
      `Pull: ${result.pulled.length} pulled, ${result.archived.length} archived${result.dryRun ? ' (dry-run)' : ''}`,
    );
  });

program
  .command('push')
  .requiredOption('--site <id>', 'Site id (required, no default)')
  .option('--vault <path>', 'Obsidian vault root')
  .option('--dry-run', 'Validate and report without WP writes')
  .option('--allow-draft-links', 'Allow publish→draft links')
  .action(async (opts: { site: string; vault?: string; dryRun?: boolean; allowDraftLinks?: boolean }) => {
    const siteId = requireSiteFlag(opts.site);
    const vault = vaultPath(opts.vault);
    const site = await requireSite(vault, siteId);
    const result = await pushToWordPress({
      vaultRoot: vault,
      siteId,
      client: clientFromEnv(site.wpApiUrl),
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
