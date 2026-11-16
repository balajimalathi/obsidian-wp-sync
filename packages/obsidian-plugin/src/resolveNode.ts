import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Obsidian GUI apps often lack shell PATH (nvm/Homebrew). Find a real node binary. */
export function resolveNodePath(override?: string): string {
  if (override?.trim() && existsSync(override.trim())) {
    return override.trim();
  }

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates: string[] = [];

  if (process.execPath && path.basename(process.execPath).toLowerCase().includes('node')) {
    candidates.push(process.execPath);
  }

  // nvm: pick highest semver folder that has bin/node
  const nvmVersions = path.join(home, '.nvm', 'versions', 'node');
  if (existsSync(nvmVersions)) {
    try {
      const versions = readdirSync(nvmVersions)
        .filter((v) => v.startsWith('v'))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const v of versions) {
        candidates.push(path.join(nvmVersions, v, 'bin', 'node'));
      }
    } catch {
      // ignore
    }
  }

  candidates.push(
    path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  );

  // PATH entries (may be empty in Obsidian)
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    candidates.push(path.join(dir, 'node'));
  }

  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }

  throw new Error(
    'Node.js not found (Obsidian PATH often omits nvm). Set “Node binary” in Settings → WP Sync.',
  );
}

/** Prepend node’s bin dir so child processes can find npm/npx/tsx peers. */
export function envWithNodePath(
  nodePath: string,
  extra: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const binDir = path.dirname(nodePath);
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const current = process.env[pathKey] || process.env.PATH || '';
  const parts = current.split(path.delimiter).filter(Boolean);
  if (!parts.includes(binDir)) parts.unshift(binDir);

  // Common macOS locations Obsidian misses when launched from Dock
  for (const extraDir of ['/opt/homebrew/bin', '/usr/local/bin']) {
    if (existsSync(extraDir) && !parts.includes(extraDir)) parts.push(extraDir);
  }

  return {
    ...process.env,
    ...extra,
    [pathKey]: parts.join(path.delimiter),
  };
}
