import type {
  HttpTransport,
  UploadMediaInput,
  UpsertPageInput,
  UpsertPostInput,
  WpCredentials,
  WpMediaItem,
  WpPage,
  WpPost,
  WpTerm,
} from './types.js';

export interface WpRestClient {
  listPosts(): Promise<WpPost[]>;
  listPages(): Promise<WpPage[]>;
  listCategories(): Promise<WpTerm[]>;
  listTags(): Promise<WpTerm[]>;
  listMedia(): Promise<WpMediaItem[]>;
  uploadMedia(input: UploadMediaInput): Promise<WpMediaItem>;
  upsertPost(input: UpsertPostInput): Promise<WpPost>;
  upsertPage(input: UpsertPageInput): Promise<WpPage>;
}

function basicAuthHeader(username: string, applicationPassword: string): string {
  const token = Buffer.from(`${username}:${applicationPassword}`).toString('base64');
  return `Basic ${token}`;
}

function apiRoot(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/wp-json/wp/v2`;
}

async function fetchAllPages<T>(
  transport: HttpTransport,
  baseUrl: string,
  auth: string,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}per_page=100&page=${page}`;
    const res = await transport({
      url,
      method: 'GET',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
      },
    });
    if (res.status === 400 || res.status === 404) {
      break;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`WP REST GET failed (${res.status}): ${res.body.slice(0, 300)}`);
    }
    const batch = JSON.parse(res.body) as T[];
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    items.push(...batch);
    const totalPages = Number(res.headers['x-wp-totalpages'] ?? res.headers['X-WP-TotalPages'] ?? '1');
    if (page >= totalPages || batch.length < 100) {
      break;
    }
    page += 1;
  }
  return items;
}

export function createNodeFetchTransport(): HttpTransport {
  return async (request) => {
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
    };
    if (request.body !== undefined) {
      init.body = request.body as NonNullable<RequestInit['body']>;
    }
    const res = await fetch(request.url, init);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const arrayBuffer = await res.arrayBuffer();
    const body = new TextDecoder().decode(arrayBuffer);
    return { status: res.status, headers, body, arrayBuffer };
  };
}

export function createWpRestClient(
  credentials: WpCredentials,
  transport: HttpTransport = createNodeFetchTransport(),
): WpRestClient {
  if (!credentials.siteUrl.startsWith('https://') && !credentials.siteUrl.startsWith('http://localhost')) {
    throw new Error('WP_SITE_URL must use HTTPS (or localhost for development)');
  }

  const auth = basicAuthHeader(credentials.username, credentials.applicationPassword);
  const root = apiRoot(credentials.siteUrl);

  return {
    async listPosts() {
      return fetchAllPages<WpPost>(
        transport,
        `${root}/posts?context=edit&status=publish,draft,private,pending,future`,
        auth,
      );
    },
    async listPages() {
      return fetchAllPages<WpPage>(
        transport,
        `${root}/pages?context=edit&status=publish,draft,private,pending,future`,
        auth,
      );
    },
    async listCategories() {
      return fetchAllPages<WpTerm>(transport, `${root}/categories?context=edit`, auth);
    },
    async listTags() {
      return fetchAllPages<WpTerm>(transport, `${root}/tags?context=edit`, auth);
    },
    async listMedia() {
      return fetchAllPages<WpMediaItem>(transport, `${root}/media?context=edit`, auth);
    },
    async uploadMedia(input) {
      const res = await transport({
        url: `${root}/media`,
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Disposition': `attachment; filename="${input.filename}"`,
          'Content-Type': input.mimeType,
          Accept: 'application/json',
        },
        body: input.bytes,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`WP media upload failed (${res.status}): ${res.body.slice(0, 300)}`);
      }
      return JSON.parse(res.body) as WpMediaItem;
    },
    async upsertPost(input) {
      const url = input.id ? `${root}/posts/${input.id}` : `${root}/posts`;
      const res = await transport({
        url,
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: input.title,
          content: input.content,
          slug: input.slug,
          status: input.status,
          categories: input.categories,
          tags: input.tags,
          featured_media: input.featured_media,
        }),
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`WP post upsert failed (${res.status}): ${res.body.slice(0, 300)}`);
      }
      return JSON.parse(res.body) as WpPost;
    },
    async upsertPage(input) {
      const url = input.id ? `${root}/pages/${input.id}` : `${root}/pages`;
      const res = await transport({
        url,
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          title: input.title,
          content: input.content,
          slug: input.slug,
          status: input.status,
          featured_media: input.featured_media,
        }),
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`WP page upsert failed (${res.status}): ${res.body.slice(0, 300)}`);
      }
      return JSON.parse(res.body) as WpPage;
    },
  };
}

/** Runtime guard: client type must never expose delete methods. */
export function assertNoDeleteMethods(client: WpRestClient): void {
  const forbidden = ['deletePost', 'deletePage', 'deleteMedia', 'delete'];
  for (const key of forbidden) {
    if (key in (client as object)) {
      throw new Error(`WpRestClient must not expose ${key}`);
    }
  }
}
