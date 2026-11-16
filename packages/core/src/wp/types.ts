export interface WpTerm {
  id: number;
  name: string;
  slug: string;
  parent?: number;
}

export interface WpMediaItem {
  id: number;
  source_url: string;
  slug: string;
  title: string;
  mime_type: string;
  media_details?: {
    file?: string;
    sizes?: Record<string, { source_url: string }>;
  };
}

export interface WpPost {
  id: number;
  slug: string;
  status: 'draft' | 'publish' | 'private' | 'pending' | 'future';
  type: 'post';
  title: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string };
  excerpt?: { rendered: string; raw?: string };
  link: string;
  categories: number[];
  tags: number[];
  featured_media: number;
  modified_gmt?: string;
}

export interface WpPage {
  id: number;
  slug: string;
  status: 'draft' | 'publish' | 'private' | 'pending' | 'future';
  type: 'page';
  title: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string };
  link: string;
  featured_media: number;
  parent?: number;
  modified_gmt?: string;
}

export interface UploadMediaInput {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
  altText?: string;
}

export interface UpsertPostInput {
  id?: number;
  title: string;
  content: string;
  slug: string;
  status: 'draft' | 'publish' | 'private';
  categories?: number[];
  tags?: number[];
  featured_media?: number;
}

export interface UpsertPageInput {
  id?: number;
  title: string;
  content: string;
  slug: string;
  status: 'draft' | 'publish' | 'private';
  featured_media?: number;
}

export interface WpCredentials {
  siteUrl: string;
  username: string;
  applicationPassword: string;
}

export type HttpMethod = 'GET' | 'POST';

export interface HttpRequest {
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  arrayBuffer?: ArrayBuffer;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;
