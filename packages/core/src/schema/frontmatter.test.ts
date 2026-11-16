import { describe, expect, it } from 'vitest';
import {
  createDefaultFrontmatter,
  parseVaultNote,
  serializeVaultNote,
} from './frontmatter.js';

describe('frontmatter', () => {
  it('parses and round-trips a vault note', () => {
    const fm = createDefaultFrontmatter({
      title: 'Hello',
      source: 'wordpress',
      role: 'cluster',
      slug: 'hello',
      url_path: '/blog/hello',
      pillar: 'seo',
      wp_id: 12,
      wp_type: 'post',
      status: 'publish',
      categories: ['seo'],
      featured_image: 'assets/images/seo/hero.png',
    });
    const raw = serializeVaultNote(fm, 'Body text\n');
    const parsed = parseVaultNote(raw);
    expect(parsed.frontmatter.title).toBe('Hello');
    expect(parsed.frontmatter.source).toBe('wordpress');
    expect(parsed.frontmatter.wp_id).toBe(12);
    expect(parsed.body.trim()).toBe('Body text');
  });

  it('rejects invalid source values', () => {
    expect(() =>
      parseVaultNote(`---
title: X
source: ghost
role: page
wp_id: null
wp_type: null
slug: x
url_path: /x
status: draft
pillar: null
categories: []
tags: []
featured_image: null
last_synced_hash: null
---
`),
    ).toThrow();
  });
});
