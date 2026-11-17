import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  board,
  build,
  economy,
  engine,
  indexOf,
  landOn,
  newGame,
  own,
  play,
  rejects,
  roll,
  stack,
  who,
} from './helpers.ts';

const start = economy.startingCash;

test('a drawn card takes effect and goes to the bottom of its deck', () => {
  const state = newGame();
  stack(state, 'p', 'p-collect');
  const drawn = landOn(state, 'a', 'card-p');
  assert.equal(who(drawn, 'a').cash, start + 50);
  assert.equal(drawn.decks.p.at(-1), 'p-collect');
  assert.equal(drawn.decks.p.length, board.decks.p.length);
});

test('a payment card charges the player', () => {
  const state = newGame();
  stack(state, 'q', 'q-pay');
  assert.equal(who(landOn(state, 'a', 'card-q'), 'a').cash, start - 60);
});

test('an advance card pays the salary when it passes the start square', () => {
  const state = newGame();
  own(state, 'a', 'g3-1');
  stack(state, 'p', 'p-behind');
  const moved = landOn(state, 'a', 'card-p');
  assert.equal(who(moved, 'a').position, indexOf('g3-1'));
  assert.equal(who(moved, 'a').cash, start + economy.salary);
});

test('an advance card to the start square pays the salary', () => {
  const state = newGame();
  stack(state, 'p', 'p-start');
  const moved = landOn(state, 'a', 'card-p');
  assert.equal(who(moved, 'a').position, 0);
  assert.equal(who(moved, 'a').cash, start + economy.salary);
});

test('an advance card onto an unowned property offers it for sale', () => {
  const state = newGame();
  stack(state, 'p', 'p-ahead');
  const moved = landOn(state, 'a', 'card-p');
  assert.deepEqual(moved.pending, [{ kind: 'buy', player: 'a', property: 'g5-3' }]);
  assert.equal(who(moved, 'a').cash, start);
});

test('a go-back card moves backward and resolves the square reached', () => {
  const state = newGame();
  own(state, 'b', 'u1');
  stack(state, 'p', 'p-back');
  roll(state, [2, 3]);
  const moved = landOn(state, 'a', 'card-p');
  assert.equal(who(moved, 'a').position, indexOf('u1'));
  assert.equal(who(moved, 'a').cash, start - 5 * board.utilityMultipliers[0]);
  assert.deepEqual(moved.diceQueue, []);
});

test('the nearest-transit card charges double the usual fare', () => {
  const state = newGame();
  own(state, 'b', 't1', 't2');
  stack(state, 'p', 'p-transit');
  const moved = landOn(state, 'a', 'card-p');
  assert.equal(who(moved, 'a').position, indexOf('t2'));
  assert.equal(who(moved, 'a').cash, start - board.transitRents[1] * 2);
  assert.equal(who(moved, 'b').cash, start + board.transitRents[1] * 2);
});

test('the nearest-transit card offers an unowned stop at its list price', () => {
  const state = newGame();
  stack(state, 'p', 'p-transit');
  const moved = landOn(state, 'a', 'card-p');
  assert.deepEqual(moved.pending, [{ kind: 'buy', player: 'a', property: 't2' }]);
});

test('the nearest-utility card charges the top multiplier on a fresh roll', () => {
  const state = newGame();
  own(state, 'b', 'u2');
  stack(state, 'p', 'p-utility');
  roll(state, [3, 4]);
  const moved = landOn(state, 'a', 'card-p');
  assert.equal(who(moved, 'a').position, indexOf('u2'));
  assert.equal(who(moved, 'a').cash, start - 7 * Math.max(...board.utilityMultipliers));
});

test('a go-to-jail card jails the player without salary', () => {
  const state = newGame();
  stack(state, 'q', 'q-jail');
  const jailed = landOn(state, 'a', 'card-q');
  assert.equal(who(jailed, 'a').inJail, true);
  assert.equal(who(jailed, 'a').position, indexOf('jail'));
  assert.equal(who(jailed, 'a').cash, start);
});

test('a jail card is kept by the player and leaves the deck', () => {
  const state = newGame();
  stack(state, 'q', 'q-free');
  const drawn = landOn(state, 'a', 'card-q');
  assert.deepEqual(who(drawn, 'a').jailCards, [{ deck: 'q', card: 'q-free' }]);
  assert.equal(drawn.decks.q.includes('q-free'), false);
  assert.equal(drawn.decks.q.length, board.decks.q.length - 1);
});

test('collect-from-each takes the amount from every other player', () => {
  const state = newGame();
  stack(state, 'q', 'q-from-each');
  const drawn = landOn(state, 'a', 'card-q');
  assert.equal(who(drawn, 'a').cash, start + 40);
  assert.equal(who(drawn, 'b').cash, start - 20);
  assert.equal(who(drawn, 'c').cash, start - 20);
});

test('a player who cannot pay a collect-from-each card owes the drawer', () => {
  const state = newGame();
  who(state, 'b').cash = 5;
  stack(state, 'q', 'q-from-each');
  const drawn = landOn(state, 'a', 'card-q');
  assert.equal(who(drawn, 'a').cash, start + 20);
  assert.deepEqual(engine.awaiting(drawn), ['b']);
  rejects(drawn, { type: 'END_TURN', player: 'a' }, 'DECISION_PENDING');

  const after = play(drawn, { type: 'DECLARE_BANKRUPTCY', player: 'b' });
  assert.equal(who(after, 'b').bankrupt, true);
  assert.equal(who(after, 'a').cash, start + 25);
  assert.equal(after.turn.player, 'a');
  assert.equal(play(after, { type: 'END_TURN', player: 'a' }).turn.player, 'c');
});

test('pay-each hands the amount to every other player', () => {
  const state = newGame();
  stack(state, 'p', 'p-pay-each');
  const drawn = landOn(state, 'a', 'card-p');
  assert.equal(who(drawn, 'a').cash, start - 80);
  assert.equal(who(drawn, 'b').cash, start + 40);
  assert.equal(who(drawn, 'c').cash, start + 40);
});

test('pay-each pays in seating order until the money runs out', () => {
  const state = newGame();
  who(state, 'a').cash = 50;
  stack(state, 'p', 'p-pay-each');
  const drawn = landOn(state, 'a', 'card-p');
  assert.equal(who(drawn, 'b').cash, start + 40);
  assert.deepEqual(drawn.pending, [{ kind: 'debt', debtor: 'a', creditor: 'c', amount: 40, reason: 'card' }]);

  const after = play(drawn, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  assert.equal(who(after, 'c').cash, start + 10);
  assert.equal(after.turn.player, 'b');
});

test('a repairs card charges per house and per hotel', () => {
  const state = newGame();
  own(state, 'a', 'g1-1', 'g1-2');
  build(state, { 'g1-1': 5, 'g1-2': 4 });
  stack(state, 'p', 'p-repairs');
  const drawn = landOn(state, 'a', 'card-p');
  assert.equal(who(drawn, 'a').cash, start - (4 * 20 + 80));
});

test('a repairs card costs nothing without buildings', () => {
  const state = newGame();
  stack(state, 'q', 'q-repairs');
  assert.equal(who(landOn(state, 'a', 'card-q'), 'a').cash, start);
});
