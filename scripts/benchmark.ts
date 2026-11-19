/**
 * Plays whole games between the built-in agents on the Three Kingdoms board and prints how
 * fast the engine runs, how long games last, how often each kind of decision comes up, and
 * who wins. The figures in docs/ai.md and docs/engine.md come from this script.
 *
 *   node scripts/benchmark.ts          200 games per table
 *   node scripts/benchmark.ts 1000     1000 games per table
 */
import {
  chooseHeuristicAction,
  chooseRandomAction,
  createAgentMemory,
  createEngine,
  SHORT_GAME_RULES,
  threeKingdoms,
} from '../src/index.ts';
import type { Action, Engine, GameState, PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';

type Policy = 'rules' | 'random';

interface Table {
  label: string;
  engine: Engine;
  /** The policy of each player, by seat before the opening roll. */
  seats: Policy[];
}

interface KindTally {
  decisions: number;
  legal: number;
  mostLegal: number;
}

interface Tally {
  games: number;
  finished: number;
  actions: number;
  turns: number;
  seconds: number;
  wins: Record<Policy, number>;
  firstToMoveWins: number;
  kinds: Map<string, KindTally>;
}

/** Actions after which an unfinished game is abandoned. */
const ACTION_LIMIT = 40000;

function decisionKind(state: GameState): string {
  if (state.turn.phase === 'order') return 'opening roll';
  return state.pending.at(-1)?.kind ?? 'free turn';
}

function playGame(table: Table, seed: number, tally: Tally): void {
  const { engine, seats } = table;
  const ids = seats.map((_, i) => `p${i + 1}`);
  const policyOf = (id: PlayerId) => seats[ids.indexOf(id)];
  const holder = { rng: seedFrom(`benchmark-${seed}`) };
  const random = () => nextFloat(holder);
  const memory = createAgentMemory();

  let state = engine.newGame({ players: ids, seed });
  let actions = 0;
  while (state.winner === null && actions < ACTION_LIMIT) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];

    const legal = engine.legalActions(state, actor).length;
    const kind = decisionKind(state);
    const entry = tally.kinds.get(kind) ?? { decisions: 0, legal: 0, mostLegal: 0 };
    entry.decisions += 1;
    entry.legal += legal;
    entry.mostLegal = Math.max(entry.mostLegal, legal);
    tally.kinds.set(kind, entry);

    const action: Action | null =
      policyOf(actor) === 'rules'
        ? chooseHeuristicAction(engine, state, actor, random, memory)
        : chooseRandomAction(engine, state, random, actor);
    if (!action) throw new Error(`Seed ${seed}: ${actor} has no action. Pending: ${JSON.stringify(state.pending)}`);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`Seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    state = result.state;
    actions += 1;
  }

  tally.games += 1;
  tally.actions += actions;
  tally.turns += state.turn.number;
  if (state.winner !== null) {
    tally.finished += 1;
    tally.wins[policyOf(state.winner)] += 1;
    if (state.players[0].id === state.winner) tally.firstToMoveWins += 1;
  }
}

function run(table: Table, games: number): Tally {
  const tally: Tally = {
    games: 0,
    finished: 0,
    actions: 0,
    turns: 0,
    seconds: 0,
    wins: { rules: 0, random: 0 },
    firstToMoveWins: 0,
    kinds: new Map(),
  };
  const started = performance.now();
  for (let seed = 1; seed <= games; seed++) playGame(table, seed, tally);
  tally.seconds = (performance.now() - started) / 1000;
  return tally;
}

/** A 95% Wilson interval for a share, in percentage points. */
function interval(wins: number, games: number): string {
  if (games === 0) return 'n/a';
  const z = 1.96;
  const share = wins / games;
  const centre = (share + (z * z) / (2 * games)) / (1 + (z * z) / games);
  const half = (z * Math.sqrt((share * (1 - share)) / games + (z * z) / (4 * games * games))) / (1 + (z * z) / games);
  return `${(share * 100).toFixed(1)}% (${((centre - half) * 100).toFixed(1)} to ${((centre + half) * 100).toFixed(1)})`;
}

function report(table: Table, tally: Tally): void {
  const { games } = tally;
  console.log(`\n${table.label}`);
  console.log(`  games ${games}, finished ${tally.finished}`);
  console.log(
    `  ${(games / tally.seconds).toFixed(1)} games/s, ${Math.round(tally.actions / tally.seconds)} actions/s, ` +
      `${Math.round(tally.actions / games)} actions/game, ${Math.round(tally.turns / games)} turns/game`,
  );
  for (const policy of ['rules', 'random'] as const) {
    const seats = table.seats.filter((seat) => seat === policy).length;
    if (seats === 0) continue;
    console.log(`  wins by ${policy} (${seats} of ${table.seats.length} seats): ${interval(tally.wins[policy], tally.finished)}`);
  }
  console.log(`  wins by whoever moved first: ${interval(tally.firstToMoveWins, tally.finished)}`);
}

function reportKinds(tally: Tally): void {
  console.log('\n  decision          per game   legal actions (mean, most)');
  const rows = [...tally.kinds.entries()].sort((a, b) => b[1].decisions - a[1].decisions);
  for (const [kind, entry] of rows) {
    const perGame = (entry.decisions / tally.games).toFixed(1).padStart(8);
    const mean = (entry.legal / entry.decisions).toFixed(1).padStart(6);
    console.log(`  ${kind.padEnd(17)} ${perGame}   ${mean}, ${entry.mostLegal}`);
  }
}

const games = Number(process.argv[2] ?? 200);
if (!Number.isInteger(games) || games < 1) throw new Error('Give a whole number of games.');

const full = createEngine(threeKingdoms);
const short = createEngine(threeKingdoms, SHORT_GAME_RULES);
const tables: Table[] = [
  { label: 'Full game, four rule-based players', engine: full, seats: ['rules', 'rules', 'rules', 'rules'] },
  { label: 'Short game, four rule-based players', engine: short, seats: ['rules', 'rules', 'rules', 'rules'] },
  { label: 'Full game, two rule-based players', engine: full, seats: ['rules', 'rules'] },
  { label: 'Full game, four random players', engine: full, seats: ['random', 'random', 'random', 'random'] },
  { label: 'Full game, one rule-based player against three random', engine: full, seats: ['rules', 'random', 'random', 'random'] },
  { label: 'Full game, one random player against three rule-based', engine: full, seats: ['random', 'rules', 'rules', 'rules'] },
  { label: 'Full game, one rule-based player against one random', engine: full, seats: ['rules', 'random'] },
];

console.log(`Three Kingdoms board, ${games} games per table, seeds 1 to ${games}.`);
tables.forEach((table, i) => {
  const tally = run(table, games);
  report(table, tally);
  if (i === 0) reportKinds(tally);
});
