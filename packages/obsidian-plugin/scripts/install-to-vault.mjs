#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vault =
  process.argv[2] ||
  process.env.VAULT_PATH ||
  '/Users/equitasrmb/Documents/skndan/obsidian';
const dest = path.join(vault, '.obsidian', 'plugins', 'obsidian-wp-sync');

await mkdir(dest, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  await cp(path.join(pluginRoot, file), path.join(dest, file), { force: true });
}

// Seed packageRoot into data.json if missing
const dataPath = path.join(dest, 'data.json');
let data = {};
try {
  data = JSON.parse(await readFile(dataPath, 'utf8'));
} catch {
  data = {};
}
if (!data.packageRoot) {
  data.packageRoot = path.resolve(pluginRoot, '../..');
  data.activeSiteId = data.activeSiteId ?? null;
  data.credentials = data.credentials ?? {};
  data.lastStatus = data.lastStatus ?? '';
  await writeFile(dataPath, JSON.stringify(data, null, 2) + '\n');
}

console.log(`Installed WP Sync plugin → ${dest}`);
console.log(`packageRoot → ${data.packageRoot}`);
