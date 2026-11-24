/**
 * The Usermaven proxy, shared by every PhonicScore site that sends its
 * statistics through its own domain. The visitor's browser then talks to the
 * site only: `Analytics` (components/Analytics.astro) with
 * `src="/um/lib.js" trackingHost="/um"` loads the script and sends its events
 * here, and the Worker passes them on.
 *
 *   GET  /um/lib.js              t.usermaven.com/lib.js, kept a day
 *   POST /um/api/v1/event        events.usermaven.com/api/v1/event
 *   POST /um/api/v1/s2s/event    events.usermaven.com/api/v1/s2s/event, the script's fallback path
 *
 * Any other path under /um/ answers 404.
 *
 * Usermaven's cookieless mode counts visitors by a hash of IP address and
 * browser, so the visitor's IP goes along in X-Forwarded-For, and every event
 * asks Usermaven to shorten it before processing (ip_policy=strict) and to set
 * no cookie (cookie_policy=strict). The Worker writes those two itself,
 * whatever the browser asked for. Cookies from upstream are dropped: no answer
 * sets one. A browser that sends the Global Privacy Control signal
 * (Sec-GPC: 1) is not counted: its events end here with 204.
 *
 * Only events for the site's own workspace go on:
 *
 * - every `token` in the query is the site's key, and there is at least one;
 *   an `api_key` in the query is the site's key too;
 * - the upstream query is written by the Worker: the key and the two policies,
 *   nothing from the browser's query;
 * - the body is parsed as JSON (not JSON: 400), so a key written with escapes
 *   is read as the key it is, and every `api_key` at any depth is the site's;
 * - a body over 64 KB is refused (413) by its Content-Length and, whatever that
 *   says, by what is read.
 *
 * A refused event answers 403 and nothing goes upstream. An event the script
 * sends looks exactly as before: a JSON array of events whose `api_key` is the
 * site's key, posted to /um/api/v1/event?token=<key>&cookie_policy=strict&ip_policy=strict,
 * is forwarded byte for byte. Upstream failures answer 502 with no body.
 *
 *   // worker/analytics.ts in a site
 *   import { createAnalyticsProxy } from '@phonicscore/astro-kit/worker/analytics.ts';
 *   export const { isAnalyticsPath, analytics } = createAnalyticsProxy({ key: 'UMxxxxxxxx' });
 *
 *   // worker/index.ts
 *   if (isAnalyticsPath(url.pathname)) return analytics(request);
 *
 * The key is the workspace key the site passes to `Analytics` as
 * `usermavenKey` (public: it is in every page). `headers` are the security
 * headers the Worker's own answers carry, since public/_headers reaches only
 * what ASSETS serves; the default is the kit's baseline set.
 *
 * Types are kept light so sites build without @cloudflare/workers-types.
 * test/analytics.test.mjs holds the proxy to all of the above.
 */

export interface AnalyticsProxyOptions {
  /** The site's Usermaven workspace key, the `usermavenKey` it passes to `Analytics`. */
  key: string;
  /**
   * Headers set on every answer the proxy builds (values already there are replaced).
   * Default: the kit's baseline security headers, as in its `_headers`. A site
   * that ships its own public/_headers passes the same set here.
   */
  headers?: Record<string, string>;
}

export interface AnalyticsProxy {
  /** True for every path the proxy answers: everything under /um/. */
  isAnalyticsPath(pathname: string): boolean;
  /** The answer for a request under /um/. */
  analytics(request: Request): Promise<Response>;
}

/** The `/*` block of the kit's baseline `_headers` (index.js); test/analytics.test.mjs keeps them in step. */
export const BASELINE_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(self)',
  'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
});

/** The largest event body that goes on, in bytes. */
export const MAX_EVENT_BODY = 64 * 1024;

