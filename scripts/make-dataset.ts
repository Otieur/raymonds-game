/**
 * Plays league games with a teacher in every seat and writes each decision a learner would face:
 * the observation, the mask, and the index of the action the teacher took.
 *
 *   node scripts/make-dataset.ts --out <dir> --set <name> [--teachers baseline] [--size 4]
 *        [--decisions 250000] [--seeds 3000000] [--workers 8] [--perturb 0.2]
 *
 * A set is a directory of part files of fixed-size records and an index.json. A record is 2,016
 * bytes: the observation as 985 half-precision floats, the mask as 188 bits, the action, the kind
 * of decision, whether the deciding seat won, its finishing place, the teacher's number, the game's
 * seed and the decision's number in the game. train/data.py reads it.
 *
 * Teachers' actions are mapped to the environment's indices: a bid to the highest bid level not
 * above it; an offer of one property, with at most one given back, to its three drafting steps,
 * the cash to the nearest legal level; an offer the drafting cannot express is not recorded.
 * Decisions with a single legal index are forced and are not recorded. In one game in five
 * (by `--perturb`) each decision is replaced, with chance 0.05, by a random legal action, and the
 * teacher's choice is still what is recorded.
 *
 * With `--learner <model.ts>` (correction in the manner of DAgger), one seat of each game, drawn at
 * random, plays the exported model's moves while its teacher's choices are still what is recorded,
 * so the set covers the positions the learner reaches by its own mistakes.
 */
import { fork } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACTIONS, ASK0, BID0, BUILD0, CASH0, codecFor, emptyDraft, FIXED, GIVE0, GIVE_NOTHING, legalIndices, MORTGAGE0, SELL0, UNMORTGAGE0 } from '../src/env/actions.ts';
import type { Codec, Draft } from '../src/env/actions.ts';
import { createLearnedAgent } from '../src/env/learned-agent.ts';
import { createLedger, note } from '../src/env/ledger.ts';
import { createMlp } from '../src/env/mlp.ts';
import type { Mlp, ModelWeights } from '../src/env/mlp.ts';
import { decisionKind, observe, OBS_SIZE, OBS_VERSION } from '../src/env/observe.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { Action, Engine, PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent } from '../src/sim/league.ts';
import { viewOf } from '../src/sim/measures.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import type { SeatAgent } from '../src/sim/styles.ts';
import { v1 } from '../src/sim/valuation.ts';

export const RECORD_BYTES = 2016;
const OBS_BYTES = OBS_SIZE * 2;
const ACTION_LIMIT = 40000;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

interface Pending {
  obs: Float32Array;
  mask: Uint8Array;
  action: number;
  kind: number;
  seat: PlayerId;
  teacher: number;
  step: number;
}

/** The index of an engine action under a codec, or null when it has none. */
function indexOf(engineAction: Action, codec: Codec, ctx: ReturnType<typeof contextOf>): number | null {
  const fixed = (FIXED as readonly string[]).indexOf(engineAction.type);
  const streets = ctx.propertyOrder.filter((sq) => sq.kind === 'street');
  const at = (list: typeof ctx.propertyOrder, id: string) => list.findIndex((sq) => sq.id === id);
  switch (engineAction.type) {
    case 'SETTLE_TRANSFER':
      return engineAction.lift ? 11 : 12;
    case 'BUILD':
      return BUILD0 + at(streets, engineAction.property);
    case 'SELL_BUILDING':
      return SELL0 + at(streets, engineAction.property);
    case 'MORTGAGE':
      return MORTGAGE0 + at(ctx.propertyOrder, engineAction.property);
    case 'UNMORTGAGE':
      return UNMORTGAGE0 + at(ctx.propertyOrder, engineAction.property);
    case 'BID': {
      let best: number | null = null;
      codec.bids.forEach((amount, level) => {
        if (amount !== null && amount <= engineAction.amount) best = BID0 + level;
      });
      return best ?? (codec.bids[0] !== null ? BID0 : null);
    }
    case 'SELL_BUILDINGS':
    case 'PROPOSE_TRADE':
      return null;
    default:
      return fixed >= 0 && fixed <= 10 ? fixed : null;
  }
}

