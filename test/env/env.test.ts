import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, ASK0, BID0, BUILD0, codecFor, emptyDraft, legalIndices, MORTGAGE0, SELL0, UNMORTGAGE0 } from '../../src/env/actions.ts';
import { createEnv, DEFAULT_CONFIG } from '../../src/env/env.ts';
import type { EnvConfig, Step } from '../../src/env/env.ts';
import { createLedger, ledgerOf, note } from '../../src/env/ledger.ts';
import { observe, OBS_LAYOUT, OBS_SIZE } from '../../src/env/observe.ts';
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

test('the observation layout is contiguous, named once each, and 985 numbers long', () => {
  let offset = 0;
  for (const block of OBS_LAYOUT) {
    assert.equal(block.offset, offset, block.name);
    offset += block.length;
  }
  assert.equal(offset, 985);
  assert.equal(OBS_SIZE, 985);
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
