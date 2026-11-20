/**
 * Scores an exported model as one seat among copies of a league member, in TypeScript.
 *
 *   node scripts/evaluate.ts --model assets/models/<name>.ts [--against baseline] [--size 4] [--games 1000] [--seeds 1000000]
 *                            [--proposer baseline] [--tally] [--sample] [--compare <member>] [--workers 1] [--suite <file>]
 *                            [--rules full|short]
 *
 * With --proposer the named school makes the model's offers and the model drafts none, which is how a
 * learner plays while drafting is off (M6). With --compare the named member then plays the same seeds
 * in the model's seat, and the difference is given paired by seed.
 *
 * With --workers N the seeds are split among N processes. Each game depends only on its seed, so the
 * figures are the same as in one process; only the time a decision takes changes with the load.
 * --tally runs in one process, since its probe of the rules draws from one stream across games.
 *
 * With --suite the model also answers an offer suite (M9) and its score is printed as one line.
 * With --rules short the games are the short game (G2's four players), and the model is told so.
 *
 * Every action goes through the engine's checks; a refused action or a broken invariant stops the
 * run. Prints the win share with its interval, how often the agent fell back to the rule-based
 * agent, and the time a decision took.
 */
import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLearnedAgent } from '../src/env/learned-agent.ts';
import { createMlp } from '../src/env/mlp.ts';
import { DECISION_KINDS } from '../src/env/observe.ts';
import type { ModelWeights } from '../src/env/mlp.ts';
import { createEngine, SHORT_GAME_RULES, threeKingdoms } from '../src/index.ts';
import type { PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { chooseHeuristicAction, createAgentMemory } from '../src/sim/heuristic-agent.ts';
import { describePaired, pairedDifference } from '../src/sim/intervals.ts';
import { describeScore, scoreSuite } from '../src/sim/offer-suite.ts';
import type { Suite } from '../src/sim/offer-suite.ts';
import { memberAgent } from '../src/sim/league.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import './model-loader.ts';
import { PRESETS } from '../src/sim/styles.ts';
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
// --proposer baseline: that school makes the model's offers, once a turn after the roll; the model drafts none.
const proposerName = option('--proposer');
const proposer = proposerName ? PRESETS[proposerName]?.playbook.base : undefined;
if (proposerName && !proposer) throw new Error(`No school named ${proposerName}.`);
const rules = option('--rules') ?? 'full';
if (rules !== 'full' && rules !== 'short') throw new Error(`--rules is full or short, not ${rules}.`);
const engine = rules === 'short' ? createEngine(threeKingdoms, SHORT_GAME_RULES) : createEngine(threeKingdoms);
const mlp = createMlp(MODEL);
let wins = 0;
let finished = 0;
let fallbacks = 0;
let decisions = 0;
let thinking = 0;
// --tally: the learner's actions on its free turns, by type, a game.
const tally = new Map<string, number>();
// With --tally, also: decisions after the roll where the rule-based agent would start an offer, and how often the learner did.
let chances = 0;
let taken = 0;
const probe = { rng: seedFrom('evaluate-probe') };
/** Plays one game with `first` in seat 1 among copies of the opponent; 1 a win for seat 1, 0 none, -1 unfinished. */
function play(seed: number, first: SeatAgent, model: boolean): number {
  const holder = { rng: seedFrom(`evaluate-${size}-${seed}`) };
  const random = () => nextFloat(holder);
  const ids = Array.from({ length: size }, (_, i) => `p${i + 1}`);
  const agents = new Map<PlayerId, SeatAgent>(ids.map((id, i) => [id, i === 0 ? first : memberAgent(against)]));
  let state = engine.newGame({ players: ids, seed });
  for (let actions = 0; state.winner === null && actions < 40000; actions++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const mine = model && actor === 'p1';
    const began = mine ? performance.now() : 0;
    const action = agents.get(actor)?.choose(engine, state, actor, random);
    if (mine) {
      thinking += performance.now() - began;
      decisions += 1;
    }
    if (!action) throw new Error(`Seed ${seed}: ${actor} has no action.`);
    if (mine && state.pending.length === 0) tally.set(action.type, (tally.get(action.type) ?? 0) + 1);
    if (mine && state.pending.length === 0 && state.turn.phase === 'postRoll' && process.argv.includes('--tally')) {
      const rules = chooseHeuristicAction(engine, state, actor, () => nextFloat(probe), createAgentMemory());
      if (rules?.type === 'PROPOSE_TRADE') {
        chances += 1;
        if (action.type === 'PROPOSE_TRADE') taken += 1;
      }
    }
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`Seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    state = result.state;
    const broken = engine.checkInvariants(state);
    if (broken.length > 0) throw new Error(`Seed ${seed}: ${broken.join('; ')}`);
    for (const agent of agents.values()) agent.observe(result.events, state);
  }
  return state.winner === null ? -1 : state.winner === 'p1' ? 1 : 0;
}
const compareName = option('--compare');

/** What one range of seeds gives: outcomes by seed for the model (and the compared member), and the counts behind the report. */
interface Part {
  from: number;
  outcomes: number[];
  other: number[];
  fallbacks: number;
  decisions: number;
  thinking: number;
}

/** Plays the seeds from `from` for `count` games: the model, then the compared member on the same seeds. */
function playRange(from: number, count: number): Part {
  const part: Part = { from, outcomes: [], other: [], fallbacks: 0, decisions: 0, thinking: 0 };
  const [decisionsBefore, thinkingBefore] = [decisions, thinking];
  for (let seed = from; seed < from + count; seed++) {
    const learned = createLearnedAgent(mlp, engine, { rulesFor, rulesWhenLegal, proposals: !process.argv.includes('--no-proposals'), proposer, greedy: !process.argv.includes('--sample') });
    part.outcomes.push(play(seed, learned, true));
    part.fallbacks += learned.fallbacks();
  }
  if (compareName) for (let seed = from; seed < from + count; seed++) part.other.push(play(seed, memberAgent(compareName), false));
  part.decisions = decisions - decisionsBefore;
  part.thinking = thinking - thinkingBefore;
  return part;
}

if (process.argv.includes('--worker')) {
  process.on('message', (job: { from: number; count: number }) => process.send?.(playRange(job.from, job.count)));
} else {
  const workers = Math.max(1, Number(option('--workers') ?? 1));
  if (workers > 1 && process.argv.includes('--tally')) throw new Error('--tally runs in one process; leave out --workers.');
  let parts: Part[];
  if (workers === 1) {
    parts = [playRange(start, games)];
  } else {
    const chunk = Math.max(10, Math.ceil(games / (workers * 4)));
    const jobs: { from: number; count: number }[] = [];
    for (let from = start; from < start + games; from += chunk) jobs.push({ from, count: Math.min(chunk, start + games - from) });
    parts = await new Promise<Part[]>((done, fail) => {
      const got: Part[] = [];
      let next = 0;
      for (let w = 0; w < Math.min(workers, jobs.length); w++) {
        const child = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), '--worker']);
        const give = () => (next < jobs.length ? child.send(jobs[next++]) : child.disconnect());
        child.on('message', (part: Part) => {
          got.push(part);
          if (got.length === jobs.length) done(got);
          give();
        });
        child.on('error', fail);
        child.on('exit', (code) => {
          if (code) fail(new Error(`A worker stopped with code ${code}.`));
        });
        give();
      }
    });
  }
  parts.sort((a, b) => a.from - b.from);
  report(parts);
}

function report(parts: Part[]): void {
  const outcomes = parts.flatMap((part) => part.outcomes);
  fallbacks = parts.reduce((sum, part) => sum + part.fallbacks, 0);
  decisions = parts.reduce((sum, part) => sum + part.decisions, 0);
  thinking = parts.reduce((sum, part) => sum + part.thinking, 0);
  for (const outcome of outcomes) {
    if (outcome >= 0) {
      finished += 1;
      if (outcome === 1) wins += 1;
    }
  }
  const p = wins / finished;
  const half = 1.96 * Math.sqrt((p * (1 - p)) / finished);
  console.log(
    `${MODEL.name}${rulesFor.length ? ` (rules for ${rulesFor.map((k) => DECISION_KINDS[k]).join(', ')})` : ''}${rules === 'short' ? ' (short game)' : ''}${process.argv.includes('--no-proposals') ? ' (no offers)' : ''}${proposerName ? ` (offers by ${proposerName})` : ''}${process.argv.includes('--sample') ? ' (sampling)' : ''}${rulesWhenLegal ? ` (rules when ${rulesWhenLegal.join(', ')} is legal)` : ''} as the one among ${size - 1} ${against}, seeds ${start} to ${start + games - 1}: ${(p * 100).toFixed(1)}% (${((p - half) * 100).toFixed(1)} to ${((p + half) * 100).toFixed(1)}) of ${finished} finished games; ` +
      `${fallbacks} fallbacks in ${decisions} decisions; ${(thinking / Math.max(1, decisions)).toFixed(2)} ms a decision; no refused action.`,
  );
  if (process.argv.includes('--tally')) {
    console.log(`After the roll, the rules would start an offer ${(chances / games).toFixed(2)} times a game; the learner started one at ${taken} of those ${chances} decisions.`);
    console.log(`Free-turn actions a game: ${[...tally].sort((a, b) => b[1] - a[1]).map(([type, n]) => `${type} ${(n / games).toFixed(2)}`).join(', ')}`);
  }
  // --compare baseline: the same seeds again with that member in seat 1, and the difference paired by seed.
  if (compareName) {
    const other = parts.flatMap((part) => part.other);
    const done = other.filter((o) => o >= 0).length;
    const share = other.filter((o) => o === 1).length / done;
    console.log(`${compareName} in the same seat on the same seeds: ${(share * 100).toFixed(1)}% of ${done} finished games.`);
    console.log(describePaired(pairedDifference(outcomes, other)));
  }
  // --suite: how the model answers the offers of a suite, with the same options as its games.
  const suiteFile = option('--suite');
  if (suiteFile) {
    const suite = JSON.parse(readFileSync(suiteFile, 'utf8')) as Suite;
    const learned = () => createLearnedAgent(mlp, engine, { rulesFor, rulesWhenLegal, proposals: !process.argv.includes('--no-proposals'), proposer, greedy: !process.argv.includes('--sample') });
    console.log(describeScore(MODEL.name, scoreSuite(engine, contextOf(engine), suite, learned)));
  }
}
