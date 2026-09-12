/** Money is a number of dollars everywhere; round to cents only at the edges (connector input, API output). */
export function roundCents(dollars: number): number {
  return Math.round(dollars * 100) / 100;
}
