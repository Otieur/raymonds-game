/**
 * Two members compared as the one among copies of the same opponent, on the same seeds.
 *
 *   node scripts/paired.ts --size 4 --a <member> --b <member> [--against baseline] [--games 5000] [--seeds 1000000]
 *
 * Prints each one's win share and the difference with a 95% interval (the two tables treated as
 * independent, which widens the interval if they are positively related), then the difference
 * paired by seed over the seeds where both games finished, with its own interval.
 */
import { availableParallelism } from 'node:os';
import { describePaired, pairedDifference } from '../src/sim/intervals.ts';
import { runJobs } from './league.ts';

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const size = Number(option('--size') ?? 4);
const a = option('--a') as string;
const b = option('--b') as string;
const against = option('--against') ?? 'baseline';
const games = Number(option('--games') ?? 5000);
const start = Number(option('--seeds') ?? 1_000_000);
const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
const chunk = Math.max(100, Math.ceil(games / (workers * 2)));
const jobs = [];
for (const [x, key] of [
  [a, 'A'],
  [b, 'B'],
] as const) {
  for (let f = start; f < start + games; f += chunk) jobs.push({ kind: 'pair' as const, size, x, y: against, from: f, to: Math.min(start + games - 1, f + chunk - 1), key });
}
const results = await runJobs(jobs, workers);
const sum = (key: string) => results.filter((r) => r.key === key).reduce((t, r) => ({ wins: t.wins + r.wins, finished: t.finished + r.finished }), { wins: 0, finished: 0 });
const A = sum('A');
const B = sum('B');
const pa = A.wins / A.finished;
const pb = B.wins / B.finished;
const half = 1.96 * Math.sqrt((pa * (1 - pa)) / A.finished + (pb * (1 - pb)) / B.finished);
const p = (v: number) => `${(v * 100).toFixed(1)}%`;
console.log(`${size} players, seeds ${start} to ${start + games - 1}, each as the one among copies of ${against}:`);
console.log(`${a}: ${p(pa)} of ${A.finished} finished games`);
console.log(`${b}: ${p(pb)} of ${B.finished} finished games`);
console.log(`Difference: ${((pa - pb) * 100).toFixed(1)} points (${((pa - pb - half) * 100).toFixed(1)} to ${((pa - pb + half) * 100).toFixed(1)}).`);
const bySeed = (key: string) => {
  const out = Array.from({ length: games }, () => -1);
  for (const r of results) if (r.key === key) r.outcomes?.forEach((o, i) => (out[r.from - start + i] = o));
  return out;
};
console.log(describePaired(pairedDifference(bySeed('A'), bySeed('B'))));
