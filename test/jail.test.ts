import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  economy,
  engine,
  giveJailCard,
  indexOf,
  jail,
  landOn,
  newGame,
  own,
  play,
  property,
  rejects,
  roll,
  who,
} from './helpers.ts';

test('the go-to-jail square jails the player and pays no salary', () => {
  const state = landOn(newGame(), 'a', 'go-to-jail');
  const player = who(state, 'a');
  assert.equal(player.inJail, true);
  assert.equal(player.position, indexOf('jail'));
  assert.equal(player.cash, economy.startingCash);
  assert.equal(state.turn.phase, 'postRoll');
});

test('going to jail on doubles forfeits the extra roll', () => {
  const state = landOn(newGame(), 'a', 'go-to-jail', [2, 2]);
  assert.equal(who(state, 'a').inJail, true);
  assert.equal(state.turn.phase, 'postRoll');
  assert.equal(state.turn.doubles, 0);
  rejects(state, { type: 'ROLL', player: 'a' }, 'WRONG_PHASE');
  assert.equal(play(state, { type: 'END_TURN', player: 'a' }).turn.player, 'b');
});

test('paying bail before rolling frees the player for a normal roll', () => {
  const state = newGame();
  jail(state, 'a');
  own(state, 'a', 'g4-1');
  const freed = play(state, { type: 'PAY_BAIL', player: 'a' });
  assert.equal(who(freed, 'a').inJail, false);
  assert.equal(who(freed, 'a').cash, economy.startingCash - economy.bail);

  roll(freed, [2, 2]);
  const moved = play(freed, { type: 'ROLL', player: 'a' });
  assert.equal(who(moved, 'a').position, indexOf('g4-1'));
  assert.equal(moved.turn.phase, 'preRoll');
});

test('bail needs the cash, a jailed player, and an unrolled turn', () => {
  const state = newGame();
  rejects(state, { type: 'PAY_BAIL', player: 'a' }, 'NOT_IN_JAIL');
  rejects(state, { type: 'USE_JAIL_CARD', player: 'a' }, 'NOT_IN_JAIL');

  jail(state, 'a');
  rejects(state, { type: 'USE_JAIL_CARD', player: 'a' }, 'NO_JAIL_CARD');
  who(state, 'a').cash = economy.bail - 1;
  rejects(state, { type: 'PAY_BAIL', player: 'a' }, 'INSUFFICIENT_CASH');

  who(state, 'a').cash = economy.startingCash;
  roll(state, [1, 2]);
  const failed = play(state, { type: 'ROLL', player: 'a' });
  rejects(failed, { type: 'PAY_BAIL', player: 'a' }, 'WRONG_PHASE');
});

test('a jail card frees the player and returns to the bottom of its deck', () => {
  const state = newGame();
  jail(state, 'a');
  giveJailCard(state, 'a', 'p', 'p-free');
  assert.equal(state.decks.p.includes('p-free'), false);

  const freed = play(state, { type: 'USE_JAIL_CARD', player: 'a' });
  assert.equal(who(freed, 'a').inJail, false);
  assert.deepEqual(who(freed, 'a').jailCards, []);
  assert.equal(who(freed, 'a').cash, economy.startingCash);
  assert.equal(freed.decks.p.at(-1), 'p-free');
  assert.equal(freed.turn.phase, 'preRoll');
});

test('rolling doubles in jail frees the player, who moves but does not roll again', () => {
  const state = newGame();
  jail(state, 'a');
  own(state, 'a', 'g4-2');
  roll(state, [3, 3]);
  const moved = play(state, { type: 'ROLL', player: 'a' });
  assert.equal(who(moved, 'a').inJail, false);
  assert.equal(who(moved, 'a').position, indexOf('g4-2'));
  assert.equal(who(moved, 'a').cash, economy.startingCash);
  assert.equal(moved.turn.phase, 'postRoll');
  rejects(moved, { type: 'ROLL', player: 'a' }, 'WRONG_PHASE');
});

test('a failed jail roll keeps the player in jail for the turn', () => {
  const state = newGame();
  jail(state, 'a');
  roll(state, [1, 2]);
  const failed = play(state, { type: 'ROLL', player: 'a' });
  assert.equal(who(failed, 'a').inJail, true);
  assert.equal(who(failed, 'a').jailRolls, 1);
  assert.equal(who(failed, 'a').position, indexOf('jail'));
  assert.equal(failed.turn.phase, 'postRoll');
});

test('the third failed roll forces bail, and the player moves by that roll', () => {
  const state = newGame();
  jail(state, 'a');
  who(state, 'a').jailRolls = 2;
  own(state, 'a', 'g3-2');
  roll(state, [1, 2]);
  const moved = play(state, { type: 'ROLL', player: 'a' });
  assert.equal(who(moved, 'a').inJail, false);
  assert.equal(who(moved, 'a').cash, economy.startingCash - economy.bail);
  assert.equal(who(moved, 'a').position, indexOf('g3-2'));
  assert.equal(moved.turn.phase, 'postRoll');
});

