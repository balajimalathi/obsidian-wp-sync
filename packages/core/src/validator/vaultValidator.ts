import path from 'node:path';
import {
  extractImagePaths,
  extractMarkdownLinkTargets,
  extractWikilinkTargets,
} from '../markdown/converter.js';
import { findDuplicateImageGroups } from '../media/mediaRegistry.js';
import {
  parseVaultNote,
  type VaultNoteFrontmatter,
} from '../schema/frontmatter.js';
import { joinVault, listFilesRecursive, pathExists, readText } from '../vault/fs.js';
import {
  ASSETS_IMAGES_DIR,
  isPlaceholderPath,
  isUnderSite,
  pillarIndexPath,
  siteRoot,
} from '../vault/paths.js';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  notePath?: string;
}

export interface ValidateOptions {
  allowDraftLinks?: boolean;
  /** If set, only validate these note paths (relative to vault). */
  notePaths?: string[];
}

export interface VaultNoteRecord {
  path: string;
  frontmatter: VaultNoteFrontmatter;
  body: string;
}

async function loadVaultNotes(
  vaultRoot: string,
  siteId: string,
): Promise<VaultNoteRecord[]> {
  const prefix = `${siteRoot(siteId)}/`;
  const mdFiles = await listFilesRecursive(vaultRoot, (rel) => {
    const n = rel.replace(/\\/g, '/');
    if (!n.endsWith('.md')) return false;
    if (!isUnderSite(siteId, n)) return false;
    if (n.includes('/.wp-sync/')) return false;
    if (n.includes('/_archive/')) return false;
    if (n.startsWith('.obsidian/')) return false;
    return n.startsWith(prefix);
  });

  const notes: VaultNoteRecord[] = [];
  for (const rel of mdFiles) {
    const abs = joinVault(vaultRoot, rel);
    const raw = await readText(abs);
    try {
      const parsed = parseVaultNote(raw);
      notes.push({ path: rel.replace(/\\/g, '/'), ...parsed });
    } catch {
      // Notes without wp-sync frontmatter are ignored by the validator.
    }
  }
  return notes;
}

function resolveLinkTarget(
  fromNotePath: string,
  target: string,
  notesByPath: Map<string, VaultNoteRecord>,
  notesBySlug: Map<string, VaultNoteRecord>,
): VaultNoteRecord | null {
  const cleaned = target.replace(/\.md$/i, '').replace(/\\/g, '/');

  const candidates = [
    cleaned,
    `${cleaned}.md`,
    cleaned.endsWith('/index') ? `${cleaned}.md` : `${cleaned}/index.md`,
  ];

  const fromDir = path.posix.dirname(fromNotePath);
  for (const c of candidates) {
    const hit = notesByPath.get(c) ?? notesByPath.get(path.posix.join(fromDir, c));
    if (hit) return hit;
  }

  const basename = cleaned.split('/').pop() ?? cleaned;
  return notesBySlug.get(basename) ?? null;
}

export async function validateVault(
  vaultRoot: string,
  siteId: string,
  options: ValidateOptions = {},
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const notes = await loadVaultNotes(vaultRoot, siteId);
  const selected = options.notePaths
    ? notes.filter((n) => options.notePaths!.includes(n.path))
    : notes;

  const notesByPath = new Map(notes.map((n) => [n.path, n]));
  const notesBySlug = new Map(notes.map((n) => [n.frontmatter.slug, n]));

  const duplicates = await findDuplicateImageGroups(vaultRoot, siteId);
  for (const group of duplicates) {
    issues.push({
      severity: 'error',
      code: 'duplicate_images',
      message: `Duplicate SHA-256 ${group.sha256.slice(0, 8)}…: canonical ${group.canonicalPath}; duplicates: ${group.duplicatePaths.join(', ')}`,
    });
  }

  for (const note of selected) {
    const fm = note.frontmatter;

    if (fm.source === 'static') {
      issues.push({
        severity: 'error',
        code: 'static_source',
        notePath: note.path,
        message: `Static note cannot be pushed to WordPress: ${note.path}`,
      });
      continue;
    }

    if (fm.source === 'wordpress') {
      if (!fm.featured_image) {
        issues.push({
          severity: 'error',
          code: 'missing_featured_image',
          notePath: note.path,
          message: `Featured image is required for ${note.path}`,
        });
      } else {
        if (isPlaceholderPath(fm.featured_image)) {
          issues.push({
            severity: 'error',
            code: 'placeholder_featured_image',
            notePath: note.path,
            message: `Featured image is a placeholder and cannot sync: ${fm.featured_image}`,
          });
        }
        const featuredAbs = joinVault(vaultRoot, fm.featured_image);
        if (!(await pathExists(featuredAbs))) {
          issues.push({
            severity: 'error',
            code: 'featured_image_missing_file',
            notePath: note.path,
            message: `Featured image file not found: ${fm.featured_image}`,
          });
        }
      }
    }

    const imagePaths = extractImagePaths(note.body);
    if (fm.featured_image) imagePaths.push(fm.featured_image);
    for (const img of imagePaths) {
      if (isPlaceholderPath(img)) {
        issues.push({
          severity: 'error',
          code: 'placeholder_image',
          notePath: note.path,
          message: `Placeholder image blocks sync: ${img}`,
        });
      }
    }

    if (fm.role === 'cluster') {
      if (!fm.pillar) {
        issues.push({
          severity: 'error',
          code: 'cluster_missing_pillar',
          notePath: note.path,
          message: `Cluster note ${note.path} is missing pillar frontmatter`,
        });
      } else {
        const pillarPath = pillarIndexPath(siteId, fm.pillar);
        if (!notesByPath.has(pillarPath)) {
          issues.push({
            severity: 'error',
            code: 'missing_pillar_index',
            notePath: note.path,
            message: `Cluster ${note.path} references missing pillar index ${pillarPath}`,
          });
        }
      }
    }

    const linkTargets = [
      ...extractWikilinkTargets(note.body),
      ...extractMarkdownLinkTargets(note.body),
    ];

    for (const target of linkTargets) {
      if (
        target.includes(`/${ASSETS_IMAGES_DIR}/`) ||
        target.startsWith(`${ASSETS_IMAGES_DIR}/`) ||
        target.startsWith('assets/')
      ) {
        continue;
      }
      const resolved = resolveLinkTarget(note.path, target, notesByPath, notesBySlug);
      if (!resolved) {
        issues.push({
          severity: 'error',
          code: 'broken_link',
          notePath: note.path,
          message: `Broken internal link from ${note.path} → ${target}`,
        });
        continue;
      }
      if (
        !options.allowDraftLinks &&
        fm.status === 'publish' &&
        resolved.frontmatter.status === 'draft'
      ) {
        issues.push({
          severity: 'error',
          code: 'publish_to_draft_link',
          notePath: note.path,
          message: `Published note ${note.path} links to draft ${resolved.path}`,
        });
      }
    }
  }

  return issues;
}

export function assertPushable(issues: ValidationIssue[]): void {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    const summary = errors.map((e) => `- [${e.code}] ${e.message}`).join('\n');
    throw new Error(`Validation failed (${errors.length} error(s)):\n${summary}`);
  }
}
