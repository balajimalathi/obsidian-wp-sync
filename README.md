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
cd crawler && pip install -e ".[dev]" && crawl4ai-setup
cp .env.example .env   # set WP credentials + site URL
npx wp-sync bootstrap --vault /path/to/vault
```
