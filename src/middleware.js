import { referenceEquipment } from './lib/reference-equipment.mjs';
import { categoryPath, equipmentPath } from './lib/seo.mjs';

const legacyRoutes = new Map([
  ['/lavadoras', categoryPath('lavadoras')],
  ['/llenadoras', categoryPath('llenadoras')],
]);

for (const item of referenceEquipment) {
  const destination = equipmentPath(item.ref);
  if (item.sourceUrl) legacyRoutes.set(new URL(item.sourceUrl).pathname.replace(/^\/index\.php\//, '/'), destination);
  if (item.legacyRef) legacyRoutes.set(`/node/${item.legacyRef}`, destination);
}

export function onRequest({ request, url, redirect }, next) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();
  const legacyPath = url.pathname.replace(/^\/index\.php\//, '/').replace(/\/$/, '');
  const destination = legacyRoutes.get(legacyPath);
  return destination ? redirect(destination, 301) : next();
}
