function naturalPhrase(phrase) {
  const value = String(phrase ?? '').replace(/[!"\[\]()|+]/gu, ' ').trim().replace(/\s+/gu, ' ');
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
