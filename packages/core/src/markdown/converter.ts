import { marked } from 'marked';
import TurndownService from 'turndown';
// turndown-plugin-gfm ships CJS; named `tables` / `gfm` exports convert HTML tables to GFM pipes.
import { tables as turndownTables } from 'turndown-plugin-gfm';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

turndown.use(turndownTables);

turndown.addRule('wordpressImage', {
  filter: 'img',
  replacement(_content, node) {
    const el = node as unknown as { getAttribute(name: string): string | null };
    const alt = el.getAttribute('alt') ?? '';
    const src = el.getAttribute('src') ?? '';
    return src ? `![${alt}](${src})` : '';
  },
});

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  return turndown.turndown(html).trim() + '\n';
}

export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return html.trim();
}

const WIKILINK_RE = /!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const MD_LINK_RE = /(!?\[[^\]]*\]\()([^)]+)(\))/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

export function extractWikilinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(WIKILINK_RE)) {
    const target = match[1]?.trim();
    if (target) targets.push(target);
  }
  return targets;
}

export function extractMarkdownLinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(MD_LINK_RE)) {
    const href = match[2]?.trim();
    if (!href) continue;
    if (/^(https?:|mailto:|#)/i.test(href)) continue;
    targets.push(href);
  }
  return targets;
}

export function extractImagePaths(markdown: string): string[] {
  const paths: string[] = [];
  for (const match of markdown.matchAll(MD_IMAGE_RE)) {
    const src = match[1]?.trim();
    if (src && !/^https?:/i.test(src)) {
      paths.push(src);
    }
  }
  // Wikilink images: ![[path]]
  for (const match of markdown.matchAll(/!\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1]?.trim();
    if (target) paths.push(target);
  }
  return paths;
}

export function rewriteWikilinksToUrls(
  markdown: string,
  resolve: (target: string) => string | null,
): string {
  return markdown.replace(WIKILINK_RE, (full, target: string, alias?: string) => {
    const isEmbed = full.startsWith('!');
    const url = resolve(target.trim());
    if (!url) return full;
    const text = (alias ?? target).trim();
    return isEmbed ? `![${text}](${url})` : `[${text}](${url})`;
  });
}

export function rewriteLocalImagePaths(
  markdown: string,
  resolve: (localPath: string) => string | null,
): string {
  return markdown.replace(MD_IMAGE_RE, (full, src: string) => {
    if (/^https?:/i.test(src)) return full;
    const url = resolve(src);
    if (!url) return full;
    return full.replace(src, url);
  });
}

export function stripHtmlEntitiesTitle(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}
