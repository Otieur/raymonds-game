/**
 * Two named tables played on the same seeds, compared game by game.
 *
 *   node scripts/compare-tables.ts <a.json> <b.json> --seats 3 [--seats-b 3]
 *
 * The files are the --json output of scripts/table.ts. --seats names the seats, 1-based and
 * comma-separated, whose wins count for table A; --seats-b names them for table B and defaults to
 * the same. Prints each table's share, the difference with the interval of independent samples, and
 * the difference paired by seed over the seeds where both games finished.
 */
import { readFileSync } from 'node:fs';
import { describePaired, outcomesFor, pairedDifference } from '../src/sim/intervals.ts';

interface TableFile {
  names: string[];
  seeds: [number, number];
  winners?: number[];
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const files = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (files.length !== 2) throw new Error('Give two table files: compare-tables.ts <a.json> <b.json> --seats 3');
const seatsOf = (text: string | undefined, size: number) => {
  const seats = (text ?? '').split(',').filter(Boolean).map(Number);
  if (seats.length === 0) throw new Error('Name the seats to compare with --seats, for example --seats 3 or --seats 3,4.');
  for (const seat of seats) if (!Number.isInteger(seat) || seat < 1 || seat > size) throw new Error(`No seat ${seat} at a table of ${size}.`);
  return seats;
};
const [a, b] = files.map((file) => {
  const table = JSON.parse(readFileSync(file, 'utf8')) as TableFile;
  if (!table.winners) throw new Error(`${file} keeps no winners by game: it was written before table.ts kept them. Play the table again with --json.`);
  return { file, table };
});
if (a.table.seeds[0] !== b.table.seeds[0] || a.table.seeds[1] !== b.table.seeds[1]) {
  throw new Error(`The tables were played on different seeds (${a.table.seeds.join(' to ')} and ${b.table.seeds.join(' to ')}).`);
}
const seatsA = seatsOf(option('--seats'), a.table.names.length);
const seatsB = seatsOf(option('--seats-b') ?? option('--seats'), b.table.names.length);
const outcomesA = outcomesFor(a.table.winners ?? [], seatsA.map((s) => s - 1));
const outcomesB = outcomesFor(b.table.winners ?? [], seatsB.map((s) => s - 1));
const share = (o: number[]) => {
  const finished = o.filter((x) => x >= 0).length;
  return { wins: o.filter((x) => x === 1).length, finished };
};
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const label = (t: TableFile, seats: number[]) => `${t.names.join(', ')}; seat${seats.length > 1 ? 's' : ''} ${seats.join(' and ')} (${seats.map((s) => t.names[s - 1]).join(', ')})`;
const A = share(outcomesA);
const B = share(outcomesB);
const pa = A.wins / A.finished;
const pb = B.wins / B.finished;
const half = 1.96 * Math.sqrt((pa * (1 - pa)) / A.finished + (pb * (1 - pb)) / B.finished);
console.log(`Seeds ${a.table.seeds[0]} to ${a.table.seeds[1]}.`);
console.log(`A: ${label(a.table, seatsA)}: ${pct(pa)} of ${A.finished} finished games.`);
console.log(`B: ${label(b.table, seatsB)}: ${pct(pb)} of ${B.finished} finished games.`);
console.log(`Difference: ${((pa - pb) * 100).toFixed(1)} points (${((pa - pb - half) * 100).toFixed(1)} to ${((pa - pb + half) * 100).toFixed(1)}) as independent samples.`);
console.log(describePaired(pairedDifference(outcomesA, outcomesB)));
