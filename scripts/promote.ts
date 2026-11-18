/**
 * New against best: plays a challenger against the holder of a line of succession and records
 * the result in assets/lines.json.
 *
 *   node scripts/promote.ts --line style-4 --challenger <member> [--games 4000] [--baseline-games 2000]
 *        [--league <league.json>] [--workers 8]
 *   node scripts/promote.ts --open <line> --holder <member> --note "<why>"
 *
 * Table A: the challenger as the one among copies of the holder. Table B: the holder as the one
 * among copies of the challenger, on the same seeds. The edge is A's win share above an even share
 * plus an even share above B's. The challenger takes the line when the edge's interval lies above
 * zero, it is not worse than the holder as the one among baselines, and its worst row against the
 * league (when a league report is given) is not below the holder's by more than the interval.
 * Seeds come from the promotion range and are never used twice.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { runJobs } from './league.ts';

const FILE = 'assets/lines.json';
const FIRST_SEED = 1_500_000;
const LAST_SEED = 1_999_999;

interface Match {
  date: string;
  challenger: string;
  holder: string;
  seeds: [number, number];
  a: number;
  b: number;
  edge: number;
  low: number;
  high: number;
  baselineDifference: number | null;
  worstRow: string;
  promoted: boolean;
}

interface Line {
  holder: string;
  holders: { member: string; since: string; note: string }[];
  matches: Match[];
}

interface Lines {
  note: string;
  nextSeed: number;
  lines: Record<string, Line>;
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

function read(): Lines {
  if (!existsSync(FILE)) {
    return {
      note: 'Lines of succession: the holder of each line is the best version so far, and only a challenger that beats it at the table takes its place. Written by scripts/promote.ts; see docs/plan/README.md, "New against best".',
      nextSeed: FIRST_SEED,
      lines: {},
    };
  }
  return JSON.parse(readFileSync(FILE, 'utf8')) as Lines;
}

function write(lines: Lines): void {
  writeFileSync(FILE, `${JSON.stringify(lines, null, 2)}\n`);
}

const today = () => new Date().toISOString().slice(0, 10);

if (process.argv.includes('--open')) {
  const name = option('--open') as string;
  const holder = option('--holder');
  if (!holder) throw new Error('Give --holder <member>.');
  const lines = read();
  if (lines.lines[name]) throw new Error(`The line ${name} is already open.`);
  lines.lines[name] = { holder, holders: [{ member: holder, since: today(), note: option('--note') ?? 'Opens the line.' }], matches: [] };
  write(lines);
  console.log(`Opened ${name}, held by ${holder}.`);
} else {
  const name = option('--line');
  const challenger = option('--challenger');
  if (!name || !challenger) throw new Error('Give --line and --challenger.');
  const lines = read();
  const line = lines.lines[name];
  if (!line) throw new Error(`No line named ${name}. Open it first.`);
  const size = Number(name.split('-').pop());
  if (![2, 3, 4].includes(size)) throw new Error(`The line ${name} does not end in a table size.`);
  const games = Number(option('--games') ?? 4000);
  const baselineGames = Number(option('--baseline-games') ?? 2000);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const start = lines.nextSeed;
  const end = start + games - 1;
  if (end > LAST_SEED) throw new Error('The promotion range of seeds is used up.');
  const chunk = Math.max(100, Math.ceil(games / (workers * 2)));
  const pair = (x: string, y: string, from: number, to: number, key: string) => {
    const jobs = [];
    for (let f = from; f <= to; f += chunk) jobs.push({ kind: 'pair' as const, size, x, y, from: f, to: Math.min(to, f + chunk - 1), key });
    return jobs;
  };
  const results = await runJobs(
    [
      ...pair(challenger, line.holder, start, end, 'A'),
      ...pair(line.holder, challenger, start, end, 'B'),
      ...pair(challenger, 'baseline', start, start + baselineGames - 1, 'CB'),
      ...pair(line.holder, 'baseline', start, start + baselineGames - 1, 'HB'),
    ],
    workers,
  );
  const sum = (key: string) => results.filter((r) => r.key === key).reduce((t, r) => ({ wins: t.wins + r.wins, finished: t.finished + r.finished }), { wins: 0, finished: 0 });
  const A = sum('A');
  const B = sum('B');
  const CB = sum('CB');
  const HB = sum('HB');
  const even = 1 / size;
  const a = A.wins / A.finished;
  const b = B.wins / B.finished;
  const edge = a - even + (even - b);
  // The two tables are treated as independent, which widens the interval if they are positively related.
  const half = 1.96 * Math.sqrt((a * (1 - a)) / A.finished + (b * (1 - b)) / B.finished);
  const cb = CB.wins / CB.finished;
  const hb = HB.wins / HB.finished;
  const diff = cb - hb;
  const diffHalf = 1.96 * Math.sqrt((cb * (1 - cb)) / CB.finished + (hb * (1 - hb)) / HB.finished);
  let worstRow = 'not checked: no league report given';
  let worstOk = true;
  const leagueFile = option('--league');
  if (leagueFile) {
    const league = JSON.parse(readFileSync(leagueFile, 'utf8'))[size] as { matrix: Record<string, Record<string, number>> } | undefined;
    const worst = (m: string) => Math.min(...Object.values(league?.matrix[m] ?? { none: NaN }));
    const c = worst(challenger);
    const h = worst(line.holder);
    if (Number.isFinite(c) && Number.isFinite(h)) {
      worstOk = c >= h - 0.03;
      worstRow = `challenger ${(c * 100).toFixed(1)}%, holder ${(h * 100).toFixed(1)}%`;
    }
  }
  const promoted = edge - half > 0 && diff + diffHalf >= 0 && worstOk;
  const match: Match = {
    date: today(),
    challenger,
    holder: line.holder,
    seeds: [start, end],
    a,
    b,
    edge,
    low: edge - half,
    high: edge + half,
    baselineDifference: diff,
    worstRow,
    promoted,
  };
  line.matches.push(match);
  if (promoted) {
    line.holder = challenger;
    line.holders.push({ member: challenger, since: today(), note: `Beat ${match.holder} by an edge of ${(edge * 100).toFixed(1)} points (${(match.low * 100).toFixed(1)} to ${(match.high * 100).toFixed(1)}).` });
  }
  lines.nextSeed = end + 1;
  write(lines);
  const p = (v: number) => `${(v * 100).toFixed(1)}%`;
  console.log(`# ${name}: ${challenger} against ${match.holder}\n`);
  console.log(`Seeds ${start} to ${end}; an even share is ${p(even)}.\n`);
  console.log('| Table | Win share | Games finished |');
  console.log('| --- | ---: | ---: |');
  console.log(`| A: ${challenger} among copies of ${match.holder} | ${p(a)} | ${A.finished} |`);
  console.log(`| B: ${match.holder} among copies of ${challenger} | ${p(b)} | ${B.finished} |`);
  console.log(`| ${challenger} among baselines | ${p(cb)} | ${CB.finished} |`);
  console.log(`| ${match.holder} among baselines | ${p(hb)} | ${HB.finished} |`);
  console.log('');
  console.log(`Edge ${(edge * 100).toFixed(1)} points (${(match.low * 100).toFixed(1)} to ${(match.high * 100).toFixed(1)}). Against baselines the challenger is ${(diff * 100).toFixed(1)} points ${diff >= 0 ? 'ahead' : 'behind'} (± ${(diffHalf * 100).toFixed(1)}). Worst row: ${worstRow}.`);
  console.log(promoted ? `\n${challenger} takes the line.` : `\n${match.holder} keeps the line.`);
}
