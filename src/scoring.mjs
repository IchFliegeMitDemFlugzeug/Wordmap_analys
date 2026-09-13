// Semantic matching lives in this module so discovery never has to use unsafe substring checks.
export const HIGH_DOMAIN = ['бпла', 'бла', 'бвс', 'бас', 'дрон', 'авиация', 'aircraft', 'uav', 'drone'];
export const PRODUCT = ['бак', 'штуцер', 'фитинг', 'фильтр', 'клапан', 'трубка', 'шланг', 'датчик', 'насос', 'fuel', 'tank', 'bladder', 'fitting', 'clunk', 'valve', 'vent', 'hose', 'tubing', 'pump'];
export const COMMERCIAL = ['купить', 'цена', 'заказать', 'заказ', 'изготовление', 'производитель', 'производство', 'поставщик', 'продажа'];
export const NEGATIVE = ['ваз', 'лада', 'камаз', 'газель', 'уаз', 'трактор', 'мотоблок', 'бензопила', 'триммер', 'мотоцикл'];

const SAFE_PREFIXES = Object.freeze({
  domain: ['беспилотн', 'авиационн', 'авиамодел', 'радиомодел'],
  fuel: ['топливн'],
  commercial: ['производител'],
  product: ['топливозабор', 'горловин', 'дренаж', 'быстросъем', 'противоотлив', 'перекач'],
});
const GENERIC_ANCHORS = new Set(['купить', 'цена', 'заказать', 'заказ', 'изготовление', 'производство', 'производитель', 'поставщик', 'продажа', 'топливный', 'топливная', 'топливные', 'fuel', 'фильтр', 'насос', 'шланг', 'трубка', 'бак', 'бака', 'баков', 'tank', 'system', 'система', 'системы', 'для']);
const TECHNICAL = new Set([...PRODUCT, 'autopilot', 'автопилот', 'motor', 'engine', 'двигатель', 'двигателя', 'компонент', 'система', 'системы']);

export function normalizeQuery(value) {
  return String(value).trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ');
}

export function tokenizeQuery(value) {
  return normalizeQuery(value).match(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu) ?? [];
}

