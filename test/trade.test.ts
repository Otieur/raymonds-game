import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, GameState, TradeSide } from '../src/index.ts';
import { build, economy, engine, giveJailCard, newGame, own, play, property, rejects, who } from './helpers.ts';

const start = economy.startingCash;
const nothing: TradeSide = { cash: 0, properties: [], jailCards: 0 };
const principal = property('t1').mortgageValue;
const interest = Math.ceil((principal * engine.rules.mortgageInterestPercent) / 100);

function offer(from: string, to: string, give: Partial<TradeSide>, receive: Partial<TradeSide>): Action {
  return {
    type: 'PROPOSE_TRADE',
    player: from,
    to,
    give: { ...nothing, ...give },
    receive: { ...nothing, ...receive },
  };
}

function table(): GameState {
  const state = newGame();
  own(state, 'a', 'g1-2');
  own(state, 'b', 't1');
  return state;
}

test('an accepted trade swaps property and cash', () => {
  const proposed = play(table(), offer('a', 'b', { properties: ['g1-2'], cash: 50 }, { properties: ['t1'] }));
  assert.equal(proposed.pending[0].kind, 'trade');
  assert.deepEqual(engine.awaiting(proposed), ['b']);

  const done = play(proposed, { type: 'ACCEPT_TRADE', player: 'b' });
  assert.equal(done.properties['g1-2'].owner, 'b');
  assert.equal(done.properties.t1.owner, 'a');
  assert.equal(who(done, 'a').cash, start - 50);
  assert.equal(who(done, 'b').cash, start + 50);
  assert.deepEqual(done.pending, []);
});

test('only the recipient answers an offer, and only the proposer withdraws it', () => {
  const proposed = play(table(), offer('a', 'b', { cash: 50 }, { properties: ['t1'] }));
  rejects(proposed, { type: 'ACCEPT_TRADE', player: 'a' }, 'WRONG_PHASE');
  rejects(proposed, { type: 'ACCEPT_TRADE', player: 'c' }, 'WRONG_PHASE');
  rejects(proposed, { type: 'CANCEL_TRADE', player: 'b' }, 'WRONG_PHASE');

  const rejected = play(proposed, { type: 'REJECT_TRADE', player: 'b' });
  assert.deepEqual(rejected.pending, []);
  assert.equal(rejected.properties.t1.owner, 'b');

  const withdrawn = play(proposed, { type: 'CANCEL_TRADE', player: 'a' });
  assert.deepEqual(withdrawn.pending, []);
});

test('an open offer freezes play until it is answered', () => {
  const proposed = play(table(), offer('a', 'b', { cash: 50 }, { properties: ['t1'] }));
  rejects(proposed, { type: 'ROLL', player: 'a' }, 'DECISION_PENDING');
  rejects(proposed, { type: 'MORTGAGE', player: 'b', property: 't1' }, 'DECISION_PENDING');
  rejects(proposed, offer('c', 'a', { cash: 5 }, { cash: 1 }), 'DECISION_PENDING');
});

test('players may trade outside their own turn', () => {
  const state = table();
  own(state, 'c', 'u1');
  assert.equal(state.turn.player, 'a');
  const done = play(
    state,
    offer('b', 'c', { properties: ['t1'] }, { properties: ['u1'] }),
    { type: 'ACCEPT_TRADE', player: 'c' },
  );
  assert.equal(done.properties.t1.owner, 'c');
  assert.equal(done.properties.u1.owner, 'b');
});

test('a trade must be real on both sides', () => {
  const state = table();
  rejects(state, offer('a', 'b', { properties: ['g1-2'] }, {}), 'INVALID_TRADE');
  rejects(state, offer('a', 'b', {}, { properties: ['t1'] }), 'INVALID_TRADE');
  rejects(state, offer('a', 'a', { cash: 1 }, { cash: 1 }), 'INVALID_TRADE');
  rejects(state, offer('a', 'b', { properties: ['t1'] }, { cash: 10 }), 'NOT_OWNER');
  rejects(state, offer('a', 'b', { cash: start + 1 }, { properties: ['t1'] }), 'INSUFFICIENT_CASH');
  rejects(state, offer('a', 'b', { cash: -5 }, { properties: ['t1'] }), 'INVALID_TRADE');
  rejects(state, offer('a', 'b', { jailCards: 1 }, { cash: 10 }), 'NO_JAIL_CARD');
  rejects(state, offer('a', 'b', { properties: ['g1-2', 'g1-2'] }, { cash: 10 }), 'INVALID_TRADE');
  rejects(state, offer('a', 'nobody', { cash: 1 }, { cash: 1 }), 'UNKNOWN_PLAYER');
});

test('a street cannot change hands while its group has buildings', () => {
  const state = table();
  own(state, 'a', 'g1-1');
  build(state, { 'g1-1': 1, 'g1-2': 1 });
  rejects(state, offer('a', 'b', { properties: ['g1-2'] }, { cash: 500 }), 'GROUP_HAS_BUILDINGS');
});

test('jail cards can be traded', () => {
  const state = table();
  giveJailCard(state, 'a', 'p', 'p-free');
  const done = play(state, offer('a', 'b', { jailCards: 1 }, { cash: 30 }), { type: 'ACCEPT_TRADE', player: 'b' });
  assert.deepEqual(who(done, 'a').jailCards, []);
  assert.deepEqual(who(done, 'b').jailCards, [{ deck: 'p', card: 'p-free' }]);
  assert.equal(who(done, 'a').cash, start + 30);
});

test('whoever receives a mortgaged property pays the interest at once', () => {
  const state = table();
  state.properties.t1.mortgaged = true;
  const taken = play(state, offer('b', 'a', { properties: ['t1'] }, { cash: 100 }), {
    type: 'ACCEPT_TRADE',
    player: 'a',
  });
  assert.equal(taken.properties.t1.owner, 'a');
  assert.equal(who(taken, 'a').cash, start - 100 - interest);
  assert.deepEqual(taken.pending, [{ kind: 'mortgageTransfer', player: 'a', property: 't1' }]);
  rejects(taken, { type: 'ROLL', player: 'a' }, 'DECISION_PENDING');
  rejects(taken, { type: 'SETTLE_TRANSFER', player: 'b', lift: false }, 'WRONG_PHASE');

  const lifted = play(taken, { type: 'SETTLE_TRANSFER', player: 'a', lift: true });
  assert.equal(lifted.properties.t1.mortgaged, false);
  assert.equal(who(lifted, 'a').cash, start - 100 - interest - principal);

  const kept = play(
    taken,
    { type: 'SETTLE_TRANSFER', player: 'a', lift: false },
    { type: 'UNMORTGAGE', player: 'a', property: 't1' },
  );
  assert.equal(who(kept, 'a').cash, start - 100 - interest - principal - interest);
});

test('a trade is refused if the receiver could not pay the mortgage interest', () => {
  const state = table();
  state.properties.t1.mortgaged = true;
  who(state, 'a').cash = interest - 1;
  rejects(state, offer('b', 'a', { properties: ['t1'] }, { properties: ['g1-2'] }), 'INSUFFICIENT_CASH');
});

test('an offer is checked again when it is accepted', () => {
  const state = table();
  const proposed = play(state, offer('a', 'b', { cash: 500 }, { properties: ['t1'] }));
  who(proposed, 'a').cash = 100;
  rejects(proposed, { type: 'ACCEPT_TRADE', player: 'b' }, 'INSUFFICIENT_CASH');
});
