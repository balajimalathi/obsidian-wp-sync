# Obsidian WordPress Sync — Phase 1 Design

**Date:** 2026-11-16  
**Status:** Approved for implementation

## Problem

Manage an entire WordPress site's posts and pages from Obsidian: plan content pillars, cluster posts, and internal links locally; push/pull via WordPress Application Passwords; keep static (non-WP) pages visible but never synced to WordPress; enforce unique categorized images, required featured images, and placeholder-image sync blocks.

## Goals (Phase 1)

1. Discover live site structure with `crawl4ai` and classify every URL as `wordpress` or `static`.
2. Materialize a role-based vault layout under the target Obsidian vault.
3. Provide a shared TypeScript core + CLI for bootstrap, inventory, validate, pull, and push.
4. Never delete WordPress content from Obsidian (Application Password auth; GET/POST only).

## Non-Goals (Phase 1)

- Obsidian plugin UI (Phase 2 wraps `packages/core`).
- SEO plugin meta sync (RankMath/Yoast).
- WordPress-side custom media taxonomy MU-plugin.

## Architecture

Thin Python `crawl4ai` runner writes `.wp-sync/crawl-snapshot.json`. Shared TypeScript `packages/core` owns schema, WP REST client, Markdown converter, SHA-256 media registry, site reconciler, validator, and sync engine. `packages/cli` exposes `wp-sync` commands. Phase 2 Obsidian plugin will import the same core.

### Vault layout (target: `/Users/equitasrmb/Documents/skndan/obsidian`)

| Path | Purpose |
|------|---------|
| `pillars/<pillar-slug>/index.md` | Pillar post (`source: wordpress`, `role: pillar`) |
| `pillars/<pillar-slug>/<post-slug>.md` | Cluster post (`role: cluster`) |
| `pages/<slug>.md` | WP pages |
| `static/<route>/index.md` | Non-WP static pages (manual deploy) |
| `_archive/deleted-on-wp/` | Notes whose WP IDs disappeared on pull |
| `assets/images/<category>/` | Synced categorized images |
| `assets/placeholders/` | Non-syncable placeholders |
| `.wp-sync/` | Crawl snapshot, media registry, inventory |

### Frontmatter contract

```ts
interface VaultNoteFrontmatter {
  title: string;
  source: 'wordpress' | 'static';
  role: 'pillar' | 'cluster' | 'page' | 'static';
  wp_id: number | null;
  wp_type: 'post' | 'page' | null;
  slug: string;
  url_path: string;
  status: 'draft' | 'publish' | 'private';
  pillar: string | null;
  categories: string[];
  tags: string[];
  featured_image: string | null;
  last_synced_hash: string | null;
}
```

### Pre-push validation

- Block `source: static`.
- Require `featured_image` on every wordpress post/page; file must exist.
- Block `assets/placeholders/**` and filenames matching `/placeholder/i`.
- Block duplicate SHA-256 files under `assets/images/` until consolidated.
- Block broken wikilinks / relative links; clusters need existing pillar index; publish→draft links require `--allow-draft-links`.

### Media

- Index by SHA-256 in `.wp-sync/media-registry.json`.
- Never re-upload known hashes.
- Upload filename: `<category>--<slug>-<hash8>.<ext>`.
- Stock WP REST only (no custom taxonomy).

### Deletion policy

- Deleting a vault note never deletes WP content.
- WP Admin deletes surface as moves to `_archive/deleted-on-wp/` on pull.

### Auth

- WordPress Application Password over HTTPS Basic Auth.
- Credentials via `.env` / CLI flags; never commit secrets.

## Packages

- `crawler/` — Python 3.11+, crawl4ai sitemap + BFS → crawl-snapshot.json
- `packages/core` — Shared engine
- `packages/cli` — `bootstrap`, `inventory`, `validate`, `pull`, `push` (`--dry-run`)

## Success criteria

1. `wp-sync bootstrap` classifies WP vs static and writes inventory.
2. `wp-sync validate` enforces featured image / placeholder / link rules.
3. `wp-sync push` uploads only unique images and upserts posts/pages; never DELETE.
4. `wp-sync pull` archives notes for WP-deleted IDs.
5. Existing vault routes (`jsontoimg`, `extractdb`) land under `static/` without content loss.
