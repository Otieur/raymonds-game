import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine, SHORT_GAME_RULES, simulateGame } from '../src/index.ts';
import type { Dice, GameEvent, GameState, PlayerId } from '../src/index.ts';
import { fixture } from './fixture.ts';
import { engine, play, playWithEvents, rejects, roll } from './helpers.ts';

function opening(players: PlayerId[] = ['a', 'b', 'c', 'd']): GameState {
  return engine.newGame({ players, seed: 7 });
}

/** Makes whoever is due throw the given dice, one after another. */
function throwAll(state: GameState, ...dice: Dice[]): { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  for (const pair of dice) {
    roll(current, pair);
    const step = playWithEvents(current, { type: 'ROLL', player: current.turn.player });
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
}

const seats = (state: GameState) => state.players.map((p) => p.id);

test('a game opens with every player due a throw, in seat order', () => {
  const state = opening();
  assert.equal(state.turn.phase, 'order');
  assert.deepEqual(state.opening, { round: 1, groups: [['a', 'b', 'c', 'd']], rolls: {} });
  assert.deepEqual(engine.checkInvariants(state), []);
  assert.deepEqual(engine.awaiting(state), ['a']);
  assert.deepEqual(engine.legalActions(state, 'a'), [{ type: 'ROLL', player: 'a' }]);
  assert.deepEqual(engine.legalActions(state, 'b'), []);

  const next = play(state, { type: 'ROLL', player: 'a' });
  assert.deepEqual(engine.awaiting(next), ['b']);
  assert.equal(next.players.find((p) => p.id === 'a')?.position, 0);
});

test('nothing but the opening throw is allowed until the order is settled', () => {
  const state = opening();
  rejects(state, { type: 'ROLL', player: 'b' }, 'NOT_YOUR_TURN');
  rejects(state, { type: 'END_TURN', player: 'a' }, 'WRONG_PHASE');
  rejects(
    state,
    {
      type: 'PROPOSE_TRADE',
      player: 'a',
      to: 'b',
      give: { cash: 10, properties: [], jailCards: 0 },
      receive: { cash: 0, properties: [], jailCards: 0 },
    },
    'WRONG_PHASE',
  );
});

test('the higher the throw, the earlier the turn, and the table is reseated to match', () => {
  const { state, events } = throwAll(opening(), [1, 2], [6, 6], [2, 3], [4, 4]);
  assert.deepEqual(seats(state), ['b', 'd', 'c', 'a']);
  assert.equal(state.opening, null);
  assert.deepEqual(state.turn, { player: 'b', number: 1, phase: 'preRoll', doubles: 0, lastRoll: null });
  assert.deepEqual(
    events.filter((event) => event.type === 'DICE_ROLLED').map((event) => [event.player, event.purpose]),
    [
      ['a', 'order'],
      ['b', 'order'],
      ['c', 'order'],
      ['d', 'order'],
    ],
  );
  assert.deepEqual(events.slice(-2), [
    { type: 'ORDER_DECIDED', order: ['b', 'd', 'c', 'a'] },
    { type: 'TURN_STARTED', player: 'b', turn: 1 },
  ]);

  // Play then follows the new seating.
  roll(state, [1, 2]);
  const afterB = play(state, { type: 'ROLL', player: 'b' }, { type: 'DECLINE', player: 'b' });
  const settled = afterB.pending.length > 0 ? afterB : play(afterB, { type: 'END_TURN', player: 'b' });
  if (settled.pending.length === 0) assert.equal(settled.turn.player, 'd');
});

test('players who tie throw again among themselves, and only their own places are at stake', () => {
  // a and c tie on 7 below d (11) and above b (4).
  const first = throwAll(opening(), [3, 4], [1, 3], [5, 2], [6, 5]);
  assert.equal(first.state.turn.phase, 'order');
  assert.deepEqual(first.state.opening, { round: 2, groups: [['d'], ['a', 'c'], ['b']], rolls: {} });
  assert.deepEqual(first.events.at(-1), { type: 'ORDER_TIED', players: ['a', 'c'], total: 7 });
  assert.deepEqual(engine.awaiting(first.state), ['a']);
  rejects(first.state, { type: 'ROLL', player: 'd' }, 'NOT_YOUR_TURN');
  assert.deepEqual(engine.checkInvariants(first.state), []);

  // They tie once more, then c wins the third round.
  const second = throwAll(first.state, [2, 2], [1, 3]);
  assert.deepEqual(second.state.opening?.groups, [['d'], ['a', 'c'], ['b']]);
  assert.equal(second.state.opening?.round, 3);

  const third = throwAll(second.state, [1, 1], [1, 2]);
  assert.deepEqual(seats(third.state), ['d', 'c', 'a', 'b']);
  assert.equal(third.state.turn.player, 'd');
});

test('several ties are broken side by side', () => {
  const first = throwAll(opening(), [6, 6], [6, 6], [1, 1], [1, 1]);
  assert.deepEqual(first.state.opening?.groups, [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  assert.deepEqual(
    first.events.filter((event) => event.type === 'ORDER_TIED'),
    [
      { type: 'ORDER_TIED', players: ['a', 'b'], total: 12 },
      { type: 'ORDER_TIED', players: ['c', 'd'], total: 2 },
    ],
  );
  // The second round is thrown in seat order: a, b, c, d. A low winner of the top tie still leads.
  const second = throwAll(first.state, [1, 1], [1, 2], [6, 6], [5, 6]);
  assert.deepEqual(seats(second.state), ['b', 'a', 'c', 'd']);
});

test('doubles in the opening roll earn nothing, and nobody moves or is paid', () => {
  const { state } = throwAll(opening(['a', 'b']), [6, 6], [1, 2]);
  assert.deepEqual(seats(state), ['a', 'b']);
  assert.equal(state.turn.doubles, 0);
  for (const player of state.players) {
    assert.equal(player.position, 0);
    assert.equal(player.cash, fixture.economy.startingCash);
  }
});

test('naming the first player skips the opening roll and keeps the seating', () => {
  const state = engine.newGame({ players: ['a', 'b', 'c'], seed: 7, startingPlayer: 'b' });
  assert.equal(state.turn.phase, 'preRoll');
  assert.equal(state.opening, null);
  assert.equal(state.turn.player, 'b');
  assert.deepEqual(seats(state), ['a', 'b', 'c']);
});

test('the short game deals its deeds before the opening roll', () => {
  const short = createEngine(fixture, SHORT_GAME_RULES);
  const state = short.newGame({ players: ['a', 'b', 'c'], seed: 3 });
  assert.equal(state.turn.phase, 'order');
  for (const id of ['a', 'b', 'c']) {
    assert.equal(Object.values(state.properties).filter((held) => held.owner === id).length, 2);
  }
  assert.deepEqual(short.checkInvariants(state), []);
});

test('the opening roll replays from its seed and survives JSON', () => {
  const run = () => {
    let state = engine.newGame({ players: ['a', 'b', 'c', 'd'], seed: 'order' });
    while (state.turn.phase === 'order') {
      state = JSON.parse(JSON.stringify(play(state, { type: 'ROLL', player: state.turn.player }))) as GameState;
    }
    return state;
  };
  assert.deepEqual(run(), run());
  assert.equal(run().turn.player, run().players[0].id);
});

test('simulated games begin with the opening roll', () => {
  const result = simulateGame(engine, { players: 4, seed: 5, maxActions: 400 });
  assert.equal(result.eventCounts.ORDER_DECIDED, 1);
  assert.ok(result.eventCounts.DICE_ROLLED >= 4);
});
