import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, economy, landOn, newGame, own, play, property, rejects, who } from './helpers.ts';

const start = economy.startingCash;

test('mortgaging pays the mortgage value', () => {
  const state = newGame();
  own(state, 'a', 't1');
  const mortgaged = play(state, { type: 'MORTGAGE', player: 'a', property: 't1' });
  assert.equal(mortgaged.properties.t1.mortgaged, true);
  assert.equal(mortgaged.properties.t1.owner, 'a');
  assert.equal(who(mortgaged, 'a').cash, start + property('t1').mortgageValue);
  rejects(mortgaged, { type: 'MORTGAGE', player: 'a', property: 't1' }, 'ALREADY_MORTGAGED');
  rejects(mortgaged, { type: 'MORTGAGE', player: 'b', property: 't1' }, 'NOT_OWNER');
});

test('a street cannot be mortgaged while its group has buildings', () => {
  const state = newGame();
  own(state, 'a', 'g1-1', 'g1-2');
  build(state, { 'g1-1': 1 });
  rejects(state, { type: 'MORTGAGE', player: 'a', property: 'g1-2' }, 'GROUP_HAS_BUILDINGS');
  rejects(state, { type: 'MORTGAGE', player: 'a', property: 'g1-1' }, 'GROUP_HAS_BUILDINGS');

  const cleared = play(
    state,
    { type: 'SELL_BUILDING', player: 'a', property: 'g1-1' },
    { type: 'MORTGAGE', player: 'a', property: 'g1-2' },
  );
  assert.equal(cleared.properties['g1-2'].mortgaged, true);
});

test('lifting a mortgage costs the principal plus ten percent, rounded up', () => {
  const state = newGame();
  own(state, 'a', 't1', 'g1-1');
  state.properties.t1.mortgaged = true;
  state.properties['g1-1'].mortgaged = true;
  assert.equal(property('t1').mortgageValue, 50);
  assert.equal(property('g1-1').mortgageValue, 35);

  const transit = play(state, { type: 'UNMORTGAGE', player: 'a', property: 't1' });
  assert.equal(transit.properties.t1.mortgaged, false);
  assert.equal(who(transit, 'a').cash, start - 55);

  const odd = play(state, { type: 'UNMORTGAGE', player: 'a', property: 'g1-1' });
  assert.equal(who(odd, 'a').cash, start - 39);
});

test('lifting a mortgage needs the cash, a mortgage, and a free moment', () => {
  const state = newGame();
  own(state, 'a', 't1', 't2');
  state.properties.t1.mortgaged = true;
  rejects(state, { type: 'UNMORTGAGE', player: 'a', property: 't2' }, 'NOT_MORTGAGED');

  const broke = structuredClone(state);
  who(broke, 'a').cash = 54;
  rejects(broke, { type: 'UNMORTGAGE', player: 'a', property: 't1' }, 'INSUFFICIENT_CASH');

  const deciding = landOn(state, 'a', 'g1-2');
  rejects(deciding, { type: 'UNMORTGAGE', player: 'a', property: 't1' }, 'DECISION_PENDING');
});
