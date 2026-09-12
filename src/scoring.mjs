export const HIGH_DOMAIN = ['бпла','бла','бвс','бас','беспилот','дрон','авиа','авиамодель','радиомодель','uav','drone','aircraft'];
export const PRODUCT = ['топлив','бак','штуцер','фитинг','топливозабор','фильтр','клапан','горловин','дренаж','сапун','трубк','шланг','тройник','быстросъем','датчик','насос','противоотлив','перекач','fuel','tank','bladder','fitting','clunk','valve','vent','hose','tubing','pump'];
export const COMMERCIAL = ['купить','цена','заказать','заказ','изготовление','производитель','производство','поставщик','продажа'];
export const NEGATIVE = ['ваз','лада','камаз','газель','уаз','трактор','мотоблок','бензопила','триммер','мотоцикл'];

export function normalizeQuery(value) {
  return String(value).trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ');
}

export function normalizeUrl(value) {
  const url = new URL(value);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || ['yclid', 'gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString();
}

export function scoreQuery(query, { brands = [], manualSeed = false } = {}) {
  const text = normalizeQuery(query);
  const has = (terms) => terms.some((term) => text.includes(normalizeQuery(term)));
  return (has(HIGH_DOMAIN) ? 5 : 0) + (has(PRODUCT) ? 3 : 0) +
    (has(COMMERCIAL) ? 3 : 0) + (has(brands) ? 3 : 0) -
    (has(NEGATIVE) ? 6 : 0) + (manualSeed ? 100 : 0);
}
