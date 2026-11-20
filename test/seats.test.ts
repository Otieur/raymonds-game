import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseHeuristicAction, createAgentMemory, createEngine, threeKingdoms } from '../src/index.ts';
import type { Action, Engine, GameEvent, GameState, PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent } from '../src/sim/league.ts';
import { DEFAULT_OPPONENT } from '../src/sim/opponents.ts';
import type { Opponent, OpponentAgent } from '../src/sim/opponents.ts';
import { Seats } from '../web/src/game/seats.ts';

const engine = createEngine(threeKingdoms);
const IDS: PlayerId[] = ['wei', 'shu', 'wu', 'qun'];

function opponent(id: string, create: Opponent['create']): Opponent {
  return { id, level: null, sizes: [2, 3, 4], modes: ['regular', 'short'], name: { zh: id, en: id }, describe: { zh: id, en: id }, create };
}
const rules = opponent(DEFAULT_OPPONENT, () => memberAgent('rules'));

/** Plays up to `limit` actions with every seat asked through `seats`; returns the actions in order. */
async function play(seats: Seats, seed: number, limit: number, label: string): Promise<{ actions: Action[]; state: GameState }> {
  const holder = { rng: seedFrom(`${label}-${seed}`) };
  const random = () => nextFloat(holder);
  let state = engine.newGame({ players: IDS, seed });
  const actions: Action[] = [];
  while (state.winner === null && actions.length < limit) {
    const actor = engine.awaiting(state)[0];
    const action = await seats.ask(state, actor, random);
    assert.ok(action, `${actor} has an action at ${actions.length}`);
    const result = engine.apply(state, action);
    assert.ok(result.ok, `${JSON.stringify(action)} is accepted`);
    actions.push(action);
    state = result.state;
    seats.observe(result.events, state);
  }
  return { actions, state };
}

test('with every seat at the default, a game plays exactly as the store played it before opponents', async () => {
  for (const seed of [1, 2, 3]) {
    const seats = new Seats(engine, IDS.map((id) => ({ id, opponent: rules })));
    const now = await play(seats, seed, 3000, 'default');
    // The recording: the store's former loop, one shared memory for every computer seat.
    const holder = { rng: seedFrom(`default-${seed}`) };
    const random = () => nextFloat(holder);
    const memory = createAgentMemory();
    let state = engine.newGame({ players: IDS, seed });
    const before: Action[] = [];
    while (state.winner === null && before.length < 3000) {
      const actor = engine.awaiting(state)[0];
      const action = chooseHeuristicAction(engine, state, actor, random, memory) ?? { type: 'END_TURN', player: actor };
      const result = engine.apply(state, action);
      assert.ok(result.ok);
      before.push(action);
      state = result.state;
    }
    assert.deepEqual(now.actions, before, `seed ${seed}`);
    assert.deepEqual(seats.fallen(), []);
  }
});

test('an opponent that throws, answers nothing or answers wrongly is replaced by the rule-based agent, once, and play goes on', async () => {
  const faults: Record<string, () => OpponentAgent> = {
    throws: () => ({ choose: () => { throw new Error('broken model'); }, observe: () => {} }),
    nothing: () => ({ choose: () => null, observe: () => {} }),
    illegal: () => ({ choose: (_e: Engine, _s: GameState, actor: PlayerId) => ({ type: 'BUILD', player: actor, property: 'zhuge-liang' }) as Action, observe: () => {} }),
    rejects: () => ({ choose: () => Promise.reject(new Error('worker died')), observe: () => {} }),
    'fails to load': () => { throw new Error('no weights'); },
  };
  for (const [fault, make] of Object.entries(faults)) {
    const reports: string[] = [];
    const broken = opponent(`broken-${fault}`, fault === 'fails to load' ? () => Promise.reject(new Error('no weights')) : make);
    const seats = new Seats(engine, [{ id: 'wei', opponent: broken }, ...IDS.slice(1).map((id) => ({ id, opponent: rules }))], (seat) => reports.push(seat));
    const { actions, state } = await play(seats, 7, 600, fault);
    assert.ok(actions.length === 600 || state.winner !== null, `${fault}: the game went on`);
    assert.deepEqual(seats.fallen(), ['wei'], fault);
    assert.deepEqual(reports, ['wei'], `${fault}: reported once`);
  }
});

