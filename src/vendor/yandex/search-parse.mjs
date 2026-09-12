// Derived from stufently/yandex-mcp, MIT License.
// https://github.com/stufently/yandex-mcp/blob/main/packages/yandex-search-mcp/src/parse.mjs
export const EMPTY_RESULT_ERROR_CODES = new Set(['15', '18', '19']);
export function cleanHtml(value = '') {
  return value.replace(/<[^>]*>/gu, '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").trim();
}
export function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'iu'));
  return match?.[1] ?? '';
}
export function extractAllTags(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'giu'))].map((match) => match[1]);
}
export function parseError(xml) {
  const block = extractTag(xml, 'error');
  if (!block) return null;
  const code = xml.match(/<error[^>]*code=["']([^"']+)/iu)?.[1] ?? '';
  return { code, message: cleanHtml(block), empty: EMPTY_RESULT_ERROR_CODES.has(code) };
}
export function parseFound(xml) { return Number(extractTag(xml, 'found') || 0); }
export function parseSearchResults(xml) {
  const error = parseError(xml);
  if (error && !error.empty) throw new Error(`Yandex Search: ${error.message} (${error.code})`);
  const groups = extractAllTags(xml, 'group');
  return { found: parseFound(xml), results: groups.map((group) => {
    const doc = extractTag(group, 'doc') || group;
    const url = cleanHtml(extractTag(doc, 'url'));
    return { url, domain: cleanHtml(extractTag(doc, 'domain')) || (() => { try { return new URL(url).hostname; } catch { return ''; } })(), title: cleanHtml(extractTag(doc, 'title')), snippet: cleanHtml(extractTag(doc, 'passage') || extractTag(doc, 'headline')) };
  }).filter((item) => item.url) };
}