const PREFIX = '/um/';
const SCRIPT = 'https://t.usermaven.com/lib.js';
const EVENTS = 'https://events.usermaven.com';
const EVENT_PATHS = new Set(['/um/api/v1/event', '/um/api/v1/s2s/event']);
/** The browser's headers that go upstream with an event; nothing else does (no cookie). */
const FORWARDED = ['content-type', 'user-agent', 'accept-language', 'origin', 'referer'];

export function createAnalyticsProxy(options: AnalyticsProxyOptions): AnalyticsProxy {
  const key = options?.key;
  if (typeof key !== 'string' || key.trim() === '' || key !== key.trim()) {
    throw new Error('createAnalyticsProxy: pass the site\'s Usermaven workspace key as `key`');
  }
  const extra = options.headers ?? BASELINE_SECURITY_HEADERS;

  /** The headers with the site's set added. */
  function secure(init?: HeadersInit): Headers {
    const headers = new Headers(init);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    return headers;
  }

  function empty(status: number): Response {
    return new Response(null, { status, headers: secure({ 'Cache-Control': 'no-store' }) });
  }

  /** Every `api_key`, at any depth of the parsed body, is the site's; a body without one passes. */
  function ownWorkspace(data: unknown): boolean {
    if (Array.isArray(data)) return data.every(ownWorkspace);
    if (data && typeof data === 'object') {
      for (const [name, value] of Object.entries(data)) {
        if (name === 'api_key' && value !== key) return false;
        if (!ownWorkspace(value)) return false;
      }
    }
    return true;
  }

  async function script(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: secure({ Allow: 'GET, HEAD' }) });
    }
    // Cloudflare keeps the script a day, so most page views never reach Usermaven for it.
    const init: RequestInit & { cf?: Record<string, unknown> } = { cf: { cacheEverything: true, cacheTtl: 60 * 60 * 24 } };
    let upstream: Response;
    try {
      upstream = await fetch(SCRIPT, init);
    } catch (e) {
      console.error('analytics: script fetch failed', e);
      return empty(502);
    }
    if (!upstream.ok) return empty(upstream.status === 404 ? 404 : 502);
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      headers: secure({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }),
    });
  }

  async function event(request: Request, url: URL): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: secure({ Allow: 'POST' }) });
    }
    if (request.headers.get('sec-gpc') === '1') return empty(204);
    // The site's workspace only: every token in the query is its key, and so is an api_key there.
    const incoming = new URLSearchParams(url.search);
    const tokens = incoming.getAll('token');
    if (tokens.length === 0 || tokens.some((t) => t !== key)) return empty(403);
    if (incoming.getAll('api_key').some((k) => k !== key)) return empty(403);
    // The body: its declared size first, then at most MAX_EVENT_BODY bytes read, whatever it said.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_EVENT_BODY) return empty(413);
    const body = await readCapped(request, MAX_EVENT_BODY);
    if (body === null) return empty(413);
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return empty(400);
    }
    if (!ownWorkspace(data)) return empty(403);

    const headers = new Headers();
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    // Written here, never copied from the browser: the key and the strict policies, nothing else.
    const query = new URLSearchParams({ token: key, cookie_policy: 'strict', ip_policy: 'strict' });
    let upstream: Response;
    try {
      upstream = await fetch(EVENTS + url.pathname.slice('/um'.length) + '?' + query.toString(), {
        method: 'POST',
        headers,
        body,
      });
    } catch (e) {
      console.error('analytics: event forward failed', e);
      return empty(502);
    }
    const out = new Headers();
    const type = upstream.headers.get('content-type');
    if (type) out.set('content-type', type);
    out.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: secure(out) });
  }

  return {
    isAnalyticsPath(pathname: string): boolean {
      return pathname.startsWith(PREFIX);
    },
    async analytics(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/um/lib.js') return script(request);
      if (EVENT_PATHS.has(url.pathname)) return event(request, url);
      return empty(404);
    },
  };
}

/** The body as text, or null when it is longer than `limit` bytes (read no further than that). */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}
