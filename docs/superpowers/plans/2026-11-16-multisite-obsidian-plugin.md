# Multi-site Obsidian Plugin Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Multi-site vault under `sites/<id>/` with Obsidian Settings UI to add sites and sync (no default slug).

**Architecture:** Core site registry + site-scoped paths; CLI requires `--site`; Obsidian plugin wraps core with Settings/commands/ribbon.

**Tech Stack:** TypeScript, npm workspaces, Obsidian plugin API (`obsidian` package), existing `@obsidian-wp-sync/core`.

## Global Constraints

- No `DEFAULT_SITE_SLUG` — every operation requires explicit `siteId`
- Secrets only in Obsidian plugin `data.json` (or CLI env), never in `sites.json`
- Vault paths: `sites/<id>/{pillars,pages,static,assets,_archive,.wp-sync}`
- Global registry: `.wp-sync/sites.json`

---

### Task 1: Site registry + paths

- [ ] Rewrite `packages/core/src/vault/paths.ts` → `sites/<id>/…`, remove default slug
- [ ] Add `packages/core/src/sites/registry.ts` + tests
- [ ] Export from `index.ts`

### Task 2: Wire core for `siteId`

- [ ] Pass `siteId` through reconciler, media, validator, sync, bootstrap
- [ ] Update unit tests
- [ ] CLI: `--site` required + `sites list|add`

### Task 3: Obsidian plugin

- [ ] Scaffold `packages/obsidian-plugin` (manifest, main, settings, modal)
- [ ] Commands + ribbon for bootstrap/pull/push/validate
- [ ] Wire into workspace build

### Task 4: Vault migrate + validate

- [ ] Migrator / bootstrap seed for `jsontoimg`
- [ ] Update README; run tests
