import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameState } from '../src/index.ts';
import { board, build, economy, jail, landOn, newGame, own, street, who } from './helpers.ts';

function rentPaid(state: GameState): number {
  const paid = economy.startingCash - who(state, 'a').cash;
  assert.equal(who(state, 'b').cash, economy.startingCash + paid);
  return paid;
}

test('an unimproved street charges its base rent', () => {
  const state = newGame();
  own(state, 'b', 'g1-2');
  assert.equal(rentPaid(landOn(state, 'a', 'g1-2')), street('g1-2').rents[0]);
});

test('owning the whole group doubles the rent on unimproved streets', () => {
  const state = newGame();
  own(state, 'b', 'g1-1', 'g1-2');
  assert.equal(rentPaid(landOn(state, 'a', 'g1-2')), street('g1-2').rents[0] * 2);
});

test('the group bonus still applies when another street in the group is mortgaged', () => {
  const state = newGame();
  own(state, 'b', 'g1-1', 'g1-2');
  state.properties['g1-1'].mortgaged = true;
  assert.equal(rentPaid(landOn(state, 'a', 'g1-2')), street('g1-2').rents[0] * 2);
});

test('a mortgaged property charges no rent', () => {
  const state = newGame();
  own(state, 'b', 'g1-1', 'g1-2');
  state.properties['g1-2'].mortgaged = true;
  assert.equal(rentPaid(landOn(state, 'a', 'g1-2')), 0);
});

test('houses and hotels charge the rent for their level, without the group bonus', () => {
  for (const level of [1, 2, 3, 4, 5]) {
    const state = newGame();
    own(state, 'b', 'g1-1', 'g1-2');
    build(state, { 'g1-1': level, 'g1-2': level });
    assert.equal(rentPaid(landOn(state, 'a', 'g1-2')), street('g1-2').rents[level]);
  }
});

test('transit rent rises with the number of stops the owner holds', () => {
  const stops = ['t2', 't1'];
  for (const count of [1, 2]) {
    const state = newGame();
    own(state, 'b', ...stops.slice(0, count));
    assert.equal(rentPaid(landOn(state, 'a', 't2')), board.transitRents[count - 1]);
  }
  assert.ok(board.transitRents[1] > board.transitRents[0]);
});

test('a mortgaged stop still counts toward the fare on the others', () => {
  const state = newGame();
  own(state, 'b', 't2', 't1');
  state.properties.t1.mortgaged = true;
  assert.equal(rentPaid(landOn(state, 'a', 't2')), board.transitRents[1]);
});

test('utility rent is the dice total times a multiplier set by utilities held', () => {
  const one = newGame();
  own(one, 'b', 'u1');
  assert.equal(rentPaid(landOn(one, 'a', 'u1', [1, 2])), 3 * board.utilityMultipliers[0]);

  const both = newGame();
  own(both, 'b', 'u1', 'u2');
  assert.equal(rentPaid(landOn(both, 'a', 'u1', [2, 5])), 7 * board.utilityMultipliers[1]);
});

test('an owner in jail still collects rent', () => {
  const state = newGame();
  own(state, 'b', 'g1-2');
  jail(state, 'b');
  assert.equal(rentPaid(landOn(state, 'a', 'g1-2')), street('g1-2').rents[0]);
});

test('landing on your own property costs nothing', () => {
  const state = newGame();
  own(state, 'a', 'g1-2');
  const landed = landOn(state, 'a', 'g1-2');
  assert.equal(who(landed, 'a').cash, economy.startingCash);
  assert.deepEqual(landed.pending, []);
});
