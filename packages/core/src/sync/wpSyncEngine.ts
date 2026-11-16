import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  extractImagePaths,
  htmlToMarkdown,
  markdownToHtml,
  rewriteLocalImagePaths,
  rewriteWikilinksToUrls,
  stripHtmlEntitiesTitle,
} from '../markdown/converter.js';
import {
  buildUploadFilename,
  categoryFromVaultPath,
  extFromPath,
  findBySha256,
  loadMediaRegistry,
  registerWpMediaByHash,
  saveMediaRegistry,
  type MediaRegistry,
} from '../media/mediaRegistry.js';
import {
  createDefaultFrontmatter,
  parseVaultNote,
  serializeVaultNote,
  type VaultNoteFrontmatter,
} from '../schema/frontmatter.js';
import {
  assertPushable,
  validateVault,
} from '../validator/vaultValidator.js';
import type { WpRestClient } from '../wp/wpRestClient.js';
import type { WpMediaItem, WpPage, WpPost, WpTerm } from '../wp/types.js';
import {
  ensureDir,
  joinVault,
  listFilesRecursive,
  moveFile,
  pathExists,
  readText,
  sha256Buffer,
  sha256File,
  writeText,
} from '../vault/fs.js';
import {
  ARCHIVE_DELETED_ON_WP_DIR,
  clusterNotePath,
  pageNotePath,
  pillarIndexPath,
} from '../vault/paths.js';

export interface SyncEngineOptions {
  vaultRoot: string;
  client: WpRestClient;
  dryRun?: boolean;
  allowDraftLinks?: boolean;
}

export interface SyncResult {
  pulled: string[];
  pushed: string[];
  archived: string[];
  uploadedMedia: string[];
  skipped: string[];
  dryRun: boolean;
}

function contentHash(frontmatter: VaultNoteFrontmatter, body: string): string {
  return createHash('sha256')
    .update(JSON.stringify(frontmatter) + '\n' + body)
    .digest('hex');
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.avif':
      return 'image/avif';
    default:
      return 'application/octet-stream';
  }
}

async function loadManagedNotes(
  vaultRoot: string,
): Promise<Array<{ path: string; frontmatter: VaultNoteFrontmatter; body: string }>> {
  const files = await listFilesRecursive(vaultRoot, (rel) => {
    const n = rel.replace(/\\/g, '/');
    if (!n.endsWith('.md')) return false;
    if (n.startsWith('.wp-sync/') || n.startsWith('.obsidian/') || n.startsWith('_archive/')) {
      return false;
    }
    return true;
  });
  const notes = [];
  for (const rel of files) {
    const raw = await readText(joinVault(vaultRoot, rel));
    try {
      const parsed = parseVaultNote(raw);
      notes.push({ path: rel.replace(/\\/g, '/'), ...parsed });
    } catch {
      // skip unmanaged
    }
  }
  return notes;
}

function titleOf(item: WpPost | WpPage): string {
  return stripHtmlEntitiesTitle(item.title.raw ?? item.title.rendered ?? item.slug);
}

function statusOf(item: WpPost | WpPage): 'draft' | 'publish' | 'private' {
  if (item.status === 'private') return 'private';
  if (item.status === 'publish') return 'publish';
  return 'draft';
}

function normalizeUrlPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

