/**
 * Money is stored and computed as integer minor units (cents) to avoid
 * floating-point rounding errors. Formatting for display happens at the edge.
 */

/** Convert a decimal major-unit amount (e.g. "12.50") to integer cents. */
export function toCents(amount) {
  if (amount == null || amount === "") return 0;
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** Convert integer cents to a major-unit number (e.g. 1250 -> 12.5). */
export function fromCents(cents) {
  return (Number(cents) || 0) / 100;
}

/** Format integer cents as a currency string. */
export function formatMoney(cents, currency = "USD", locale = "en-US") {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(fromCents(cents));
  } catch {
    return `${(fromCents(cents)).toFixed(2)} ${currency}`;
  }
}
