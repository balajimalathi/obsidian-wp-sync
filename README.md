# obsidian-wp-sync

Multi-site Obsidian ↔ WordPress sync: shared TypeScript core, CLI, crawl4ai bootstrapper, and an Obsidian plugin UI to add sites and sync.

**Target vault:** `/Users/equitasrmb/Documents/skndan/obsidian`

## Layout

```
sites/<site-id>/
  pillars/  pages/  static/  assets/  _archive/  .wp-sync/
.wp-sync/sites.json          # public site list (no passwords)
```

There is **no default site**. Every CLI command requires `--site <id>`. In Obsidian, pick an active site in **Settings → WP Sync**.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/core` | Schema, media registry, validator, WP REST, reconciler, sync, site registry |
| `packages/cli` | `wp-sync` CLI |
| `packages/obsidian-plugin` | Settings UI, ribbon, commands |
| `crawler` | Python crawl4ai runner |

## Quick start

```bash
npm install
npm test
npm run build

# Crawler (Python 3.10+)
cd crawler && python3 -m venv .venv && source .venv/bin/activate
pip install -U pip setuptools wheel && pip install -e ".[dev]" && crawl4ai-setup
cd ..

cp .env.example .env   # WP_USERNAME, WP_APPLICATION_PASSWORD, VAULT_PATH
```

### Register a site (CLI)

```bash
npm run wp-sync -- sites add \
  --id jsontoimg \
  --name "JSON to Image" \
  --public-url https://jsontoimg.com \
  --wp-api-url https://blog.skndan.com/jsontoimg \
  --vault "$VAULT_PATH"
```

### Migrate Phase-1 flat vault → `sites/<id>/`

```bash
npm run wp-sync -- sites migrate-flat \
  --site jsontoimg \
  --name "JSON to Image" \
  --public-url https://jsontoimg.com \
  --wp-api-url https://blog.skndan.com/jsontoimg \
  --vault "$VAULT_PATH"
```

### Sync

```bash
npm run wp-sync -- bootstrap --site jsontoimg --vault "$VAULT_PATH"
npm run wp-sync -- pull --site jsontoimg --vault "$VAULT_PATH"
npm run wp-sync -- validate --site jsontoimg --vault "$VAULT_PATH"
npm run wp-sync -- push --site jsontoimg --vault "$VAULT_PATH" --dry-run
```

## Obsidian plugin

```bash
npm run plugin:install -- /Users/equitasrmb/Documents/skndan/obsidian
```

Then in Obsidian: enable **WP Sync**, open **Settings → WP Sync**, set package root if needed, **Add site** (public URL + WP API URL + Application Password), pick active site, use ribbon or commands (Bootstrap / Pull / Push / Validate).

Credentials stay in plugin `data.json` — not in `sites.json` or git.

## Rules (unchanged)

- Obsidian deletes never delete WordPress (GET/POST only).
- Featured images required; placeholders never sync.
- Static notes are never pushed to WordPress.
