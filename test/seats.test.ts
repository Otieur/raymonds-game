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
