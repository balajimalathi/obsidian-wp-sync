# Obsidian WordPress Sync — Multi-site + Plugin Design

**Date:** 2026-11-16  
**Status:** Implemented  
**Depends on:** Phase 1 core (`packages/core`, `packages/cli`, `crawler`)

## Problem

Phase 1 assumes a single flat vault and `.env` credentials. The real workflow is multi-site: one Obsidian vault holds several public sites (e.g. `jsontoimg`, later `extractdb`), each with its own public URL and WordPress API URL. There is **no default site**. Site management and sync must live in the **Obsidian UI**, not only CLI.

## Goals

1. Add / edit / remove sites from Obsidian Settings (public URL + WP API URL + credentials).
2. Pick an active site and run Bootstrap / Pull / Push / Validate from Obsidian commands + ribbon menu.
3. Scope every vault path under `sites/<siteId>/` — no default slug, no flat root pillars/pages.
4. Keep secrets out of git: credentials in Obsidian plugin data; public site list in vault `.wp-sync/sites.json`.
5. CLI remains for automation but **requires** `--site <id>` (no fallback).

## Non-Goals

- Syncing one note to multiple WordPress sites.
- Auto-discovering sites from WordPress multisite network admin.
- Deleting WordPress content from Obsidian (unchanged from Phase 1).
- Shipping credentials in the vault or repo.

## Architecture

```
Obsidian Plugin (packages/obsidian-plugin)
  ├─ Settings UI: site list, Add Site modal, active site
  ├─ Commands / ribbon: bootstrap, pull, push, validate
  └─ calls packages/core with { vaultRoot, siteId, credentials }

packages/core
  ├─ sites registry: load/save .wp-sync/sites.json
  ├─ site-scoped paths: sites/<id>/{pillars,pages,static,assets,_archive,.wp-sync}
  └─ bootstrap / reconcile / pull / push / validate(siteId)

packages/cli
  └─ --site <id> required; credentials from env or plugin-exported file
```

### Vault layout

```
<vault>/
  .wp-sync/
    sites.json                 # public registry (no passwords)
  sites/
    jsontoimg/
      pillars/
      pages/
      static/
      assets/images/<category>/
      assets/placeholders/
      _archive/deleted-on-wp/
      .wp-sync/                # crawl-snapshot, media-registry, inventory
    extractdb/
      …
```

Migration from Phase 1 jumble: move root `pillars|pages|static|assets|_archive|.wp-sync` into `sites/jsontoimg/` and register that site.

### Site registry (`sites.json`)

```json
{
  "version": 1,
  "sites": [
    {
      "id": "jsontoimg",
      "name": "JSON to Image",
      "publicSiteUrl": "https://jsontoimg.com",
      "wpApiUrl": "https://blog.skndan.com/jsontoimg"
    }
  ]
}
```

- `id` = folder name under `sites/` (slug: `[a-z0-9-]+`).
- No username/password in this file.
- Plugin keeps credentials in Obsidian `data.json` keyed by `siteId`.

### Plugin settings data

```ts
interface PluginSettings {
  activeSiteId: string | null;
  credentials: Record<
    string,
    { username: string; applicationPassword: string }
  >;
}
```

`sites.json` is the source of truth for which sites exist; plugin credentials must match by id.

## Obsidian UI (primary surface)

### Settings tab — “WP Sync”

| Control | Behavior |
| --- | --- |
| Active site dropdown | Sets `activeSiteId`; empty until first site added |
| Site list | Name, public URL, WP API URL; Edit / Remove |
| **Add site** button | Opens modal (see below) |
| Status line | Last sync result for active site (ok / errors) |

### Add / Edit Site modal

Required fields:

1. **Display name** — e.g. `JSON to Image`
2. **Site id** — folder slug, editable only on create (e.g. `jsontoimg`)
3. **Public site URL** — crawl/consumer origin (`https://jsontoimg.com`)
4. **WordPress API URL** — REST origin (`https://blog.skndan.com/jsontoimg`)
5. **Username** — WP Application Password user
6. **Application password** — stored only in plugin data

On save:

1. Validate URLs and slug.
2. Append/update `.wp-sync/sites.json`.
3. Create `sites/<id>/` skeleton folders if missing.
4. Store credentials in plugin settings.
5. Set as active site if first site.

### Commands (Command Palette)

All operate on **active site**; refuse with Notice if none selected:

- `WP Sync: Bootstrap active site`
- `WP Sync: Pull from WordPress`
- `WP Sync: Push to WordPress`
- `WP Sync: Validate vault`
- `WP Sync: Switch active site` (fuzzy picker)

### Ribbon

Single ribbon icon → menu: Bootstrap / Pull / Push / Validate / Open settings.

### Notices

Short progress Notices for start/success/failure. Long validation output written to `sites/<id>/.wp-sync/last-validate.md` and opened in a leaf on failure.

## Core API changes

Every entry point takes an explicit `siteId: string` (no default):

- `runBootstrap({ vaultRoot, siteId, siteUrl, client, … })`
- `reconcileSite({ vaultRoot, siteId, … })`
- `pullFromWordPress({ vaultRoot, siteId, client, … })`
- `pushToWordPress({ vaultRoot, siteId, client, … })`
- `validateVault(vaultRoot, siteId, options)`

Paths resolve via `sites/<siteId>/…` helpers. Remove `DEFAULT_SITE_SLUG`.

New module: `packages/core/src/sites/registry.ts` — `listSites`, `getSite`, `upsertSite`, `removeSite`.

## CLI

```bash
wp-sync sites list --vault …
wp-sync sites add --id … --name … --public-url … --wp-api-url …
wp-sync bootstrap --site jsontoimg --vault …
wp-sync pull --site jsontoimg --vault …
wp-sync push --site jsontoimg --vault …
wp-sync validate --site jsontoimg --vault …
```

Credentials still from env for CLI, but scoped:

```
WP_USERNAME / WP_APPLICATION_PASSWORD   # used when --site matches
# or per-site overrides later:
# WP_<SITEID>_USERNAME (optional Phase 2.1)
```

Missing `--site` → hard error: `Site id required (no default). Use --site <id> or Obsidian Settings → WP Sync.`

## Bootstrap / crawl per site

- Crawl uses `publicSiteUrl` for that site.
- Snapshot + media registry live under `sites/<id>/.wp-sync/`.
- Junk-path filter uses that site’s `id` (multisite path leak).

## Security

- Application passwords never written into vault markdown or `sites.json`.
- Plugin `data.json` is local to Obsidian; document that vault sync tools (iCloud/Git) should not commit `.obsidian/plugins/*/data.json` if it contains secrets — recommend gitignoring plugin data or using Obsidian Sync carefully.
- Obsidian never issues WP DELETE.

## Implementation order

1. Site registry + path rewrite under `sites/<id>/` (core).
2. Wire bootstrap/reconcile/sync/validate + CLI `--site`.
3. One-shot vault migrator: flat → `sites/jsontoimg` + seed `sites.json`.
4. Obsidian plugin package: settings UI, modal, commands, ribbon.
5. Re-bootstrap / validate `jsontoimg` from plugin or CLI.

## Success criteria

- From Obsidian Settings, Balaji can add a second site without touching `.env`.
- Active-site Pull/Push/Validate only touch that site’s folder.
- CLI without `--site` fails loudly.
- No passwords in `sites.json` or note frontmatter.
