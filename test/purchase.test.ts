import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameState } from '../src/index.ts';
import { economy, engine, landOn, newGame, own, play, property, rejects, who } from './helpers.ts';

const price = property('g1-2').price;

function offered(): GameState {
  return landOn(newGame(), 'a', 'g1-2');
}

function auctioning(prepare: (state: GameState) => void = () => {}): GameState {
  const state = offered();
  prepare(state);
  return play(state, { type: 'DECLINE', player: 'a' });
}

test('landing on an unowned property offers it, and buying pays the list price', () => {
  const state = offered();
  assert.deepEqual(state.pending, [{ kind: 'buy', player: 'a', property: 'g1-2' }]);
  assert.deepEqual(engine.awaiting(state), ['a']);
  rejects(state, { type: 'END_TURN', player: 'a' }, 'DECISION_PENDING');
  rejects(state, { type: 'BUY', player: 'b' }, 'WRONG_PHASE');

  const bought = play(state, { type: 'BUY', player: 'a' });
  assert.equal(bought.properties['g1-2'].owner, 'a');
  assert.equal(who(bought, 'a').cash, economy.startingCash - price);
  assert.deepEqual(bought.pending, []);
});

test('a player short of cash cannot buy outright', () => {
  const state = offered();
  who(state, 'a').cash = price - 1;
  rejects(state, { type: 'BUY', player: 'a' }, 'INSUFFICIENT_CASH');
});

test('a declined property is auctioned, and the decliner may bid', () => {
  const state = auctioning();
  assert.equal(state.pending[0].kind, 'auction');
  assert.deepEqual(engine.awaiting(state), ['a', 'b', 'c']);

  const bidding = play(
    state,
    { type: 'BID', player: 'b', amount: 10 },
    { type: 'BID', player: 'a', amount: 25 },
  );
  rejects(bidding, { type: 'BID', player: 'c', amount: 25 }, 'BID_TOO_LOW');
  assert.deepEqual(engine.awaiting(bidding), ['b', 'c']);

  const sold = play(bidding, { type: 'PASS', player: 'c' }, { type: 'PASS', player: 'b' });
  assert.equal(sold.properties['g1-2'].owner, 'a');
  assert.equal(who(sold, 'a').cash, economy.startingCash - 25);
  assert.deepEqual(sold.pending, []);
  assert.equal(sold.turn.phase, 'postRoll');
});

test('an auction can close below or above the list price', () => {
  const state = auctioning();
  const sold = play(
    state,
    { type: 'BID', player: 'c', amount: price + 300 },
    { type: 'PASS', player: 'a' },
    { type: 'PASS', player: 'b' },
  );
  assert.equal(sold.properties['g1-2'].owner, 'c');
  assert.equal(who(sold, 'c').cash, economy.startingCash - price - 300);
});

test('an auction with no bids leaves the property with the bank', () => {
  const unsold = play(
    auctioning(),
    { type: 'PASS', player: 'a' },
    { type: 'PASS', player: 'b' },
    { type: 'PASS', player: 'c' },
  );
  assert.equal(unsold.properties['g1-2'].owner, null);
  assert.deepEqual(unsold.pending, []);
});

test('bids must be whole, higher, and covered by cash in hand', () => {
  const state = auctioning((s) => {
    who(s, 'b').cash = 30;
  });
  rejects(state, { type: 'BID', player: 'b', amount: 0 }, 'INVALID_ACTION');
  rejects(state, { type: 'BID', player: 'b', amount: 12.5 }, 'INVALID_ACTION');
  rejects(state, { type: 'BID', player: 'b', amount: 31 }, 'INSUFFICIENT_CASH');

  const led = play(state, { type: 'BID', player: 'b', amount: 30 });
  rejects(led, { type: 'PASS', player: 'b' }, 'INVALID_ACTION');
  rejects(led, { type: 'BID', player: 'b', amount: 40 }, 'INVALID_ACTION');
  rejects(led, { type: 'BID', player: 'c', amount: 30 }, 'BID_TOO_LOW');
});

test('a player who has passed is out of the auction', () => {
  const state = play(auctioning(), { type: 'PASS', player: 'c' });
  rejects(state, { type: 'BID', player: 'c', amount: 5 }, 'NOT_A_BIDDER');
  rejects(state, { type: 'PASS', player: 'c' }, 'NOT_A_BIDDER');
});

test('bidders may mortgage during an auction, but not spend', () => {
  const state = auctioning((s) => {
    own(s, 'b', 't1', 't2');
    s.properties.t2.mortgaged = true;
    who(s, 'b').cash = 0;
  });
  rejects(state, { type: 'UNMORTGAGE', player: 'b', property: 't2' }, 'DECISION_PENDING');

  const raised = play(state, { type: 'MORTGAGE', player: 'b', property: 't1' });
  assert.equal(who(raised, 'b').cash, property('t1').mortgageValue);
  play(raised, { type: 'BID', player: 'b', amount: property('t1').mortgageValue });
});
