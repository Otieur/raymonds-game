import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, ASK0, BID0, BUILD0, codecFor, emptyDraft, legalIndices, MORTGAGE0, SELL0, UNMORTGAGE0 } from '../../src/env/actions.ts';
import { createEnv, DEFAULT_CONFIG } from '../../src/env/env.ts';
import type { EnvConfig, Step } from '../../src/env/env.ts';
import { createLedger, ledgerOf, note } from '../../src/env/ledger.ts';
import { observe, OBS_LAYOUT, OBS_SIZE, OBS_VERSION } from '../../src/env/observe.ts';
import { createMlp } from '../../src/env/mlp.ts';
import { POTENTIALS } from '../../src/env/potentials.ts';
import { v1 } from '../../src/sim/valuation.ts';
import { potential, potentialContext } from '../../src/env/potentials.ts';
import { chooseHeuristicAction, createAgentMemory, createEngine, threeKingdoms } from '../../src/index.ts';
import type { GameEvent, GameState } from '../../src/index.ts';
import { viewOf } from '../../src/sim/measures.ts';
import { contextOf } from '../../src/sim/style-agent.ts';

const engine = createEngine(threeKingdoms);
const ctx = contextOf(engine);
const GAMES = Number(process.env.ENV_CHECK_GAMES ?? 4);

function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const config = (changes: Partial<EnvConfig> = {}): EnvConfig => ({ ...DEFAULT_CONFIG, drafting: true, ...changes });

test('the observation layout is contiguous, named once each, and 1,023 numbers long', () => {
  let offset = 0;
  for (const block of OBS_LAYOUT) {
    assert.equal(block.offset, offset, block.name);
    offset += block.length;
  }
  assert.equal(offset, 1023);
  assert.equal(OBS_SIZE, 1023);
  assert.equal(OBS_VERSION, 3);
  assert.equal(new Set(OBS_LAYOUT.map((b) => b.name)).size, OBS_LAYOUT.length);
});

test('the mask marks exactly the actions the engine allows, and every marked action decodes to one it accepts', () => {
  for (const players of [2, 3, 4] as const) {
    const env = createEnv(config({ players, seeds: { start: 500 + players, step: 1 } }));
    const random = generator(players);
    let step = env.reset();
    let games = 0;
    while (games < GAMES) {
      if (step.done) {
        games += 1;
        step = env.step(0);
        continue;
      }
      const state = env.state;
      const actor = state.players[step.seat].id;
      const draftStage = step.observation[OBS_LAYOUT.find((b) => b.name === 'table')!.offset + 15];
      if (draftStage === 1) {
        const c = codecFor(ctx, engine, state, actor, emptyDraft(), { drafting: true, proposalsLeft: 2, refused: new Set() });
        for (const index of legalIndices(c.mask)) {
          const decoded = c.decode(index);
          if (decoded.kind === 'engine') assert.equal(engine.validate(state, decoded.action), null, `index ${index}`);
        }
        // Every engine action with an index is marked.
        for (const a of engine.legalActions(state, actor)) {
          const streets = ctx.propertyOrder.filter((sq) => sq.kind === 'street');
          const at = (offset: number, id: string, list = ctx.propertyOrder) => offset + list.findIndex((sq) => sq.id === id);
          if (a.type === 'BUILD') assert.equal(c.mask[at(BUILD0, a.property, streets)], 1);
          if (a.type === 'SELL_BUILDING') assert.equal(c.mask[at(SELL0, a.property, streets)], 1);
          if (a.type === 'MORTGAGE') assert.equal(c.mask[at(MORTGAGE0, a.property)], 1);
          if (a.type === 'UNMORTGAGE') assert.equal(c.mask[at(UNMORTGAGE0, a.property)], 1);
          if (a.type === 'BID') assert.ok(c.bids.some((amount) => amount !== null && amount >= a.min && amount <= a.max));
        }
        for (let level = 0; level < 8; level++) {
          const amount = c.bids[level];
          if (amount !== null) assert.equal(c.bids.indexOf(amount), level, 'bid levels have distinct amounts');
          assert.equal(c.mask[BID0 + level], amount === null ? 0 : 1);
        }
      }
      const legal = legalIndices(step.legal);
      assert.ok(legal.length >= 2, 'a decision put to the learner has a choice');
      step = env.step(legal[Math.floor(random() * legal.length)]);
    }
  }
});