export function createMatcher(value) {
  const tokens = tokenizeQuery(value);
  const tokenSet = new Set(tokens);
  return {
    tokens,
    hasToken: (term) => tokenSet.has(normalizeQuery(term)),
    hasAnyToken: (terms) => terms.some((term) => tokenSet.has(normalizeQuery(term))),
    hasAllowedPrefix: (prefixes) => tokens.some((token) => prefixes.some((prefix) => token.startsWith(prefix))),
    hasPhrase: (phrase) => {
      const wanted = tokenizeQuery(phrase);
      return wanted.length > 0 && tokens.some((_, start) => wanted.every((token, offset) => tokens[start + offset] === token));
    },
  };
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

function entityMatches(matcher, entities) {
  return entities.filter((entity) => matcher.hasPhrase(entity));
}

function semanticSignals(query, context = {}) {
  const matcher = createMatcher(query);
  const root = createMatcher(context.rootSeed ?? '');
  const parent = createMatcher(context.parentQuery ?? '');
  const entities = [...new Set([...(context.brands ?? []), ...(context.entities ?? [])])];
  const matchedEntities = entityMatches(matcher, entities);
  const domain = matcher.hasAnyToken(HIGH_DOMAIN) || matcher.hasAllowedPrefix(SAFE_PREFIXES.domain);
  const fuel = matcher.hasToken('fuel') || matcher.hasAllowedPrefix(SAFE_PREFIXES.fuel);
  const tank = matcher.hasAnyToken(['бак', 'бака', 'баков', 'tank', 'bladder']);
  const accessory = matcher.hasAnyToken(['фильтр', 'насос', 'шланг', 'трубка', 'горловина', 'fitting', 'filter', 'pump', 'hose', 'tubing']) || matcher.hasAllowedPrefix(SAFE_PREFIXES.product);
  const product = matcher.hasAnyToken(PRODUCT) || matcher.hasAllowedPrefix(SAFE_PREFIXES.product) || fuel;
  const technical = matcher.tokens.some((token) => TECHNICAL.has(token)) || product;
  const meaningfulRoot = new Set(root.tokens.filter((token) => !GENERIC_ANCHORS.has(token) && token.length >= 3));
  const meaningfulParent = new Set(parent.tokens.filter((token) => !GENERIC_ANCHORS.has(token) && token.length >= 4));
  const rootOverlap = matcher.tokens.filter((token) => meaningfulRoot.has(token));
  const parentOverlap = matcher.tokens.filter((token) => meaningfulParent.has(token));
  const model = matcher.tokens.some((token) => /(?=.*\p{L})(?=.*\p{N})/u.test(token) && token.length >= 3);
  const hardNoise = matcher.hasAnyToken(['авиабилет', 'авиабилеты', 'билет', 'билеты', 'автобус', 'рейс', 'webasto', 'вебасто', 'bestway', 'intex', 'toyota']) ||
    matcher.hasAllowedPrefix(['бассейн', 'автомобил', 'антидрон']);
  const entity = matchedEntities.length > 0;
  const strongContext = domain || entity || model || rootOverlap.length > 0;
  return { matcher, domain, fuel, tank, accessory, product, technical, entity, model, strongContext, hardNoise, matchedEntities, rootOverlap, parentOverlap };
}

export function scoreQuery(query, { brands = [], entities = [], manualSeed = false } = {}) {
  const signal = semanticSignals(query, { brands, entities });
  const matcher = signal.matcher;
  const commercial = matcher.hasAnyToken(COMMERCIAL) || matcher.hasAllowedPrefix(SAFE_PREFIXES.commercial);
  const negative = matcher.hasAnyToken(NEGATIVE);
  return (signal.domain ? 5 : 0) + (signal.product ? 3 : 0) + (commercial ? 3 : 0) +
    (signal.entity ? 3 : 0) - (negative ? 6 : 0) + (manualSeed ? 100 : 0);
}

export function classifyQuery(query, context = {}) {
  const signal = semanticSignals(query, context);
  const score = scoreQuery(query, context);
  const reasons = [];
  let relevanceClass = 'noise';
  if (signal.hardNoise) reasons.push('hard-noise intent or market');
  else if ((signal.fuel && signal.tank && !signal.accessory) || (signal.tank && signal.domain && !signal.accessory)) {
    relevanceClass = 'core';
    reasons.push('fuel-tank product combination');
  } else if (signal.entity && (signal.technical || signal.model)) {
    relevanceClass = 'adjacent';
    reasons.push(`entity anchor: ${signal.matchedEntities.join(', ')}`);
  } else if (signal.model && signal.technical) {
    relevanceClass = 'adjacent';
    reasons.push('model and technical signal');
  } else if (signal.domain && signal.accessory) {
    relevanceClass = 'adjacent';
    reasons.push('engineering domain and technical product');
  } else if (signal.strongContext && signal.technical && (signal.parentOverlap.length || signal.rootOverlap.length)) {
    relevanceClass = 'adjacent';
    reasons.push('meaningful parent/root context overlap');
  } else if (signal.product || signal.domain || signal.entity) {
    relevanceClass = 'broad';
    reasons.push('related but lacks a strong contextual combination');
  } else reasons.push('no engineering-domain or contextual signal');
  const associationHasStrongAnchor = signal.domain || signal.entity || signal.model || signal.rootOverlap.length > 0;
  const eligibleClass = relevanceClass === 'core' || relevanceClass === 'adjacent';
  const recursiveEligible = eligibleClass && (context.relationType !== 'ASSOCIATION' || associationHasStrongAnchor);
  const deepEligible = eligibleClass;
  return { score, relevanceClass, reasons, recursiveEligible, deepEligible };
}