test('every opponent receives every event exactly once, in order, including one still being made', async () => {
  const seen = new Map<PlayerId, GameEvent[]>();
  const recorder = (id: PlayerId, delay: number) =>
    opponent(`recorder-${id}`, () => {
      const inner = memberAgent('rules');
      const agent: OpponentAgent = {
        choose: async (e, s, a, r) => inner.choose(e, s, a, r),
        observe: (events) => {
          seen.set(id, [...(seen.get(id) ?? []), ...events]);
        },
      };
      return delay ? new Promise<OpponentAgent>((resolve) => setTimeout(() => resolve(agent), delay)) : agent;
    });
  // Wei's agent is made only after the first actions have been applied and observed.
  const seats = new Seats(engine, IDS.map((id, i) => ({ id, opponent: recorder(id, i === 0 ? 30 : 0) })));
  let state = engine.newGame({ players: IDS, seed: 11 });
  const all: GameEvent[] = [];
  for (let i = 0; i < 5; i++) {
    const actor = engine.awaiting(state)[0];
    const action = chooseHeuristicAction(engine, state, actor, Math.random, createAgentMemory()) ?? { type: 'END_TURN', player: actor };
    const result = engine.apply(state, action);
    assert.ok(result.ok);
    all.push(...result.events);
    state = result.state;
    seats.observe(result.events, state);
  }
  assert.equal(seen.get('wei'), undefined, 'not made yet');
  const holder = { rng: seedFrom('events') };
  for (let i = 0; i < 400 && state.winner === null; i++) {
    const actor = engine.awaiting(state)[0];
    const action = await seats.ask(state, actor, () => nextFloat(holder));
    assert.ok(action);
    const result = engine.apply(state, action);
    assert.ok(result.ok);
    all.push(...result.events);
    state = result.state;
    seats.observe(result.events, state);
  }
  for (const id of IDS) assert.deepEqual(seen.get(id), all, id);
  assert.deepEqual(seats.fallen(), []);
});

/** Offers `target` 20 for 10 at every free decision it can, else plays as the rule-based agent. */
function chatty(target: PlayerId): OpponentAgent {
  const rules = memberAgent('rules');
  return {
    choose: (e, s, actor, random) => {
      const open = e.legalActions(s, actor).find((a) => a.type === 'PROPOSE_TRADE');
      const offer: Action = { type: 'PROPOSE_TRADE', player: actor, to: target, give: { cash: 20, properties: [], jailCards: 0 }, receive: { cash: 10, properties: [], jailCards: 0 } };
      if (open && open.type === 'PROPOSE_TRADE' && open.partners.includes(target) && e.validate(s, offer) === null) return offer;
      return rules.choose(e, s, actor, random);
    },
    observe: () => {},
  };
}

/** The offers made in a game where Wei asks Shu at every chance, with the given limit. */
async function chattyGame(maxAsks: number): Promise<{ from: PlayerId; to: PlayerId; turn: number; players: number }[]> {
  const seats = new Seats(engine, [{ id: 'wei', opponent: opponent('chatty', () => chatty('shu')) }, ...IDS.slice(1).map((id) => ({ id, opponent: rules }))], () => {}, { maxAsks });
  const holder = { rng: seedFrom('chatty') };
  let state = engine.newGame({ players: IDS, seed: 5 });
  const asks: { from: PlayerId; to: PlayerId; turn: number; players: number }[] = [];
  for (let i = 0; i < 1500 && state.winner === null; i++) {
    const actor = engine.awaiting(state)[0];
    const action = await seats.ask(state, actor, () => nextFloat(holder));
    assert.ok(action);
    const result = engine.apply(state, action);
    assert.ok(result.ok, JSON.stringify(action));
    state = result.state;
    for (const event of result.events) {
      if (event.type === 'TRADE_PROPOSED') asks.push({ from: event.offer.from, to: event.offer.to, turn: state.turn.number, players: state.players.filter((p) => !p.bankrupt).length });
    }
    seats.observe(result.events, state);
  }
  return asks;
}

test('with maxAsks 1, no seat receives two offers from one computer seat in a round', async () => {
  const limited = (await chattyGame(1)).filter((a) => a.from === 'wei' && a.to === 'shu');
  assert.ok(limited.length >= 5, `Wei asked Shu ${limited.length} times`);
  for (let i = 1; i < limited.length; i++) {
    assert.ok(limited[i].turn - limited[i - 1].turn >= limited[i].players, `asks on turns ${limited[i - 1].turn} and ${limited[i].turn}`);
  }
  // The limit is what holds it back: without one, the same seat asks again within the round.
  const unlimited = (await chattyGame(Number.POSITIVE_INFINITY)).filter((a) => a.from === 'wei' && a.to === 'shu');
  assert.ok(unlimited.some((a, i) => i > 0 && a.turn - unlimited[i - 1].turn < a.players), 'asks again within a round when unlimited');
});