test('the observation does not change with the deck order, the generator or the dice queue', () => {
  const env = createEnv(config({ seeds: { start: 77, step: 1 } }));
  let step = env.reset();
  for (let i = 0; i < 60 && !step.done; i++) step = env.step(legalIndices(step.legal)[0]);
  const state = env.state;
  const input = (s: GameState) => ({
    ctx,
    state: s,
    view: viewOf(ctx, s),
    seat: 0,
    ledger: createLedger(),
    chances: [0.25, 0.25, 0.25, 0.25],
    draft: emptyDraft(),
    proposalsLeft: 2,
    shortGame: false,
  });
  const before = observe(input(state));
  const changed = structuredClone(state);
  for (const deck of Object.values(changed.decks)) deck.reverse();
  changed.rng = 12345;
  changed.diceQueue = [[6, 6]];
  assert.deepEqual(observe(input(changed)), before);
});

test('renaming the players changes nothing in the observation', () => {
  const env = createEnv(config({ seeds: { start: 91, step: 1 } }));
  let step = env.reset();
  for (let i = 0; i < 80 && !step.done; i++) step = env.step(legalIndices(step.legal)[legalIndices(step.legal).length - 1]);
  const state = env.state;
  const renamed = structuredClone(state);
  const map: Record<string, string> = { p1: 'w', p2: 'x', p3: 'y', p4: 'z' };
  renamed.players.forEach((p) => {
    p.id = map[p.id];
  });
  for (const property of Object.values(renamed.properties)) if (property.owner) property.owner = map[property.owner];
  renamed.turn.player = map[renamed.turn.player];
  const input = (s: GameState) => ({
    ctx, state: s, view: viewOf(ctx, s), seat: 1, ledger: createLedger(), chances: [0.1, 0.2, 0.3, 0.4], draft: emptyDraft(), proposalsLeft: 2, shortGame: false,
  });
  assert.deepEqual(observe(input(renamed)), observe(input(state)));
});

test('the same seed and actions give the same steps', () => {
  const run = () => {
    const env = createEnv(config({ players: 3, seeds: { start: 31, step: 1 } }));
    const random = generator(5);
    const steps: Step[] = [];
    let step = env.reset();
    for (let i = 0; i < 400; i++) {
      steps.push(step);
      const legal = legalIndices(step.legal);
      step = env.step(step.done ? 0 : legal[Math.floor(random() * legal.length)]);
    }
    return steps;
  };
  const a = run();
  const b = run();
  a.forEach((step, i) => {
    assert.equal(step.seat, b[i].seat);
    assert.deepEqual(step.observation, b[i].observation);
    assert.deepEqual(step.legal, b[i].legal);
    assert.deepEqual(step.phi, b[i].phi);
  });
});

test('potentials telescope: a building bought and sold back earns nothing', () => {
  const state = engine.newGame({ players: ['a', 'b', 'c'], seed: 1, startingPlayer: 'a' });
  for (const id of ['dong-zhuo', 'emperor-xian']) state.properties[id].owner = 'a';
  const value = (s: GameState, name: 'built3' | 'rentRoll' | 'groups') => potential(name, potentialContext(ctx, s, [1 / 3, 1 / 3, 1 / 3], createLedger()), 0);
  const built = structuredClone(state);
  built.properties['dong-zhuo'].level = 1;
  built.bank.houses -= 1;
  const sold = structuredClone(built);
  sold.properties['dong-zhuo'].level = 0;
  sold.bank.houses += 1;
  for (const name of ['built3', 'rentRoll', 'groups'] as const) {
    assert.equal(value(built, name) - value(state, name) + (value(sold, name) - value(built, name)), 0, name);
  }
});

