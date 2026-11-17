import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, LegalAction } from '../src/index.ts';
import { build, engine, jail, landOn, newGame, own, play, who } from './helpers.ts';

const types = (legal: LegalAction[]) => [...new Set(legal.map((action) => action.type))].sort();

test('at the start of a turn the current player may roll or deal', () => {
  const state = newGame();
  assert.deepEqual(engine.awaiting(state), ['a']);
  assert.deepEqual(types(engine.legalActions(state, 'a')), ['PROPOSE_TRADE', 'ROLL']);
  assert.deepEqual(types(engine.legalActions(state, 'b')), ['PROPOSE_TRADE']);
});

test('a jailed player sees every way out they can afford', () => {
  const state = newGame();
  jail(state, 'a');
  assert.deepEqual(types(engine.legalActions(state, 'a')), ['PAY_BAIL', 'PROPOSE_TRADE', 'ROLL']);
  who(state, 'a').cash = 0;
  assert.deepEqual(types(engine.legalActions(state, 'a')), ['PROPOSE_TRADE', 'ROLL']);
});

test('property owners see their management options', () => {
  const state = newGame();
  own(state, 'b', 'g1-1', 'g1-2', 't1');
  build(state, { 'g1-1': 1 });
  state.properties.t1.mortgaged = true;
  const legal = engine.legalActions(state, 'b');
  assert.deepEqual(types(legal), ['BUILD', 'PROPOSE_TRADE', 'SELL_BUILDING', 'SELL_BUILDINGS', 'UNMORTGAGE']);
  assert.deepEqual(
    legal.filter((action) => action.type === 'BUILD'),
    [{ type: 'BUILD', player: 'b', property: 'g1-2' }],
  );
});

test('an auction lists the bidding range for players still in', () => {
  const state = play(
    landOn(newGame(), 'a', 'g1-2'),
    { type: 'DECLINE', player: 'a' },
    { type: 'BID', player: 'b', amount: 40 },
  );
  who(state, 'c').cash = 100;
  assert.deepEqual(engine.awaiting(state), ['a', 'c']);
  assert.deepEqual(engine.legalActions(state, 'c'), [
    { type: 'PASS', player: 'c' },
    { type: 'BID', player: 'c', min: 41, max: 100 },
  ]);
  assert.deepEqual(engine.legalActions(state, 'b'), []);
});

test('every concrete action listed as legal is accepted by the engine', () => {
  const state = newGame();
  own(state, 'a', 'g1-1', 'g1-2', 'u1');
  own(state, 'b', 't1');
  build(state, { 'g1-1': 2, 'g1-2': 1 });
  for (const player of ['a', 'b', 'c']) {
    for (const action of engine.legalActions(state, player)) {
      if (action.type === 'BID' || action.type === 'PROPOSE_TRADE') continue;
      const result = engine.apply(state, action as Action);
      assert.ok(result.ok);
    }
  }
});