async function downloadAndHashMedia(
  item: WpMediaItem,
): Promise<{ sha256: string; bytes: Uint8Array } | null> {
  // Prefer hashing via fetching source_url through a simple fetch when available
  try {
    const res = await fetch(item.source_url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const sha256 = await sha256Buffer(buf);
    return { sha256, bytes: buf };
  } catch {
    return null;
  }
}

export async function pullFromWordPress(options: SyncEngineOptions): Promise<SyncResult> {
  const { vaultRoot, client, dryRun = false } = options;
  const result: SyncResult = {
    pulled: [],
    pushed: [],
    archived: [],
    uploadedMedia: [],
    skipped: [],
    dryRun,
  };

  const [posts, pages, categories, media] = await Promise.all([
    client.listPosts(),
    client.listPages(),
    client.listCategories(),
    client.listMedia(),
  ]);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const localNotes = await loadManagedNotes(vaultRoot);

  let registry = await loadMediaRegistry(vaultRoot);

  // Index remote media hashes when we can download them (best-effort; skip in dryRun network heavy ops still ok)
  for (const m of media) {
    const hashed = await downloadAndHashMedia(m);
    if (!hashed) continue;
    if (!registry.entries[hashed.sha256]) {
      const category = 'imported';
      const filename = path.basename(new URL(m.source_url).pathname) || `media-${m.id}`;
      const vaultPath = `assets/images/${category}/${filename}`;
      if (!dryRun) {
        const abs = joinVault(vaultRoot, vaultPath);
        if (!(await pathExists(abs))) {
          await ensureDir(path.dirname(abs));
          const { writeFile } = await import('node:fs/promises');
          await writeFile(abs, hashed.bytes);
        }
      }
      registry = registerWpMediaByHash(registry, {
        sha256: hashed.sha256,
        vaultPath: `assets/images/${category}/${filename}`,
        category,
        wpMediaId: m.id,
        wpSourceUrl: m.source_url,
      });
    } else if (!registry.entries[hashed.sha256]!.wpMediaId) {
      registry.entries[hashed.sha256]!.wpMediaId = m.id;
      registry.entries[hashed.sha256]!.wpSourceUrl = m.source_url;
    }
  }
  if (!dryRun) {
    await saveMediaRegistry(vaultRoot, registry);
  }

  const remoteIds = new Set<number>();

  const postsByCategory = new Map<string, WpPost[]>();
  for (const post of posts) {
    remoteIds.add(post.id);
    const catId = post.categories?.[0];
    const catSlug = (catId != null ? catById.get(catId)?.slug : null) ?? 'uncategorized';
    const list = postsByCategory.get(catSlug) ?? [];
    list.push(post);
    postsByCategory.set(catSlug, list);
  }

  for (const [catSlug, catPosts] of postsByCategory) {
    const sorted = [...catPosts].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    const pillarPost = sorted.find((p) => p.slug === catSlug) ?? sorted[0]!;
    const clusters = sorted.filter((p) => p.id !== pillarPost.id);

    const writePost = async (
      post: WpPost,
      role: 'pillar' | 'cluster',
      notePath: string,
    ) => {
      const featuredPath =
        post.featured_media && registry
          ? Object.values(registry.entries).find((e) => e.wpMediaId === post.featured_media)
              ?.vaultPath ?? null
          : null;
      const fm = createDefaultFrontmatter({
        title: titleOf(post),
        source: 'wordpress',
        role,
        wp_id: post.id,
        wp_type: 'post',
        slug: post.slug,
        url_path: normalizeUrlPath(post.link),
        status: statusOf(post),
        pillar: catSlug,
        categories: [catSlug],
        tags: [],
        featured_image: featuredPath,
        last_synced_hash: null,
      });
      const body = htmlToMarkdown(post.content.raw ?? post.content.rendered ?? '');
      fm.last_synced_hash = contentHash(fm, body);
      if (!dryRun) {
        await writeText(joinVault(vaultRoot, notePath), serializeVaultNote(fm, body));
      }
      result.pulled.push(notePath);
    };

    await writePost(pillarPost, 'pillar', pillarIndexPath(catSlug));
    for (const post of clusters) {
      await writePost(post, 'cluster', clusterNotePath(catSlug, post.slug));
    }
  }

  for (const page of pages) {
    remoteIds.add(page.id);
    const notePath = pageNotePath(page.slug);
    const featuredPath = page.featured_media
      ? Object.values(registry.entries).find((e) => e.wpMediaId === page.featured_media)
          ?.vaultPath ?? null
      : null;
    const fm = createDefaultFrontmatter({
      title: titleOf(page),
      source: 'wordpress',
      role: 'page',
      wp_id: page.id,
      wp_type: 'page',
      slug: page.slug,
      url_path: normalizeUrlPath(page.link),
      status: statusOf(page),
      pillar: null,
      categories: [],
      tags: [],
      featured_image: featuredPath,
      last_synced_hash: null,
    });
    const body = htmlToMarkdown(page.content.raw ?? page.content.rendered ?? '');
    fm.last_synced_hash = contentHash(fm, body);
    if (!dryRun) {
      await writeText(joinVault(vaultRoot, notePath), serializeVaultNote(fm, body));
    }
    result.pulled.push(notePath);
  }

  // Archive local notes whose wp_id no longer exists remotely
  for (const note of localNotes) {
    if (note.frontmatter.source !== 'wordpress' || note.frontmatter.wp_id == null) continue;
    if (remoteIds.has(note.frontmatter.wp_id)) continue;
    const dest = `${ARCHIVE_DELETED_ON_WP_DIR}/${note.path}`;
    if (!dryRun) {
      await moveFile(joinVault(vaultRoot, note.path), joinVault(vaultRoot, dest));
    }
    result.archived.push(note.path);
  }

  return result;
}

async function ensureMediaUploaded(
  vaultRoot: string,
  vaultPath: string,
  slug: string,
  client: WpRestClient,
  registry: MediaRegistry,
  dryRun: boolean,
  uploaded: string[],
): Promise<{ mediaId: number | null; sourceUrl: string | null; registry: MediaRegistry }> {
  const abs = joinVault(vaultRoot, vaultPath);
  const sha256 = await sha256File(abs);
  const existing = findBySha256(registry, sha256);
  if (existing?.wpMediaId && existing.wpSourceUrl) {
    return {
      mediaId: existing.wpMediaId,
      sourceUrl: existing.wpSourceUrl,
      registry,
    };
  }

  const category = categoryFromVaultPath(vaultPath);
  const filename = buildUploadFilename(category, slug, sha256, extFromPath(vaultPath));
  if (dryRun) {
    uploaded.push(`${vaultPath} → (dry-run) ${filename}`);
    return { mediaId: null, sourceUrl: null, registry };
  }

  const bytes = new Uint8Array(await readFile(abs));
  const media = await client.uploadMedia({
    filename,
    bytes,
    mimeType: mimeFromExt(extFromPath(vaultPath)),
  });
  registry = registerWpMediaByHash(registry, {
    sha256,
    vaultPath: existing?.vaultPath ?? vaultPath,
    category,
    wpMediaId: media.id,
    wpSourceUrl: media.source_url,
  });
  await saveMediaRegistry(vaultRoot, registry);
  uploaded.push(vaultPath);
  return { mediaId: media.id, sourceUrl: media.source_url, registry };
}

export async function pushToWordPress(options: SyncEngineOptions): Promise<SyncResult> {
  const { vaultRoot, client, dryRun = false, allowDraftLinks = false } = options;
  const result: SyncResult = {
    pulled: [],
    pushed: [],
    archived: [],
    uploadedMedia: [],
    skipped: [],
    dryRun,
  };

  const issues = await validateVault(vaultRoot, { allowDraftLinks });
  // Only push wordpress notes — filter static errors for notes we won't push
  const wordpressNotes = (await loadManagedNotes(vaultRoot)).filter(
    (n) => n.frontmatter.source === 'wordpress',
  );
  const relevantIssues = issues.filter(
    (i) =>
      i.code === 'duplicate_images' ||
      (i.notePath != null && wordpressNotes.some((n) => n.path === i.notePath)),
  );
  assertPushable(relevantIssues);

  let registry = await loadMediaRegistry(vaultRoot);
  const categories = await client.listCategories();
  const catIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  const notesBySlug = new Map(wordpressNotes.map((n) => [n.frontmatter.slug, n]));
  const notesByPath = new Map(wordpressNotes.map((n) => [n.path, n]));

  for (const note of wordpressNotes) {
    const fm = note.frontmatter;
    let body = note.body;
    let registryMut = registry;

    // Upload featured + inline images
    const imagePaths = new Set(extractImagePaths(body));
    if (fm.featured_image) imagePaths.add(fm.featured_image);

    const urlByLocal = new Map<string, string>();
    let featuredMediaId: number | undefined;

    for (const imgPath of imagePaths) {
      const normalized = imgPath.replace(/^\.\//, '');
      const { mediaId, sourceUrl, registry: next } = await ensureMediaUploaded(
        vaultRoot,
        normalized,
        fm.slug,
        client,
        registryMut,
        dryRun,
        result.uploadedMedia,
      );
      registryMut = next;
      if (sourceUrl) urlByLocal.set(normalized, sourceUrl);
      if (fm.featured_image && normalized === fm.featured_image.replace(/^\.\//, '') && mediaId) {
        featuredMediaId = mediaId;
      }
    }
    registry = registryMut;

    body = rewriteWikilinksToUrls(body, (target) => {
      const cleaned = target.replace(/\.md$/i, '');
      const hit =
        notesByPath.get(cleaned) ||
        notesByPath.get(`${cleaned}.md`) ||
        notesBySlug.get(cleaned.split('/').pop() ?? cleaned);
      return hit?.frontmatter.url_path ?? null;
    });
    body = rewriteLocalImagePaths(body, (local) => urlByLocal.get(local.replace(/^\.\//, '')) ?? null);

    const html = markdownToHtml(body);
    const categoryIds = fm.categories
      .map((slug) => catIdBySlug.get(slug))
      .filter((id): id is number => id != null);

    if (dryRun) {
      result.pushed.push(note.path);
      continue;
    }

    if (fm.wp_type === 'page' || fm.role === 'page') {
      const page = await client.upsertPage({
        id: fm.wp_id ?? undefined,
        title: fm.title,
        content: html,
        slug: fm.slug,
        status: fm.status,
        featured_media: featuredMediaId,
      });
      fm.wp_id = page.id;
      fm.wp_type = 'page';
      fm.url_path = normalizeUrlPath(page.link);
    } else {
      const post = await client.upsertPost({
        id: fm.wp_id ?? undefined,
        title: fm.title,
        content: html,
        slug: fm.slug,
        status: fm.status,
        categories: categoryIds,
        featured_media: featuredMediaId,
      });
      fm.wp_id = post.id;
      fm.wp_type = 'post';
      fm.url_path = normalizeUrlPath(post.link);
    }

    fm.last_synced_hash = contentHash(fm, note.body);
    await writeText(joinVault(vaultRoot, note.path), serializeVaultNote(fm, note.body));
    result.pushed.push(note.path);
  }

  if (!dryRun) {
    await saveMediaRegistry(vaultRoot, registry);
  }

  return result;
}

export type { WpTerm };