test('a learner that always asks sends at most two offers a turn, and games still end', () => {
  const env = createEnv(config({ players: 4, seeds: { start: 600, step: 1 }, turnLimit: { 2: 310, 3: 360, 4: 410 } }));
  let step = env.reset();
  let games = 0;
  let offersThisTurn = 0;
  let turn = -1;
  while (games < 2) {
    if (step.done) {
      games += 1;
      step = env.step(0);
      continue;
    }
    if (step.info.turn !== turn) {
      turn = step.info.turn;
      offersThisTurn = 0;
    }
    const legal = legalIndices(step.legal);
    const ask = legal.find((i) => i >= ASK0 && i < ASK0 + 28);
    if (ask !== undefined) offersThisTurn += 1;
    assert.ok(offersThisTurn <= 2);
    // Ask when possible, then give nothing and offer the most cash, otherwise the first legal action.
    const pick = ask ?? legal.find((i) => i === 177) ?? legal.filter((i) => i >= 178 && i <= 186).pop() ?? legal[0];
    step = env.step(pick);
  }
});

test('the ledger rebuilt from the events equals the ledger kept while playing', () => {
  const random = generator(9);
  const memory = createAgentMemory();
  let state = engine.newGame({ players: ['p1', 'p2', 'p3', 'p4'], seed: 3 });
  const kept = createLedger();
  const history: { state: GameState; events: GameEvent[] }[] = [];
  for (let i = 0; state.winner === null && i < 40000; i++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const result = engine.apply(state, chooseHeuristicAction(engine, state, actor, random, memory) ?? { type: 'END_TURN', player: actor });
    assert.ok(result.ok);
    state = result.state;
    note(ctx, kept, state, result.events);
    history.push({ state, events: result.events });
  }
  assert.deepEqual(ledgerOf(ctx, history).seats, kept.seats);
});

test('every step has the stated sizes', () => {
  const env = createEnv(config({ potentials: ['value', 'passes', 'safety'] }));
  const step = env.reset();
  assert.equal(step.observation.length, OBS_SIZE);
  assert.equal(step.legal.length, ACTIONS);
  assert.equal(step.phi.length, 3);
});

// ---------- Layout version 3 (docs/plan/m03b-table-politics.md) ----------

const blockOf = (obs: Float32Array, name: string): number[] => {
  const block = OBS_LAYOUT.find((b) => b.name === name);
  assert.ok(block, name);
  return Array.from(obs.slice(block.offset, block.offset + block.length));
};

/** Four players at round 10 with `p1` to move after its roll. */
function position(): GameState {
  const state = engine.newGame({ players: ['p1', 'p2', 'p3', 'p4'], seed: 1, startingPlayer: 'p1' });
  state.turn.number = 41;
  state.turn.phase = 'postRoll';
  for (const [owner, ids] of Object.entries({ p1: ['wang-yun', 'diaochan'], p3: ['lu-bu'], p2: ['cao-cao', 'cao-pi'], p4: ['xun-yu'] })) {
    for (const id of ids) state.properties[id].owner = owner;
  }
  return state;
}
const seen = (state: GameState, ledger = createLedger(), seat = 0) =>
  observe({ ctx, state, view: viewOf(ctx, state), seat, ledger, chances: v1(4).chances(ctx, state), draft: emptyDraft(), proposalsLeft: 2, shortGame: false });

test('layout 3: the risk block has every seat, with the rent each expects from the others', () => {
  const state = position();
  const risk = blockOf(seen(state), 'risk');
  assert.equal(risk.length, 12);
  // Everyone stands on LuoYang: p1's two streets are six and eight squares on, so the others can owe p1 and p1 expects rent.
  assert.ok(risk[2] > 0, 'p1 expects rent');
  assert.ok(risk[3] > 0, 'p2 could owe rent');
  assert.ok(Math.abs(risk[0] - 200 / 1500) < 1e-6); // the most p1 could owe is the poll tax, four squares on
});