test('forced bail the player cannot cover becomes a debt, settled before moving', () => {
  const state = newGame();
  jail(state, 'a');
  who(state, 'a').jailRolls = 2;
  who(state, 'a').cash = 10;
  own(state, 'a', 'g3-2', 't1');
  roll(state, [1, 2]);

  const owing = play(state, { type: 'ROLL', player: 'a' });
  assert.equal(owing.pending[0].kind, 'debt');
  assert.equal(who(owing, 'a').inJail, true);
  assert.equal(who(owing, 'a').position, indexOf('jail'));
  rejects(owing, { type: 'END_TURN', player: 'a' }, 'DECISION_PENDING');

  const settled = play(owing, { type: 'MORTGAGE', player: 'a', property: 't1' });
  assert.deepEqual(settled.pending, []);
  assert.equal(who(settled, 'a').cash, 10 + property('t1').mortgageValue - economy.bail);
  assert.equal(who(settled, 'a').inJail, false);
  assert.equal(who(settled, 'a').position, indexOf('g3-2'));
});

test('a jailed player can still manage property and bid', () => {
  const state = newGame();
  jail(state, 'b');
  own(state, 'b', 't1');
  const mortgaged = play(state, { type: 'MORTGAGE', player: 'b', property: 't1' });
  assert.equal(mortgaged.properties.t1.mortgaged, true);

  const auction = play(landOn(mortgaged, 'a', 'g1-2'), { type: 'DECLINE', player: 'a' });
  play(auction, { type: 'BID', player: 'b', amount: 5 });
});

test('after a third failed roll, a player holding a jail card may use it instead of paying', () => {
  const state = newGame();
  jail(state, 'a');
  who(state, 'a').jailRolls = 2;
  giveJailCard(state, 'a', 'p', 'p-free');
  own(state, 'a', 'g3-2');
  roll(state, [1, 2]);

  const choosing = play(state, { type: 'ROLL', player: 'a' });
  assert.deepEqual(choosing.pending, [{ kind: 'jailExit', player: 'a', dice: [1, 2] }]);
  assert.equal(who(choosing, 'a').inJail, true);
  assert.equal(who(choosing, 'a').position, indexOf('jail'));
  rejects(choosing, { type: 'END_TURN', player: 'a' }, 'DECISION_PENDING');
  rejects(choosing, { type: 'ROLL', player: 'a' }, 'DECISION_PENDING');

  const freed = play(choosing, { type: 'USE_JAIL_CARD', player: 'a' });
  assert.deepEqual(freed.pending, []);
  assert.equal(who(freed, 'a').inJail, false);
  assert.equal(who(freed, 'a').cash, economy.startingCash);
  assert.equal(who(freed, 'a').position, indexOf('g3-2'));
  assert.deepEqual(who(freed, 'a').jailCards, []);
  assert.equal(freed.decks.p.at(-1), 'p-free');
  assert.equal(freed.turn.phase, 'postRoll');
});

test('after a third failed roll, a card holder may still pay bail and keep the card', () => {
  const state = newGame();
  jail(state, 'a');
  who(state, 'a').jailRolls = 2;
  giveJailCard(state, 'a', 'p', 'p-free');
  own(state, 'a', 'g3-2');
  roll(state, [1, 2]);

  const paid = play(play(state, { type: 'ROLL', player: 'a' }), { type: 'PAY_BAIL', player: 'a' });
  assert.deepEqual(paid.pending, []);
  assert.equal(who(paid, 'a').inJail, false);
  assert.equal(who(paid, 'a').cash, economy.startingCash - economy.bail);
  assert.equal(who(paid, 'a').position, indexOf('g3-2'));
  assert.equal(who(paid, 'a').jailCards.length, 1);
});

test('a card holder who cannot cover bail leaves with the card, or raises the cash first', () => {
  const state = newGame();
  jail(state, 'a');
  who(state, 'a').jailRolls = 2;
  who(state, 'a').cash = 10;
  giveJailCard(state, 'a', 'p', 'p-free');
  own(state, 'a', 't1');
  roll(state, [1, 2]);

  const choosing = play(state, { type: 'ROLL', player: 'a' });
  rejects(choosing, { type: 'PAY_BAIL', player: 'a' }, 'INSUFFICIENT_CASH');
  const legal = engine.legalActions(choosing, 'a').map((action) => action.type);
  assert.ok(legal.includes('USE_JAIL_CARD'));
  assert.ok(legal.includes('MORTGAGE'));

  const raised = play(choosing, { type: 'MORTGAGE', player: 'a', property: 't1' });
  const paid = play(raised, { type: 'PAY_BAIL', player: 'a' });
  assert.equal(who(paid, 'a').cash, 10 + property('t1').mortgageValue - economy.bail);
  assert.equal(who(paid, 'a').inJail, false);
});
