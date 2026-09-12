// Derived from stufently/yandex-mcp, MIT License.
// packages/yandex-wordstat-mcp/src/dates.mjs

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function parseDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function getDefaultDates(period, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = period === 'monthly'
    ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1))
    : new Date(end.getTime() - (period === 'weekly' ? 83 : 29) * 86_400_000);
  return { fromDate: formatDate(start), toDate: formatDate(end) };
}

export function alignDates(period, fromDate, toDate, now = new Date()) {
  let from = parseDate(fromDate);
  let to = parseDate(toDate);
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  if (period === 'monthly') {
    from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    to = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
    const lastCompletedMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    if (to > lastCompletedMonth) to = lastCompletedMonth;
  } else if (period === 'weekly') {
    from = new Date(from.getTime() - ((from.getUTCDay() + 6) % 7) * 86_400_000);
    to = new Date(to.getTime() + (6 - ((to.getUTCDay() + 6) % 7)) * 86_400_000);
    const lastSunday = new Date(yesterday.getTime() - yesterday.getUTCDay() * 86_400_000);
    if (to > lastSunday) to = lastSunday;
  } else if (to > yesterday) {
    to = yesterday;
  }
  return { fromDate: formatDate(from), toDate: formatDate(to) };
}