test('layout 3: the relations block shows refusals, deals and goodwill between me and each rival', () => {
  let state = position();
  const ledger = createLedger();
  const apply = (action: Parameters<typeof engine.apply>[1]) => {
    const result = engine.apply(state, action);
    assert.ok(result.ok, result.ok ? '' : result.error.message);
    state = result.state;
    note(ctx, ledger, state, result.events);
  };
  const quiet = blockOf(seen(state, ledger), 'relations');
  assert.deepEqual(quiet.slice(0, 6), [0, 0, 0, 0, 0, 0]);
  assert.equal(quiet[6 + 6 + 3], 1); // no offer to p3 yet: the gap reads as its largest
  const ask = (cash: number) => ({ type: 'PROPOSE_TRADE' as const, player: 'p1', to: 'p3', give: { cash, properties: [], jailCards: 0 }, receive: { cash: 0, properties: ['lu-bu'], jailCards: 0 } });
  apply(ask(240));
  apply({ type: 'REJECT_TRADE', player: 'p3' });
  const refused = blockOf(seen(state, ledger), 'relations');
  const p3 = 6 + 6; // the second rival's six numbers
  assert.ok(Math.abs(refused[p3] - 0.1) < 1e-6, 'one of my offers refused, over ten');
  assert.ok(Math.abs(refused[p3 + 2] - 0.5) < 1e-6, 'twice list refused, over four');
  assert.equal(refused[p3 + 3], 0, 'asked this turn');
  apply(ask(600));
  apply({ type: 'ACCEPT_TRADE', player: 'p3' });
  const dealt = blockOf(seen(state, ledger), 'relations');
  assert.ok(Math.abs(dealt[1] - 0.2) < 1e-6, 'one deal between me and the second rival, over five');
  // The same block, seen from p3, has the deal at its own pair with p1.
  assert.ok(blockOf(seen(state, ledger, 2), 'relations').slice(0, 6).some((v) => Math.abs(v - 0.2) < 1e-6));
});

test('layout 3: the deal sheet is zero with nothing on the table, and shows an offer for every seat', () => {
  const state = position();
  assert.deepEqual(blockOf(seen(state), 'sheet'), [0, 0, 0, 0]);
  state.pending = [{ kind: 'trade', offer: { from: 'p3', to: 'p1', give: { cash: 0, properties: ['lu-bu'], jailCards: 0 }, receive: { cash: 200, properties: [], jailCards: 0 } } }];
  const sheet = blockOf(seen(state), 'sheet');
  assert.ok(sheet[0] > 0.05, 'I would gain the last street of my group');
  assert.ok(Math.abs(sheet.reduce((a, b) => a + b, 0)) < 1e-6);
  assert.ok(sheet[1] < 0 && sheet[3] < 0, 'the seats outside the deal pay for it');
});

test('threatDenial: the one street a rival lacks counts by that rival\'s chance, and lies between 0 and 1', () => {
  assert.equal(POTENTIALS.length, 13);
  const state = position();
  const chances = v1(4).chances(ctx, state);
  const pc = potentialContext(ctx, state, chances, createLedger());
  // p4 holds the one street of Cao Wei that p2 lacks; p3 holds the one of Chain Stratagem that p1 lacks.
  assert.ok(Math.abs(potential('threatDenial', pc, 3) - chances[1]) < 1e-9);
  assert.ok(Math.abs(potential('threatDenial', pc, 2) - chances[0]) < 1e-9);
  assert.equal(potential('threatDenial', pc, 0), 0);
  const env = createEnv(config({ seeds: { start: 5, step: 1 }, potentials: [...POTENTIALS] }));
  let step = env.reset();
  for (let i = 0; i < 400 && !step.done; i++) {
    for (const value of step.phi) assert.ok(value >= 0 && value <= 1);
    step = env.step(legalIndices(step.legal)[i % legalIndices(step.legal).length]);
  }
});

test('a model trained on layout version 2 is refused', () => {
  const shapes: [number, number][] = [[985, 4], [4, 4], [4, 4], [4, ACTIONS]];
  assert.throws(() => createMlp({ name: 'old', obsVersion: 2, actionsVersion: 2, shapes } as never), /observation version 2/);
});

test('the table size sits at offsets 37 to 39 of the table block, where the Python model reads it', () => {
  const table = OBS_LAYOUT.find((b) => b.name === 'table');
  assert.equal(table?.offset, 936);
  for (const n of [2, 3, 4]) {
    const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
    const state = engine.newGame({ players: ids, seed: 1, startingPlayer: 'p1' });
    const obs = observe({ ctx, state, view: viewOf(ctx, state), seat: 0, ledger: createLedger(), chances: ids.map(() => 1 / n), draft: emptyDraft(), proposalsLeft: 2, shortGame: false });
    assert.deepEqual(Array.from(obs.slice(936 + 37, 936 + 40)), [2, 3, 4].map((size) => (size === n ? 1 : 0)));
  }
});
