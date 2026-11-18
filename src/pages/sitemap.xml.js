import { db } from '../lib/db.mjs';
import { referenceEquipment } from '../lib/reference-equipment.mjs';
import { categoryPath, equipmentPath, seoOrigin } from '../lib/seo.mjs';
import { categories } from '../lib/catalog.mjs';

export function GET({ url }) {
  const origin = seoOrigin(url);
  const published = db().prepare("SELECT ref, category FROM machines WHERE status = 'published' AND sample = 0").all();
  const equipment = [...published, ...referenceEquipment];
  const activeCategories = new Set(equipment.map(item => item.category).filter(key => Object.hasOwn(categories, key)));
  const paths = ['/', ...[...activeCategories].map(categoryPath), ...equipment.map(item => equipmentPath(item.ref))];
  const urls = [...new Set(paths)].map(path => {
    const location = new URL(path, origin).href.replace(/&/g, '&amp;');
    return `  <url><loc>${location}</loc></url>`;
  });
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
