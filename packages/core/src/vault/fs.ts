import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

export async function writeText(filePath: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, contents, 'utf8');
}

export async function moveFile(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  await rename(from, to);
}

export async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export async function sha256Buffer(buf: Buffer | Uint8Array): Promise<string> {
  return createHash('sha256').update(buf).digest('hex');
}

export async function listFilesRecursive(
  rootDir: string,
  predicate?: (relPath: string) => boolean,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (!predicate || predicate(childRel.replace(/\\/g, '/'))) {
        results.push(childRel.replace(/\\/g, '/'));
      }
    }
  }

  await walk(rootDir, '');
  return results;
}

export function joinVault(vaultRoot: string, ...parts: string[]): string {
  return path.join(vaultRoot, ...parts);
}
