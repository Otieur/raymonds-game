/**
 * Ratings from finishing orders, by the Plackett-Luce model: each member has a strength, and the
 * chance that a seat finishes first among the seats not yet placed is its member's strength over
 * the sum of theirs. Fitted by the minorization-maximization iteration of Hunter (2004), which
 * needs no step size. A small prior (one win and one loss against a reference of strength 1) keeps
 * a member that always wins from an infinite rating.
 */
import { nextFloat, seedFrom } from '../rng.ts';

/** One game: the members in finishing order, first to last. A member may hold several seats. */
export type Order = string[];

export interface Rated {
  member: string;
  strength: number;
  /** 100 points is a doubling of strength; the reference member is 0. */
  rating: number;
  low: number;
  high: number;
  games: number;
}

export function fitStrengths(orders: Order[], members: string[], iterations = 500): Map<string, number> {
  const index = new Map(members.map((m, i) => [m, i]));
  const n = members.length;
  const wins = new Float64Array(n);
  for (const order of orders) for (let t = 0; t < order.length - 1; t++) wins[index.get(order[t]) as number] += 1;
  let gamma = new Float64Array(n).fill(1);
  for (let it = 0; it < iterations; it++) {
    const denominator = new Float64Array(n);
    for (const order of orders) {
      // Sum of strengths of the seats still to be placed, stage by stage.
      let remaining = 0;
      for (const m of order) remaining += gamma[index.get(m) as number];
      for (let t = 0; t < order.length - 1; t++) {
        const share = 1 / remaining;
        for (let k = t; k < order.length; k++) denominator[index.get(order[k]) as number] += share;
        remaining -= gamma[index.get(order[t]) as number];
      }
    }
    const next = new Float64Array(n);
    let change = 0;
    for (let i = 0; i < n; i++) {
      // The prior: one win and one loss against a reference of strength 1.
      const d = denominator[i] + 2 / (gamma[i] + 1);
      next[i] = (wins[i] + 1) / d;
      change = Math.max(change, Math.abs(Math.log(next[i] / gamma[i])));
    }
    gamma = next;
    if (change < 1e-9) break;
  }
  return new Map(members.map((m, i) => [m, gamma[i]]));
}

/** Strengths, ratings relative to `reference`, and 95% intervals by refitting on games drawn again. */
export function rate(orders: Order[], members: string[], reference: string, resamples = 200): Rated[] {
  const base = fitStrengths(orders, members);
  const toRating = (strengths: Map<string, number>, m: string) => 100 * Math.log2((strengths.get(m) ?? 1) / (strengths.get(reference) ?? 1));
  const holder = { rng: seedFrom('ratings') };
  const random = () => nextFloat(holder);
  const samples = new Map(members.map((m) => [m, [] as number[]]));
  for (let b = 0; b < resamples; b++) {
    const drawn = Array.from({ length: orders.length }, () => orders[Math.floor(random() * orders.length)]);
    const strengths = fitStrengths(drawn, members, 200);
    for (const m of members) samples.get(m)?.push(toRating(strengths, m));
  }
  const counts = new Map<string, number>();
  for (const order of orders) for (const m of new Set(order)) counts.set(m, (counts.get(m) ?? 0) + 1);
  return members.map((member) => {
    const sorted = [...(samples.get(member) ?? [])].sort((a, b) => a - b);
    return {
      member,
      strength: base.get(member) ?? 1,
      rating: toRating(base, member),
      low: sorted[Math.floor(sorted.length * 0.025)] ?? NaN,
      high: sorted[Math.ceil(sorted.length * 0.975) - 1] ?? NaN,
      games: counts.get(member) ?? 0,
    };
  });
}
