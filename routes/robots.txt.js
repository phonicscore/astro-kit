/**
 * /robots.txt, generated from the site's `site` URL so it always points at the
 * right sitemap. Injected by the kit's integration; opt out with `robots: false`
 * or by shipping your own public/robots.txt (the kit then steps aside).
 */
export const prerender = true;

export function GET() {
  const site = String(import.meta.env.SITE ?? '').replace(/\/$/, '');
  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${site}/sitemap-index.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
