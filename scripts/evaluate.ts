/**
 * Scores an exported model as one seat among copies of a league member, in TypeScript.
 *
 *   node scripts/evaluate.ts --model assets/models/<name>.ts [--against baseline] [--size 4] [--games 1000] [--seeds 1000000]
 *
 * Every action goes through the engine's checks; a refused action or a broken invariant stops the
 * run. Prints the win share with its interval, how often the agent fell back to the rule-based
 * agent, and the time a decision took.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLearnedAgent } from '../src/env/learned-agent.ts';
import { createMlp } from '../src/env/mlp.ts';
import { DECISION_KINDS } from '../src/env/observe.ts';
import type { ModelWeights } from '../src/env/mlp.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent } from '../src/sim/league.ts';
import type { SeatAgent } from '../src/sim/styles.ts';

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const { MODEL } = (await import(pathToFileURL(resolve(option('--model') as string)).href)) as { MODEL: ModelWeights };
const against = option('--against') ?? 'baseline';
const size = Number(option('--size') ?? 4);
const games = Number(option('--games') ?? 1000);
const start = Number(option('--seeds') ?? 1_000_000);
// --rules-for auction,trade: those kinds of decision go to the rule-based agent (for diagnosis).
const rulesFor = (option('--rules-for') ?? '').split(',').filter(Boolean).map((name) => {
  const k = (DECISION_KINDS as readonly string[]).indexOf(name);
  if (k < 0) throw new Error(`No kind of decision named ${name}.`);
  return k;
});
// --rules-when-legal BUILD: any decision where one of these action types is legal goes to the rule-based agent.
const rulesWhenLegal = option('--rules-when-legal')?.split(',');
const engine = createEngine(threeKingdoms);
const mlp = createMlp(MODEL);
let wins = 0;
let finished = 0;
let fallbacks = 0;
let decisions = 0;
let thinking = 0;
// --tally: the learner's actions on its free turns, by type, a game.
const tally = new Map<string, number>();
for (let seed = start; seed < start + games; seed++) {
  const holder = { rng: seedFrom(`evaluate-${size}-${seed}`) };
  const random = () => nextFloat(holder);
  const ids = Array.from({ length: size }, (_, i) => `p${i + 1}`);
  const learned = createLearnedAgent(mlp, engine, { rulesFor, rulesWhenLegal, proposals: !process.argv.includes('--no-proposals') });
  const agents = new Map<PlayerId, SeatAgent>(ids.map((id, i) => [id, i === 0 ? learned : memberAgent(against)]));
  let state = engine.newGame({ players: ids, seed });
  for (let actions = 0; state.winner === null && actions < 40000; actions++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const began = actor === 'p1' ? performance.now() : 0;
    const action = agents.get(actor)?.choose(engine, state, actor, random);
    if (actor === 'p1') {
      thinking += performance.now() - began;
      decisions += 1;
    }
    if (!action) throw new Error(`Seed ${seed}: ${actor} has no action.`);
    if (actor === 'p1' && state.pending.length === 0) tally.set(action.type, (tally.get(action.type) ?? 0) + 1);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`Seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    state = result.state;
    const broken = engine.checkInvariants(state);
    if (broken.length > 0) throw new Error(`Seed ${seed}: ${broken.join('; ')}`);
    for (const agent of agents.values()) agent.observe(result.events, state);
  }
  fallbacks += learned.fallbacks();
  if (state.winner !== null) {
    finished += 1;
    if (state.winner === 'p1') wins += 1;
  }
}
const p = wins / finished;
const half = 1.96 * Math.sqrt((p * (1 - p)) / finished);
console.log(
  `${MODEL.name}${rulesFor.length ? ` (rules for ${rulesFor.map((k) => DECISION_KINDS[k]).join(', ')})` : ''}${process.argv.includes('--no-proposals') ? ' (no offers)' : ''}${rulesWhenLegal ? ` (rules when ${rulesWhenLegal.join(', ')} is legal)` : ''} as the one among ${size - 1} ${against}, seeds ${start} to ${start + games - 1}: ${(p * 100).toFixed(1)}% (${((p - half) * 100).toFixed(1)} to ${((p + half) * 100).toFixed(1)}) of ${finished} finished games; ` +
    `${fallbacks} fallbacks in ${decisions} decisions; ${(thinking / Math.max(1, decisions)).toFixed(2)} ms a decision; no refused action.`,
);
if (process.argv.includes('--tally')) {
  console.log(`Free-turn actions a game: ${[...tally].sort((a, b) => b[1] - a[1]).map(([type, n]) => `${type} ${(n / games).toFixed(2)}`).join(', ')}`);
}
