import { publicAvailabilityOrigin } from './availability.mjs';
import { categories } from './catalog.mjs';

export const catalogTitle = 'Maquinaria para agua y soda en Argentina';
export const catalogDescription = 'Encontrá lavadoras, llenadoras, tapadoras y líneas de envasado para bidones, sifones y botellas. Explorá equipos publicados y modelos de referencia.';

const categoryCopy = {
  lavadoras: ['Lavadoras para bidones y envases', 'Compará lavadoras por capacidad, tipo de envase y sistema de lavado. Encontrá equipos para preparar bidones retornables antes del llenado.'],
  llenadoras: ['Llenadoras de bidones, botellas y sifones', 'Explorá máquinas llenadoras para agua y soda. Consultá por equipos según el envase, la capacidad de producción y la ubicación.'],
  tapadoras: ['Tapadoras para bidones y botellas', 'Encontrá tapadoras y roscadoras para líneas de envasado. Consultá el tipo de cierre y la capacidad para tu formato de envase.'],
  lineas: ['Líneas de lavado, llenado y tapado', 'Explorá líneas de envasado para agua y soda. Revisá qué etapas integra cada equipo, el formato de envase y la producción por hora.'],
};

export const seoOrigin = requestUrl => publicAvailabilityOrigin(process.env.AGUA_PUBLIC_URL) || requestUrl.origin;
export const equipmentPath = ref => `/equipos/${encodeURIComponent(ref)}`;
export const categoryPath = category => category ? '/?' + new URLSearchParams({ categoria: category }) : '/';
export const categorySeo = category => categoryCopy[category] ?? [
  `${categories[category]} en el catálogo de maquinaria`,
  `Explorá la categoría ${categories[category]} en Agua Máquinas. Consultá las características y pedí información por el equipo que te interesa.`,
];

export function equipmentSeo(machine, photos, origin) {
  const url = new URL(equipmentPath(machine.ref), origin).href;
  const images = photos.map(photo => new URL(photo, origin).href);
  const specification = machine.capacity ? `Capacidad: ${machine.capacity}. ` : '';
  const referenceNote = machine.reference ? 'Equipo de referencia. ' : '';
  const summary = (referenceNote + specification + machine.description).replace(/\s+/g, ' ').trim();
  const description = summary.length > 155 ? summary.slice(0, 153).replace(/\s+\S*$/, '') + '…' : summary;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    url, name: machine.title, sku: machine.ref,
    description: machine.description,
    category: categories[machine.category],
    ...(images.length && { image: images }),
    ...(machine.brand && { brand: { '@type': 'Brand', name: machine.brand } }),
    ...(machine.model && { model: machine.model }),
  };
  if (!machine.reference && machine.price > 0 && !(machine.price_max > machine.price) && ['USD', 'ARS'].includes(machine.currency)) {
    const condition = { nuevo: 'NewCondition', usado: 'UsedCondition', reacondicionado: 'RefurbishedCondition' }[machine.condition];
    schema.offers = {
      '@type': 'Offer',
      url, price: machine.price, priceCurrency: machine.currency,
      ...(condition && { itemCondition: 'https://schema.org/' + condition }),
    };
  }
  return {
    description,
    image: images[0],
    schema,
  };
}