test("an opponent's inputs are the same whether another seat is a person or a computer seat", async () => {
  /** Wraps the rule-based agent and records everything it is given. */
  const recorder = (log: string[]) =>
    opponent('recorder', () => {
      const inner = memberAgent('rules');
      return {
        choose: (e, s, actor, random, limits) => {
          log.push(JSON.stringify({ choose: s, actor, limits, legal: e.legalActions(s, actor) }));
          return inner.choose(e, s, actor, random);
        },
        observe: (events, s) => {
          log.push(JSON.stringify({ events, s }));
        },
      };
    });
  const run = async (weiIsPerson: boolean, seed: number): Promise<string[]> => {
    const log: string[] = [];
    const computers = [{ id: 'shu', opponent: recorder(log) }, ...['wu', 'qun'].map((id) => ({ id, opponent: rules }))];
    const seats = new Seats(engine, weiIsPerson ? computers : [{ id: 'wei', opponent: rules }, ...computers]);
    // The person's hands: the same moves, made outside the seats the opponents share.
    const person = new Seats(engine, [{ id: 'wei', opponent: rules }]);
    const holder = { rng: seedFrom(`person-blind-${seed}`) };
    const random = () => nextFloat(holder);
    let state = engine.newGame({ players: IDS, seed });
    for (let i = 0; i < 2500 && state.winner === null; i++) {
      // The debt window, as the store runs it; a person asked there lets it pass.
      let action: Action | null = null;
      for (let asked = seats.nextAtDebt(state); asked !== null && !action; asked = seats.nextAtDebt(state)) {
        if (asked !== 'wei' || !weiIsPerson) action = await seats.atDebt(state, asked, random);
      }
      const actor = engine.awaiting(state)[0];
      action ??= weiIsPerson && actor === 'wei' ? await person.ask(state, actor, random) : await seats.ask(state, actor, random);
      assert.ok(action);
      const result = engine.apply(state, action);
      assert.ok(result.ok);
      state = result.state;
      seats.observe(result.events, state);
      person.observe(result.events, state);
    }
    return log;
  };
  let recorded = 0;
  for (const seed of [21, 22, 23]) {
    const asPerson = await run(true, seed);
    assert.deepEqual(asPerson, await run(false, seed), `seed ${seed}`);
    recorded += asPerson.length;
  }
  assert.ok(recorded > 1500, `only ${recorded} inputs recorded`);
});

test('at a debt the debtor cannot cover, the other seats are asked in order after the debtor, leaving out the creditor', async () => {
  // A position with such a debt, from a game among rule-based agents.
  let state: GameState | null = null;
  for (let seed = 1; seed < 60 && !state; seed++) {
    const memory = createAgentMemory();
    let s = engine.newGame({ players: IDS, seed });
    for (let i = 0; i < 4000 && s.winner === null; i++) {
      const top = s.pending.at(-1);
      if (top?.kind === 'debt' && top.creditor !== null) {
        const debtor = s.players.find((p) => p.id === top.debtor);
        if (debtor && debtor.cash < top.amount && s.players.every((p) => !p.bankrupt)) {
          state = s;
          break;
        }
      }
      const actor = engine.awaiting(s)[0];
      const result = engine.apply(s, chooseHeuristicAction(engine, s, actor, Math.random, memory) ?? { type: 'END_TURN', player: actor });
      assert.ok(result.ok);
      s = result.state;
    }
  }
  assert.ok(state, 'found a debt the debtor cannot cover');
  const top = state.pending.at(-1) as Extract<GameState['pending'][number], { kind: 'debt' }>;
  const at = state.players.findIndex((p) => p.id === top.debtor);
  const expected = [1, 2, 3].map((k) => state.players[(at + k) % 4].id).filter((id) => id !== top.creditor);

  const order: PlayerId[] = [];
  const seats = new Seats(engine, IDS.map((id) => ({ id, opponent: rules })));
  for (let next = seats.nextAtDebt(state); next !== null; next = seats.nextAtDebt(state)) order.push(next);
  assert.deepEqual(order, expected);
  assert.equal(await seats.atDebt(state, expected[0], Math.random), null, 'the rule-based agent makes no offer at a debt');

  // A seat that offers for one of the debtor's properties: its offer is played before the debtor acts.
  const buyer = expected[0];
  const target = engine.board.squares.find((sq) => state.properties[sq.id]?.owner === top.debtor && state.properties[sq.id].level === 0);
  assert.ok(target, 'the debtor owns a property without buildings');
  const offer: Action = { type: 'PROPOSE_TRADE', player: buyer, to: top.debtor, give: { cash: 10, properties: [], jailCards: 0 }, receive: { cash: 0, properties: [target.id], jailCards: 0 } };
  const windowed = (answer: Action) => opponent('windowed', () => ({ ...memberAgent('rules'), window: () => answer }));
  const offering = new Seats(engine, [{ id: buyer, opponent: windowed(offer) }]);
  assert.equal(engine.validate(state, offer), null, 'the offer is a legal one');
  assert.equal(offering.nextAtDebt(state), buyer);
  assert.deepEqual(await offering.atDebt(state, buyer, Math.random), offer);
  const result = engine.apply(state, offer);
  assert.ok(result.ok);
  assert.equal(result.state.pending.at(-1)?.kind, 'trade');
  assert.deepEqual(engine.awaiting(result.state), [top.debtor], 'the debtor answers the offer first');
  // An answer at a debt that is not an offer to the debtor is a failure.
  const reports: PlayerId[] = [];
  const wrong = new Seats(engine, [{ id: buyer, opponent: windowed({ type: 'END_TURN', player: buyer }) }], (seat) => reports.push(seat));
  assert.equal(await wrong.atDebt(state, buyer, Math.random), null);
  assert.deepEqual(reports, [buyer]);
});
