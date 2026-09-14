function naturalPhrase(phrase) {
  let value = String(phrase ?? '').trim().replace(/\s+/gu, ' ');
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).trim();
  value = value.replace(/(^|\s)!+(?=[\p{L}\p{N}])/gu, '$1');
  if (!value) throw new TypeError('Wordstat phrase must not be empty');
  return value;
}

export function toQuotedForm(phrase) {
  return `"${naturalPhrase(phrase)}"`;
}

export function toExactForm(phrase) {
  const tokens = naturalPhrase(phrase).split(' ');
  return `"${tokens.map((token) => `!${token}`).join(' ')}"`;
}
