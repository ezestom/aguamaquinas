import { seoOrigin } from '../lib/seo.mjs';

export function GET({ url }) {
  return new Response(`User-agent: *\nDisallow:\nSitemap: ${seoOrigin(url)}/sitemap.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
