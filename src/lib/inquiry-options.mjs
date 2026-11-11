export const inquirySources = {
  'sitio-anterior': 'Sitio anterior', pedro: 'Referido por Pedro',
  whatsapp: 'WhatsApp', telefono: 'Teléfono', otro: 'Otro canal',
};
export const defaultInquirySource = 'Agua Máquinas';
export const inquirySource = value => Object.hasOwn(inquirySources, value) ? value : '';
export const inquiryStages = {
  new: 'Nueva', qualified: 'Calificada', introduced: 'Presentación hecha',
  visit: 'Visita coordinada', negotiation: 'En negociación', closed: 'Cerrada', lost: 'Perdida',
};
export const inquiryTimeframes = {
  week: 'Esta semana', month: 'Este mes', quarter: 'En 1 a 3 meses', exploring: 'Estoy averiguando',
};

export const validBuyerEmail = value => /^[^\s@,<>]+@[^\s@,<>.]+(?:\.[^\s@,<>.]+)+$/.test(value);
export const validBuyerWhatsApp = value => /^\+?[\d ().-]+$/.test(value) && /^\d{8,15}$/.test(value.replace(/\D/g, ''));

export function moneyInput(cents) {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

export function moneyLabel(cents, currency) {
  return cents == null ? '—' : new Intl.NumberFormat('es-AR', {
    style: 'currency', currency, currencyDisplay: 'code',
  }).format(cents / 100);
}
