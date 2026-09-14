// Semantic matching lives in this module so discovery never has to use unsafe substring checks.
export const HIGH_DOMAIN = ['бпла', 'бла', 'бвс', 'бас', 'дрон', 'дроны', 'дрона', 'дрону', 'дронов', 'дронами', 'дронах', 'самолет', 'самолеты', 'самолета', 'самолетов', 'вертолет', 'вертолеты', 'вертолета', 'вертолетов', 'авиация', 'aircraft', 'uav', 'drone', 'drones'];
export const PRODUCT = ['бак', 'бака', 'баки', 'баков', 'штуцер', 'фитинг', 'фильтр', 'клапан', 'трубка', 'шланг', 'датчик', 'насос', 'fuel', 'tank', 'tanks', 'bladder', 'fitting', 'clunk', 'valve', 'vent', 'hose', 'tubing', 'pump'];
export const COMMERCIAL = ['купить', 'цена', 'заказать', 'заказ', 'изготовление', 'производитель', 'производство', 'поставщик', 'продажа'];
export const NEGATIVE = ['ваз', 'ваза', 'лада', 'лады', 'камаз', 'камаза', 'камазы', 'камазов', 'газель', 'газели', 'уаз', 'уаза', 'трактор', 'трактора', 'тракторы', 'тракторов', 'мотоблок', 'мотоблока', 'мотоблоки', 'мотоблоков', 'бензопила', 'бензопилы', 'триммер', 'триммера', 'триммеры', 'триммеров', 'мотоцикл', 'мотоцикла', 'мотоциклы', 'мотоциклов'];

const SAFE_PREFIXES = Object.freeze({
  domain: ['беспилотн', 'авиационн', 'авиамодел', 'радиомодел'],
  fuel: ['топливн'],
  commercial: ['производител'],
  product: ['топливозабор', 'горловин', 'дренаж', 'быстросъем', 'противоотлив', 'перекач'],
});
const COMPONENT_FAMILIES = Object.freeze({
  filter: ['фильтр', 'фильтры', 'фильтра', 'фильтров'],
  pump: ['насос', 'насосы', 'насоса', 'насосов'],
  hose: ['шланг', 'шланги', 'шланга', 'шлангов'],
  tube: ['трубка', 'трубки', 'трубок'],
  valve: ['клапан', 'клапаны', 'клапана', 'клапанов'],
});
const COMPONENT_FORMS = Object.freeze(Object.values(COMPONENT_FAMILIES).flat());
const GENERIC_ANCHORS = new Set([...PRODUCT, ...COMPONENT_FORMS, ...COMMERCIAL, 'filter', 'system', 'systems', 'система', 'системы', 'компонент', 'компоненты', 'для']);
const HARD_NEGATIVE = Object.freeze(['toyota', 'тойота', 'hyundai', 'хендай', 'kia', 'киа', 'renault', 'рено', 'nissan', 'ниссан', 'volkswagen', 'фольксваген', 'bmw', 'mercedes', 'мерседес', 'ford', 'форд', 'chevrolet', 'шевроле', 'skoda', 'шкода', 'audi', 'ауди', 'webasto', 'вебасто']);
const TECHNICAL = new Set([...PRODUCT, 'autopilot', 'автопилот', 'motor', 'engine', 'двигатель', 'двигателя', 'компонент', 'система', 'системы']);
const FLEXIBLE_PREFIXES = Object.freeze(['мягк', 'гибк', 'эластичн', 'резинов']);

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
  const rootEntities = entityMatches(root, entities);
  const domain = matcher.hasAnyToken(HIGH_DOMAIN) || matcher.hasAllowedPrefix(SAFE_PREFIXES.domain);
  const fuel = matcher.hasToken('fuel') || matcher.hasAllowedPrefix(SAFE_PREFIXES.fuel);
  const tankNoun = matcher.hasAnyToken([
    'бак', 'бака', 'баку', 'баке', 'баком',
    'баки', 'баков', 'бакам', 'баками', 'баках',
    'tank', 'tanks',
  ]);
  const bladder = matcher.hasToken('bladder');
  const tank = tankNoun || bladder;
  const flexible = matcher.hasToken('flexible') || bladder || matcher.hasAllowedPrefix(FLEXIBLE_PREFIXES);
  const targetFuelTank =
    fuel &&
    flexible &&
    (tankNoun || bladder);
  const accessory = matcher.hasAnyToken([...COMPONENT_FORMS, 'горловина', 'fitting', 'filter', 'pump', 'hose', 'tubing']) || matcher.hasAllowedPrefix(SAFE_PREFIXES.product);
  const product = accessory || matcher.hasAnyToken(PRODUCT) || matcher.hasAllowedPrefix(SAFE_PREFIXES.product) || fuel;
  const technical = matcher.tokens.some((token) => TECHNICAL.has(token)) || product;
  const genericPrefixes = [...SAFE_PREFIXES.fuel, ...SAFE_PREFIXES.product, ...SAFE_PREFIXES.commercial];
  const isMeaningfulAnchor = (token, minimumLength) => token !== 'flexible' && !FLEXIBLE_PREFIXES.some((prefix) => token.startsWith(prefix)) && !GENERIC_ANCHORS.has(token) && !genericPrefixes.some((prefix) => token.startsWith(prefix)) && token.length >= minimumLength;
  const meaningfulRoot = new Set(root.tokens.filter((token) => isMeaningfulAnchor(token, 3)));
  const meaningfulParent = new Set(parent.tokens.filter((token) => isMeaningfulAnchor(token, 4)));
  const rootOverlap = matcher.tokens.filter((token) => meaningfulRoot.has(token));
  const parentOverlap = matcher.tokens.filter((token) => meaningfulParent.has(token));
  const model = matcher.tokens.some((token) => /(?=.*\p{L})(?=.*\p{N})/u.test(token) && token.length >= 3);
  const negative = matcher.hasAnyToken(NEGATIVE);
  const hardNoise = matcher.hasAnyToken(['авиабилет', 'авиабилеты', 'билет', 'билеты', 'автобус', 'рейс', 'bestway', 'intex', ...HARD_NEGATIVE]) ||
    matcher.hasAllowedPrefix(['бассейн', 'автомобил', 'антидрон']);
  const entity = matchedEntities.length > 0;
  const rootDomain = root.hasAnyToken(HIGH_DOMAIN) || root.hasAllowedPrefix(SAFE_PREFIXES.domain);
  const rootFuel = root.hasToken('fuel') || root.hasAllowedPrefix(SAFE_PREFIXES.fuel);
  const rootTankNoun = root.hasAnyToken([
    'бак', 'бака', 'баку', 'баке', 'баком',
    'баки', 'баков', 'бакам', 'баками', 'баках',
    'tank', 'tanks',
  ]);
  const rootBladder = root.hasToken('bladder');
  const rootFlexible = root.hasToken('flexible') || rootBladder || root.hasAllowedPrefix(FLEXIBLE_PREFIXES);
  const rootTargetFuelTank =
    rootFuel &&
    rootFlexible &&
    (rootTankNoun || rootBladder);
  const rootIsTrusted =
    rootDomain ||
    rootEntities.length > 0 ||
    rootTargetFuelTank;
  const trustedRootOverlap = rootIsTrusted && rootOverlap.length > 0;
  const modelContext = entity || domain || trustedRootOverlap;
  const strongContext = domain || entity || targetFuelTank || trustedRootOverlap;
  return { matcher, domain, fuel, tank, flexible, targetFuelTank, accessory, product, technical, entity, model, modelContext, strongContext, negative, hardNoise, matchedEntities, rootOverlap, parentOverlap, rootIsTrusted, trustedRootOverlap };
}

