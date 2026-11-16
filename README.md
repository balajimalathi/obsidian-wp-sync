# obsidian-wp-sync

Phase 1: Shared vault schema, `crawl4ai` site bootstrapper, and CLI for bidirectional WordPress content sync with Obsidian.

**Target vault:** `/Users/equitasrmb/Documents/skndan/obsidian`

## Packages

- `packages/core` — Shared TypeScript sync engine (schema, media registry, validator, WP REST client, reconciler, sync)
- `packages/cli` — `wp-sync` CLI (`bootstrap`, `inventory`, `validate`, `pull`, `push`)
- `crawler` — Python `crawl4ai` site crawler

## Quick start

```bash
npm install
npm test
npm run build

# Python crawler (Python 3.10+ recommended for crawl4ai)
cd crawler
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip setuptools wheel
pip install -e ".[dev]"
crawl4ai-setup   # installs browser deps for crawl4ai
cd ..

cp .env.example .env   # set WP_SITE_URL, WP_USERNAME, WP_APPLICATION_PASSWORD, VAULT_PATH
npm run wp-sync -- bootstrap --vault /Users/equitasrmb/Documents/skndan/obsidian
```

## CLI commands

| Command | Purpose |
| --- | --- |
| `wp-sync bootstrap` | Crawl site + pull WP REST → vault layout + inventory |
| `wp-sync inventory` | Rebuild wordpress vs static inventory |
| `wp-sync validate` | Featured image / placeholder / link checks |
| `wp-sync pull` | Pull WP content; archive local notes for WP-deleted IDs |
| `wp-sync push` | Validate + upload unique media + upsert posts/pages (never deletes WP) |

All mutating commands accept `--dry-run`. Deleting a note in Obsidian never deletes WordPress content.
