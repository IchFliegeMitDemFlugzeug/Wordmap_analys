// Derived from stufently/yandex-mcp, MIT License.
// packages/yandex-search-mcp/src/parse.mjs

export const EMPTY_RESULT_ERROR_CODES = new Set([15]);

export function cleanHtml(text = '') {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim();
}

export function extractTag(xml, tag) {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'iu'))?.[1] ?? '';
}

export function extractAllTags(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'giu'))].map((match) => match[1]);
}

export function parseError(xml) {
  const match = xml.match(/<error\s+code=["'](\d+)["'][^>]*>([\s\S]*?)<\/error>/iu);
  if (!match) return null;
  return { code: Number(match[1]), message: cleanHtml(match[2]) };
}

export function parseFound(xml) {
  const total = xml.match(/<found\s+priority=["']all["'][^>]*>(\d+)<\/found>/iu)?.[1];
  const human = extractTag(xml, 'found-human');
  return { total: total === undefined ? null : Number(total), human: cleanHtml(human) };
}

export function parseSearchResults(xml) {
  return extractAllTags(xml, 'group').map((group, index) => {
    const doc = extractTag(group, 'doc') || group;
    const url = cleanHtml(extractTag(doc, 'url'));
    let domain = cleanHtml(extractTag(doc, 'domain'));
    if (!domain) {
      try { domain = new URL(url).hostname; } catch { domain = ''; }
    }
    return {
      position: index + 1,
      url,
      domain,
      title: cleanHtml(extractTag(doc, 'title')),
      snippet: cleanHtml(extractTag(doc, 'passage') || extractTag(doc, 'headline')),
    };
  }).filter((item) => item.url);
}
