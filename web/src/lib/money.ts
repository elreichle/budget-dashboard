/**
 * Money arrives from the API as a number of dollars. These helpers turn it into readable text;
 * they never do arithmetic, so rounding here is only ever the display rounding.
 */

type Format = (dollars: number) => string;

const formatters = new Map<string, Format>();

function formatter(currency: string, cents: boolean): Format {
  const key = `${currency}:${cents}`;
  let f = formatters.get(key);
  if (!f) {
    const digits = { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 };
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency, ...digits }).format;
    } catch {
      // The plan schema only checks the code's length; an unknown code must not blank the page.
      const plain = new Intl.NumberFormat("en-US", digits);
      f = (n) => `${n < 0 ? "-" : ""}${currency} ${plain.format(Math.abs(n))}`;
    }
    formatters.set(key, f);
  }
  return f;
}

/** `1234.5` → `$1,234.50`; negatives keep their sign (`-$12.00`). */
export function formatMoney(dollars: number, currency = "USD"): string {
  return formatter(currency, true)(displayed(dollars, true));
}

/** Rounded to whole dollars for meters and headlines: `1234.5` → `$1,235`. */
export function formatWhole(dollars: number, currency = "USD"): string {
  return formatter(currency, false)(displayed(dollars, false));
}

/** A change or delta with an explicit sign: `+$40.00`, `-$12.00`, `$0.00`. */
export function formatSigned(dollars: number, currency = "USD"): string {
  const shown = displayed(dollars, true);
  const text = formatMoney(Math.abs(shown), currency);
  if (shown === 0) return text;
  return (shown > 0 ? "+" : "-") + text;
}

/** An amount that rounds to zero at the shown precision is exactly zero, so it never prints as `-$0`. */
function displayed(dollars: number, cents: boolean): number {
  return Math.abs(dollars) < (cents ? 0.005 : 0.5) ? 0 : dollars;
}
