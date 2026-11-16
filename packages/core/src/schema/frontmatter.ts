import matter from 'gray-matter';
import { z } from 'zod';

export const VaultNoteFrontmatterSchema = z.object({
  title: z.string().min(1),
  source: z.enum(['wordpress', 'static']),
  role: z.enum(['pillar', 'cluster', 'page', 'static']),
  wp_id: z.number().int().positive().nullable(),
  wp_type: z.enum(['post', 'page']).nullable(),
  slug: z.string().min(1),
  url_path: z.string().min(1),
  status: z.enum(['draft', 'publish', 'private']),
  pillar: z.string().nullable(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  featured_image: z.string().nullable(),
  last_synced_hash: z.string().nullable(),
});

export type VaultNoteFrontmatter = z.infer<typeof VaultNoteFrontmatterSchema>;

export interface ParsedVaultNote {
  frontmatter: VaultNoteFrontmatter;
  body: string;
  raw: string;
}

export function parseVaultNote(raw: string): ParsedVaultNote {
  const parsed = matter(raw);
  const frontmatter = VaultNoteFrontmatterSchema.parse(parsed.data);
  return {
    frontmatter,
    body: parsed.content.replace(/^\n/, ''),
    raw,
  };
}

export function serializeVaultNote(
  frontmatter: VaultNoteFrontmatter,
  body: string,
): string {
  const validated = VaultNoteFrontmatterSchema.parse(frontmatter);
  return matter.stringify(body.replace(/^\n+/, ''), validated);
}

export function createDefaultFrontmatter(
  partial: Partial<VaultNoteFrontmatter> &
    Pick<VaultNoteFrontmatter, 'title' | 'source' | 'role' | 'slug' | 'url_path'>,
): VaultNoteFrontmatter {
  return VaultNoteFrontmatterSchema.parse({
    wp_id: null,
    wp_type: null,
    status: 'draft',
    pillar: null,
    categories: [],
    tags: [],
    featured_image: null,
    last_synced_hash: null,
    ...partial,
  });
}
