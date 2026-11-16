import { describe, expect, it } from 'vitest';
import {
  assertNoDeleteMethods,
  createWpRestClient,
} from './wpRestClient.js';
import type { HttpTransport } from './types.js';

describe('wpRestClient', () => {
  it('sends basic auth and never exposes delete methods', async () => {
    const calls: Array<{ url: string; method: string; headers?: Record<string, string> }> = [];
    const transport: HttpTransport = async (req) => {
      calls.push({ url: req.url, method: req.method, headers: req.headers });
      return {
        status: 200,
        headers: { 'x-wp-totalpages': '1' },
        body: JSON.stringify([{ id: 1, slug: 'hello', status: 'publish', type: 'post', title: { rendered: 'Hi', raw: 'Hi' }, content: { rendered: '', raw: '' }, link: 'https://example.com/hello', categories: [], tags: [], featured_media: 0 }]),
      };
    };

    const client = createWpRestClient(
      {
        siteUrl: 'https://example.com',
        username: 'admin',
        applicationPassword: 'abcd efgh',
      },
      transport,
    );

    assertNoDeleteMethods(client);
    const posts = await client.listPosts();
    expect(posts).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers?.Authorization?.startsWith('Basic ')).toBe(true);
    expect('deletePost' in client).toBe(false);
  });

  it('upserts posts via POST', async () => {
    const transport: HttpTransport = async (req) => {
      expect(req.method).toBe('POST');
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: 9,
          slug: 'new',
          status: 'draft',
          type: 'post',
          title: { rendered: 'New', raw: 'New' },
          content: { rendered: '<p>x</p>', raw: '<p>x</p>' },
          link: 'https://example.com/new',
          categories: [],
          tags: [],
          featured_media: 0,
        }),
      };
    };
    const client = createWpRestClient(
      {
        siteUrl: 'https://example.com',
        username: 'admin',
        applicationPassword: 'pass',
      },
      transport,
    );
    const post = await client.upsertPost({
      title: 'New',
      content: '<p>x</p>',
      slug: 'new',
      status: 'draft',
    });
    expect(post.id).toBe(9);
  });
});
