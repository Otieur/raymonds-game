/**
 * Intervals for win shares measured on the same seeds.
 *
 * Two tables played on the same seeds start from the same dice, so their results are related:
 * an interval that treats them as independent is wider than it needs to be when the relation is
 * positive, and narrower when it is negative. Kept by seed, the results can be paired instead.
 *
 * An outcome by seed is 1 for a win, 0 for a finished game without one, and -1 for a game that did
 * not finish.
 */

/** The outcome of one game for a set of seats: 1 a win, 0 no win, -1 unfinished. */
export type Outcome = 1 | 0 | -1;

export interface PairedDifference {
  /** Seeds on which both games finished; only these are compared. */
  games: number;
  /** Win shares of A and B on those seeds. */
  a: number;
  b: number;
  /** a - b, with its 95% interval from the differences by seed. */
  difference: number;
  low: number;
  high: number;
  /** The half-width the same shares would get if the two were independent samples. */
  independentHalf: number;
  /** Correlation of A's and B's outcomes on the common seeds (NaN when either is constant). */
  correlation: number;
}

const Z = 1.96;

/** Wilson's 95% interval for a share. */
export function wilson(wins: number, games: number): [number, number] {
  if (games === 0) return [NaN, NaN];
  const p = wins / games;
  const centre = (p + (Z * Z) / (2 * games)) / (1 + (Z * Z) / games);
  const half = (Z * Math.sqrt((p * (1 - p)) / games + (Z * Z) / (4 * games * games))) / (1 + (Z * Z) / games);
  return [centre - half, centre + half];
}

/** Compares two outcome series by seed: index i of each is the same seed. */
export function pairedDifference(a: readonly number[], b: readonly number[]): PairedDifference {
  if (a.length !== b.length) throw new Error(`The two series cover different seeds (${a.length} and ${b.length} games).`);
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x < 0 || y < 0) continue;
    if ((x !== 0 && x !== 1) || (y !== 0 && y !== 1)) throw new Error(`Outcome at index ${i} is not 1, 0 or -1.`);
    n += 1;
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
  }
  if (n < 2) {
    const pa = n ? sa / n : NaN;
    const pb = n ? sb / n : NaN;
    return { games: n, a: pa, b: pb, difference: pa - pb, low: NaN, high: NaN, independentHalf: NaN, correlation: NaN };
  }
  const pa = sa / n;
  const pb = sb / n;
  const difference = pa - pb;
  // Sample variance of d = x - y, from the sums: sum(d^2) = saa + sbb - 2 sab.
  const sdd = saa + sbb - 2 * sab;
  const variance = Math.max(0, (sdd - n * difference * difference) / (n - 1));
  const half = Z * Math.sqrt(variance / n);
  const covariance = sab / n - pa * pb;
  const spread = Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
  return {
    games: n,
    a: pa,
    b: pb,
    difference,
    low: difference - half,
    high: difference + half,
    independentHalf: Z * Math.sqrt((pa * (1 - pa)) / n + (pb * (1 - pb)) / n),
    correlation: spread > 0 ? covariance / spread : NaN,
  };
}

/** One line of text for a paired difference, in points. */
export function describePaired(d: PairedDifference): string {
  const pts = (v: number) => (v * 100).toFixed(1);
  const r = Number.isFinite(d.correlation) ? d.correlation.toFixed(2) : 'n/a';
  return `Paired by seed: ${pts(d.difference)} points (${pts(d.low)} to ${pts(d.high)}) over ${d.games} seeds where both games finished (${pts(d.a)}% against ${pts(d.b)}%); correlation ${r}; as independent samples the interval would be ±${pts(d.independentHalf)}.`;
}

/** Outcomes by seed for a set of seats (0-based), from the winning seat of each game (-1 unfinished). */
export function outcomesFor(winners: readonly number[], seats: readonly number[]): Outcome[] {
  return winners.map((w) => (w < 0 ? -1 : seats.includes(w) ? 1 : 0));
}
