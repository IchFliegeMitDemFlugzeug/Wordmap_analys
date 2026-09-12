// Derived from stufently/yandex-mcp, MIT License.
// https://github.com/stufently/yandex-mcp/blob/main/packages/yandex-wordstat-mcp/src/dates.mjs
export const PERIOD_DAILY = 'PERIOD_DAILY';
export const PERIOD_WEEKLY = 'PERIOD_WEEKLY';
export const PERIOD_MONTHLY = 'PERIOD_MONTHLY';
const iso = (date) => date.toISOString().slice(0, 10);
export function completedPeriod(period = PERIOD_MONTHLY, amount = 24, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  if (period === PERIOD_MONTHLY) return { fromDate: iso(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - amount + 1, 1))), toDate: iso(end) };
  const days = period === PERIOD_WEEKLY ? amount * 7 : amount;
  return { fromDate: iso(new Date(end.getTime() - (days - 1) * 86400000)), toDate: iso(end) };
}
