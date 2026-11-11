export const categories = {
  lavadoras: 'Lavadoras', llenadoras: 'Llenadoras', lineas: 'Líneas completas', soda: 'Soda y sifones',
  tapadoras: 'Tapadoras', tanques: 'Tanques', tratamiento: 'Tratamiento de agua', cajones: 'Cajones',
  hornos: 'Hornos y sopladoras', repartos: 'Repartos y soderías', vehiculos: 'Vehículos', otros: 'Otros equipos',
};

export const formats = { bidones: 'Bidones', sifones: 'Sifones', botellas: 'Botellas', otros: 'Otros / no aplica' };
export const conditions = { usado: 'Usado', reacondicionado: 'Reacondicionado', nuevo: 'Nuevo' };
export const provinces = ['Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];

export function searchTerms(value) {
  return value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\b(\d+)\s*(?:litros?|lts?|l)\b/g, '$1l')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

export function matches(machine, params) {
  if (params.get('categoria') && machine.category !== params.get('categoria')) return false;
  if (params.get('provincia') && machine.province !== params.get('provincia')) return false;
  if (params.get('formato') && machine.format !== params.get('formato')) return false;
  if (params.get('estado') && machine.condition !== params.get('estado')) return false;
  const searchable = searchTerms([machine.title, machine.brand, machine.model, machine.ref, machine.ref.replaceAll('-', ''), machine.format_detail,
    formats[machine.format], machine.capacity, machine.province, categories[machine.category], machine.description].join(' '));
  return searchTerms((params.get('q') ?? '').slice(0, 120)).every(term => searchable.some(word => word.includes(term)));
}

export function priceLabel(machine) {
  if (!machine.price) return 'Consultar precio';
  const currency = machine.currency === 'USD' ? 'US$' : '$';
  const number = new Intl.NumberFormat('es-AR');
  const range = machine.price_max > machine.price ? ' a ' + number.format(machine.price_max) : '';
  return `${currency} ${number.format(machine.price)}${range}`;
}

export function videoLink(input) {
  if (!input) return '';
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
      const path = url.pathname.split('/').filter(Boolean);
      const id = url.hostname === 'youtu.be' && path.length === 1 ? path[0]
        : url.pathname === '/watch' ? url.searchParams.get('v')
        : path.length === 2 && ['shorts', 'live'].includes(path[0]) ? path[1] : '';
      return /^[\w-]{11}$/.test(id ?? '') ? `https://www.youtube.com/watch?v=${id}` : null;
    }
    if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname) && /^\/\d{5,12}\/?$/.test(url.pathname)) {
      return `https://vimeo.com${url.pathname.replace(/\/$/, '')}`;
    }
  } catch { return null; }
  return null;
}
