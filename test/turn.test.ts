import assert from 'node:assert/strict';
import { test } from 'node:test';
import { board, economy, engine, indexOf, landOn, newGame, own, play, playWithEvents, rejects, roll, size, who } from './helpers.ts';

test('a roll moves the player, and the turn then passes on', () => {
  const rolled = landOn(newGame(), 'a', 'jail');
  assert.equal(who(rolled, 'a').position, indexOf('jail'));
  assert.equal(who(rolled, 'a').inJail, false);
  assert.equal(rolled.turn.phase, 'postRoll');
  rejects(rolled, { type: 'ROLL', player: 'a' }, 'WRONG_PHASE');

  const next = play(rolled, { type: 'END_TURN', player: 'a' });
  assert.equal(next.turn.player, 'b');
  assert.equal(next.turn.number, 2);
  assert.equal(next.turn.phase, 'preRoll');
});

test('the turn cannot end before rolling, and only the current player rolls', () => {
  const start = newGame();
  rejects(start, { type: 'END_TURN', player: 'a' }, 'WRONG_PHASE');
  rejects(start, { type: 'ROLL', player: 'b' }, 'NOT_YOUR_TURN');
  rejects(start, { type: 'ROLL', player: 'nobody' }, 'UNKNOWN_PLAYER');
});

test('doubles earn another roll', () => {
  const start = newGame();
  own(start, 'a', 'g5-1');
  const first = landOn(start, 'a', 'rest', [4, 4]);
  assert.equal(first.turn.phase, 'preRoll');
  assert.equal(first.turn.doubles, 1);
  rejects(first, { type: 'END_TURN', player: 'a' }, 'WRONG_PHASE');

  roll(first, [1, 2]);
  const second = play(first, { type: 'ROLL', player: 'a' });
  assert.equal(who(second, 'a').position, indexOf('g5-1'));
  assert.equal(second.turn.phase, 'postRoll');
});

test('a third double in a row sends the player to jail without moving', () => {
  const start = newGame();
  own(start, 'a', 'g5-2');
  const first = landOn(start, 'a', 'rest', [4, 4]);
  roll(first, [2, 2], [3, 3]);
  const second = play(first, { type: 'ROLL', player: 'a' });
  assert.equal(who(second, 'a').position, indexOf('g5-2'));

  const third = playWithEvents(second, { type: 'ROLL', player: 'a' });
  const player = who(third.state, 'a');
  assert.equal(player.inJail, true);
  assert.equal(player.position, indexOf('jail'));
  assert.equal(third.state.turn.phase, 'postRoll');
  assert.equal(third.state.turn.doubles, 0);
  assert.equal(third.events.some((e) => e.type === 'MOVED'), false);
  assert.ok(third.events.some((e) => e.type === 'SENT_TO_JAIL' && e.reason === 'doubles'));
});

test('landing exactly on the start square pays the salary once', () => {
  const landed = landOn(newGame(), 'a', 'start');
  assert.equal(who(landed, 'a').position, 0);
  assert.equal(who(landed, 'a').cash, economy.startingCash + economy.salary);
});

test('passing the start square pays the salary once', () => {
  const start = newGame();
  own(start, 'a', 'g1-1');
  who(start, 'a').position = size - 2;
  roll(start, [1, 2]);
  const landed = play(start, { type: 'ROLL', player: 'a' });
  assert.equal(who(landed, 'a').position, indexOf('g1-1'));
  assert.equal(who(landed, 'a').cash, economy.startingCash + economy.salary);
});

test('a tax square charges its fixed amount', () => {
  const tax = board.squares[indexOf('tax')];
  assert.equal(tax.kind, 'tax');
  if (tax.kind !== 'tax') return;
  const landed = landOn(newGame(), 'a', 'tax');
  assert.equal(who(landed, 'a').cash, economy.startingCash - tax.amount);
  assert.deepEqual(landed.pending, []);
});

test('the rest square does nothing', () => {
  const landed = landOn(newGame(), 'a', 'rest');
  assert.equal(who(landed, 'a').cash, economy.startingCash);
  assert.deepEqual(landed.pending, []);
});

test('the same seed gives the same game, and states survive JSON', () => {
  const first = engine.newGame({ players: ['a', 'b', 'c'], seed: 'fixture' });
  const second = engine.newGame({ players: ['a', 'b', 'c'], seed: 'fixture' });
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.ok(['a', 'b', 'c'].includes(first.turn.player));
  assert.deepEqual(engine.checkInvariants(first), []);

  const rolledA = engine.apply(first, { type: 'ROLL', player: first.turn.player });
  const rolledB = engine.apply(second, { type: 'ROLL', player: second.turn.player });
  assert.deepEqual(rolledA, rolledB);
});

test('applying an action leaves the input state untouched', () => {
  const start = newGame();
  const snapshot = structuredClone(start);
  play(start, { type: 'ROLL', player: 'a' });
  assert.deepEqual(start, snapshot);

  rejects(start, { type: 'END_TURN', player: 'a' }, 'WRONG_PHASE');
  assert.deepEqual(start, snapshot);
});

test('games need a legal number of distinct players', () => {
  assert.throws(() => engine.newGame({ players: ['solo'] }));
  assert.throws(() => engine.newGame({ players: ['a', 'a'] }));
  assert.throws(() => engine.newGame({ players: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }));
  assert.equal(engine.newGame({ players: ['1', '2', '3', '4', '5', '6', '7', '8'] }).players.length, 8);
});