export function scoreQuery(query, { brands = [], entities = [], manualSeed = false } = {}) {
  const signal = semanticSignals(query, { brands, entities });
  const matcher = signal.matcher;
  const commercial = matcher.hasAnyToken(COMMERCIAL) || matcher.hasAllowedPrefix(SAFE_PREFIXES.commercial);
  return (signal.domain ? 5 : 0) + (signal.product ? 3 : 0) + (commercial ? 3 : 0) +
    (signal.entity ? 3 : 0) - (signal.negative ? 6 : 0) + (manualSeed ? 100 : 0);
}

export function classifyQuery(query, context = {}) {
  const signal = semanticSignals(query, context);
  const score = scoreQuery(query, context);
  const reasons = [];
  const strongFuelTankContext = signal.domain || signal.entity || signal.targetFuelTank || signal.trustedRootOverlap;
  let relevanceClass = 'noise';
  if (signal.hardNoise || signal.negative) reasons.push(signal.hardNoise ? 'hard-noise intent or market' : 'negative market token');
  else if (signal.targetFuelTank || (signal.fuel && signal.tank && strongFuelTankContext && !signal.accessory)) {
    relevanceClass = 'core';
    reasons.push('fuel-tank product combination');
  } else if (signal.tank && signal.domain && !signal.accessory) {
    relevanceClass = 'adjacent';
    reasons.push('tank in UAV/aviation domain without explicit fuel context');
  } else if (signal.entity && (signal.technical || signal.model)) {
    relevanceClass = 'adjacent';
    reasons.push(`entity anchor: ${signal.matchedEntities.join(', ')}`);
  } else if (signal.model && signal.modelContext && signal.technical) {
    relevanceClass = 'adjacent';
    reasons.push('model and technical signal');
  } else if (signal.domain && signal.accessory) {
    relevanceClass = 'adjacent';
    reasons.push('engineering domain and technical product');
  } else if (signal.strongContext && signal.technical && (signal.parentOverlap.length || signal.trustedRootOverlap)) {
    relevanceClass = 'adjacent';
    reasons.push('meaningful parent/root context overlap');
  } else if (signal.product || signal.domain || signal.entity) {
    relevanceClass = 'broad';
    reasons.push('related but lacks a strong contextual combination');
  } else reasons.push('no engineering-domain or contextual signal');
  const associationHasStrongAnchor = signal.domain || signal.entity || (signal.model && signal.modelContext) || signal.trustedRootOverlap;
  const eligibleClass = relevanceClass === 'core' || relevanceClass === 'adjacent';
  const recursiveEligible = eligibleClass && (context.relationType !== 'ASSOCIATION' || associationHasStrongAnchor);
  const deepEligible = eligibleClass;
  return { score, relevanceClass, reasons, recursiveEligible, deepEligible };
}