function playGame(
  engine: Engine,
  teachers: string[],
  size: number,
  seed: number,
  perturb: boolean,
  out: Pending[],
  won: Map<number, [number, number]>,
  learner: Mlp | null = null,
): void {
  const ctx = contextOf(engine);
  const holder = { rng: seedFrom(`dataset-${size}-${seed}`) };
  const random = () => nextFloat(holder);
  const ids = Array.from({ length: size }, (_, i) => `p${i + 1}`);
  const names = ids.map(() => teachers[Math.floor(random() * teachers.length)]);
  const agents = new Map<PlayerId, SeatAgent>(ids.map((id, i) => [id, memberAgent(names[i])]));
  const driven = learner ? ids[Math.floor(random() * size)] : null;
  const pupil = learner ? createLearnedAgent(learner, engine) : null;
  const teacherOf = new Map(ids.map((id, i) => [id, i]));
  const ledger = createLedger();
  const eliminated: PlayerId[] = [];
  let state = engine.newGame({ players: ids, seed });
  const start = out.length;
  let step = 0;
  // Offers made this turn by each seat: a learner has two a turn, and the observation says how many are left.
  const made = new Map<PlayerId, number>();
  let turn = state.turn.number;
  const left = (actor: PlayerId) => Math.max(0, 2 - (made.get(actor) ?? 0));
  const record = (actor: PlayerId, draft: Draft, codec: Codec, index: number) => {
    const seat = state.players.findIndex((p) => p.id === actor);
    const chances = v1(size).chances(ctx, state);
    const obs = observe({ ctx, state, view: viewOf(ctx, state), seat, ledger, chances, draft, proposalsLeft: left(actor), shortGame: false });
    out.push({ obs, mask: codec.mask, action: index, kind: decisionKind(state), seat: actor, teacher: teacherOf.get(actor) ?? 0, step: step++ });
  };
  for (let actions = 0; state.winner === null && actions < ACTION_LIMIT; actions++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const agent = agents.get(actor) as SeatAgent;
    let action = agent.choose(engine, state, actor, random);
    if (!action) throw new Error(`Seed ${seed}: ${actor} has no action.`);
    const codec = codecFor(ctx, engine, state, actor, emptyDraft(), { drafting: true, proposalsLeft: left(actor), refused: new Set() });
    const legal = legalIndices(codec.mask);
    if (action.type === 'PROPOSE_TRADE' && action.receive.properties.length === 1 && action.give.properties.length <= 1) {
      const k = ctx.propertyOrder.findIndex((sq) => sq.id === (action as Extract<Action, { type: 'PROPOSE_TRADE' }>).receive.properties[0]);
      if (codec.mask[ASK0 + k]) {
        const a = action;
        record(actor, emptyDraft(), codec, ASK0 + k);
        const giveDraft: Draft = { stage: 'give', partner: a.to, ask: k, give: null };
        const giveCodec = codecFor(ctx, engine, state, actor, giveDraft, { drafting: true, proposalsLeft: left(actor), refused: new Set() });
        const g = a.give.properties.length === 1 ? ctx.propertyOrder.findIndex((sq) => sq.id === a.give.properties[0]) : -1;
        const giveIndex = g === -1 ? GIVE_NOTHING : GIVE0 + g;
        if (giveCodec.mask[giveIndex]) {
          record(actor, giveDraft, giveCodec, giveIndex);
          const cashDraft: Draft = { ...giveDraft, stage: 'cash', give: g === -1 ? null : g };
          const cashCodec = codecFor(ctx, engine, state, actor, cashDraft, { drafting: true, proposalsLeft: left(actor), refused: new Set() });
          const flow = a.give.cash - a.receive.cash;
          const price = ctx.propertyOrder[k].price;
          const amounts = [...[-1, -0.5, 0, 0.5, 1, 1.5, 2, 3].map((m) => Math.round(m * price)), Number.POSITIVE_INFINITY];
          let best = -1;
          let gap = Infinity;
          amounts.forEach((amount, level) => {
            if (!cashCodec.mask[CASH0 + level]) return;
            const value = Number.isFinite(amount) ? amount : flow;
            if (Math.abs(value - flow) < gap) {
              gap = Math.abs(value - flow);
              best = level;
            }
          });
          if (best >= 0) record(actor, cashDraft, cashCodec, CASH0 + best);
        }
      }
    } else if (legal.length > 1) {
      const index = indexOf(action, codec, ctx);
      if (index !== null && codec.mask[index]) record(actor, emptyDraft(), codec, index);
    }
    if (pupil && actor === driven) {
      action = pupil.choose(engine, state, actor, random) ?? action;
    } else if (perturb && legal.length > 1 && random() < 0.05) {
      const pick = legal[Math.floor(random() * legal.length)];
      const decoded = codec.decode(pick);
      if (decoded.kind === 'engine') action = decoded.action;
    }
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`Seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    if (action.type === 'PROPOSE_TRADE') made.set(actor, (made.get(actor) ?? 0) + 1);
    state = result.state;
    if (state.turn.number !== turn) {
      turn = state.turn.number;
      made.clear();
    }
    note(ctx, ledger, state, result.events);
    for (const a of agents.values()) a.observe(result.events, state);
    pupil?.observe(result.events, state);
    for (const event of result.events) if (event.type === 'BANKRUPT') eliminated.push(event.player);
  }
  const winner = state.winner;
  const order = winner ? [winner, ...state.players.filter((p) => p.id !== winner && !eliminated.includes(p.id)).map((p) => p.id), ...[...eliminated].reverse()] : [];
  for (let i = start; i < out.length; i++) {
    const seat = out[i].seat;
    won.set(i, [winner === seat ? 1 : 0, winner ? order.indexOf(seat) + 1 : 0]);
  }
}

function encodePart(records: Pending[], won: Map<number, [number, number]>, seeds: number[]): Buffer {
  const buffer = Buffer.alloc(records.length * RECORD_BYTES);
  records.forEach((r, i) => {
    const base = i * RECORD_BYTES;
    const half = new Float16Array(r.obs);
    Buffer.from(half.buffer).copy(buffer, base);
    for (let a = 0; a < ACTIONS; a++) if (r.mask[a]) buffer[base + OBS_BYTES + (a >> 3)] |= 1 << (a & 7);
    const o = base + OBS_BYTES + 24;
    buffer.writeInt16LE(r.action, o);
    buffer.writeInt8(r.kind, o + 2);
    const [w, place] = won.get(i) ?? [0, 0];
    buffer.writeInt8(w, o + 3);
    buffer.writeInt8(place, o + 4);
    buffer.writeInt16LE(r.teacher, o + 6);
    buffer.writeInt32LE(seeds[i], o + 8);
    buffer.writeInt32LE(r.step, o + 12);
  });
  return buffer;
}

interface Job {
  part: number;
  from: number;
  to: number;
}

if (process.argv[2] === '--worker') {
  const engine = createEngine(threeKingdoms);
  const teachers = (option('--teachers') ?? 'baseline').split(',');
  const size = Number(option('--size') ?? 4);
  const perturbShare = Number(option('--perturb') ?? 0.2);
  const dir = option('--dir') as string;
  const learnerPath = option('--learner');
  const learner = learnerPath ? createMlp(((await import(pathToFileURL(resolve(learnerPath)).href)) as { MODEL: ModelWeights }).MODEL) : null;
  process.on('message', (job: Job) => {
    const records: Pending[] = [];
    const won = new Map<number, [number, number]>();
    const seeds: number[] = [];
    for (let seed = job.from; seed <= job.to; seed++) {
      const before = records.length;
      const perturb = seedFrom(`perturb-${seed}`) % 1000 < perturbShare * 1000;
      playGame(engine, teachers, size, seed, perturb, records, won, learner);
      for (let i = before; i < records.length; i++) seeds.push(seed);
    }
    const file = join(dir, `part-${String(job.part).padStart(5, '0')}.bin`);
    writeFileSync(`${file}.tmp`, encodePart(records, won, seeds));
    renameSync(`${file}.tmp`, file);
    process.send?.({ part: job.part, decisions: records.length, games: job.to - job.from + 1 });
  });
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const out = option('--out');
  const set = option('--set');
  if (!out || !set) throw new Error('Give --out <dir> and --set <name>.');
  const dir = join(out, set);
  mkdirSync(dir, { recursive: true });
  const target = Number(option('--decisions') ?? 250000);
  const start = Number(option('--seeds') ?? 3_000_000);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const size = Number(option('--size') ?? 4);
  const gamesPerPart = Number(option('--games-per-part') ?? 100);
  const args = ['--worker', '--dir', dir, '--size', String(size), '--teachers', option('--teachers') ?? 'baseline', '--perturb', option('--perturb') ?? '0.2'];
  if (option('--learner')) args.push('--learner', option('--learner') as string);
  let decisions = 0;
  let games = 0;
  let next = 0;
  const parts: { part: number; decisions: number; seeds: [number, number] }[] = [];
  const began = performance.now();
  await new Promise<void>((resolve, reject) => {
    let running = 0;
    for (let w = 0; w < workers; w++) {
      const child = fork(fileURLToPath(import.meta.url), args);
      running += 1;
      const give = () => {
        if (decisions >= target) {
          child.disconnect();
          return;
        }
        const from = start + next * gamesPerPart;
        child.send({ part: next, from, to: from + gamesPerPart - 1 });
        next += 1;
      };
      child.on('message', (m: { part: number; decisions: number; games: number }) => {
        decisions += m.decisions;
        games += m.games;
        const from = start + m.part * gamesPerPart;
        parts.push({ part: m.part, decisions: m.decisions, seeds: [from, from + m.games - 1] });
        process.stderr.write(`${decisions} decisions from ${games} games, ${((performance.now() - began) / 1000).toFixed(0)} s\n`);
        give();
      });
      child.on('exit', (code) => {
        running -= 1;
        if (code) reject(new Error(`A worker stopped with code ${code}.`));
        if (running === 0) resolve();
      });
      child.on('error', reject);
      give();
    }
  });
  parts.sort((a, b) => a.part - b.part);
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify({ set, size, teachers: option('--teachers') ?? 'baseline', learner: option('--learner') ?? null, recordBytes: RECORD_BYTES, obs: OBS_SIZE, obsVersion: OBS_VERSION, actions: ACTIONS, decisions, games, parts }, null, 2),
  );
  console.log(`${set}: ${decisions} decisions from ${games} games in ${((performance.now() - began) / 1000).toFixed(0)} s.`);
}
