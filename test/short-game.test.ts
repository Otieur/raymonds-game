import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine, HOTEL_LEVEL, SHORT_GAME_RULES, simulateGame, threeKingdoms } from '../src/index.ts';
import type { Action, Engine, ErrorCode, GameEvent, GameState, PlayerId, SquareId } from '../src/index.ts';
import { fixture } from './fixture.ts';
import { build, economy, indexOf, own, property, size, street, who } from './helpers.ts';

const short = createEngine(fixture, SHORT_GAME_RULES);
/** The short game without the opening deal, so tests can place property themselves. */
const undealt = createEngine(fixture, { ...SHORT_GAME_RULES, startingDeeds: 0 });

function newGame(engine: Engine, players: PlayerId[] = ['a', 'b', 'c', 'd']): GameState {
  return engine.newGame({ players, seed: 42, startingPlayer: players[0] });
}

function step(engine: Engine, state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const result = engine.apply(state, action);
  if (!result.ok) assert.fail(`${action.type} was rejected: ${result.error.code} (${result.error.message})`);
  assert.deepEqual(engine.checkInvariants(result.state), []);
  return result;
}

function play(engine: Engine, state: GameState, ...actions: Action[]): GameState {
  return actions.reduce((current, action) => step(engine, current, action).state, state);
}

function rejects(engine: Engine, state: GameState, action: Action, code: ErrorCode): void {
  const result = engine.apply(state, action);
  if (result.ok) assert.fail(`${action.type} should have been rejected with ${code}.`);
  assert.equal(result.error.code, code);
}

function landOn(engine: Engine, state: GameState, player: PlayerId, squareId: SquareId) {
  who(state, player).position = (indexOf(squareId) - 3 + size) % size;
  state.diceQueue.unshift([1, 2]);
  return step(engine, state, { type: 'ROLL', player });
}

function bankrupt(state: GameState, player: PlayerId): void {
  const p = who(state, player);
  p.bankrupt = true;
  p.cash = 0;
}

test('setup deals two deeds to each player, who pays their printed price', () => {
  const state = newGame(short);
  assert.deepEqual(short.checkInvariants(state), []);
  const dealt = new Set<string>();
  for (const player of state.players) {
    const owned = Object.keys(state.properties).filter((id) => state.properties[id].owner === player.id);
    assert.equal(owned.length, 2, player.id);
    const paid = owned.reduce((sum, id) => sum + property(id).price, 0);
    assert.equal(player.cash, economy.startingCash - paid, player.id);
    for (const id of owned) dealt.add(id);
  }
  assert.equal(dealt.size, 8);
  assert.deepEqual(newGame(short).properties, state.properties);
});

test('the deal needs enough deeds for every player', () => {
  const greedy = createEngine(fixture, { startingDeeds: 3 });
  const players = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.throws(() => greedy.newGame({ players, seed: 1 }), /needs 18 properties; the board has 16/);
});

test('rule options are checked when the engine is built', () => {
  assert.throws(() => createEngine(fixture, { housesBeforeHotel: 0 }), /housesBeforeHotel must be 1 to 4/);
  assert.throws(() => createEngine(fixture, { housesBeforeHotel: 5 }), /housesBeforeHotel must be 1 to 4/);
  assert.throws(() => createEngine(fixture, { endAfterBankruptcies: 0 }), /endAfterBankruptcies/);
  assert.throws(() => createEngine(fixture, { startingDeeds: -1 }), /startingDeeds/);
});

test('three houses on every street of the group are enough for a hotel', () => {
  const state = newGame(undealt);
  own(state, 'a', 'g1-1', 'g1-2');
  build(state, { 'g1-1': 3, 'g1-2': 3 });

  const built = play(undealt, state, { type: 'BUILD', player: 'a', property: 'g1-1' });
  assert.equal(built.properties['g1-1'].level, HOTEL_LEVEL);
  assert.deepEqual(built.bank, { houses: economy.houses - 3, hotels: economy.hotels - 1 });
  assert.equal(who(built, 'a').cash, economy.startingCash - street('g1-1').buildingCost);
  rejects(undealt, built, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'MAX_LEVEL');

  built.turn = { ...built.turn, player: 'b' };
  const rented = landOn(undealt, built, 'b', 'g1-1').state;
  const passedStart = economy.salary;
  assert.equal(who(rented, 'b').cash, economy.startingCash + passedStart - street('g1-1').rents[HOTEL_LEVEL]);
});

test('a hotel counts as one step past three houses when building evenly', () => {
  const state = newGame(undealt);
  own(state, 'a', 'g2-1', 'g2-2', 'g2-3');
  build(state, { 'g2-1': 3, 'g2-2': 3, 'g2-3': 2 });
  rejects(undealt, state, { type: 'BUILD', player: 'a', property: 'g2-1' }, 'UNEVEN_BUILD');

  const even = play(undealt, state, { type: 'BUILD', player: 'a', property: 'g2-3' });
  const oneHotel = play(undealt, even, { type: 'BUILD', player: 'a', property: 'g2-1' });
  assert.deepEqual(
    ['g2-1', 'g2-2', 'g2-3'].map((id) => oneHotel.properties[id].level),
    [HOTEL_LEVEL, 3, 3],
  );
  play(undealt, oneHotel, { type: 'BUILD', player: 'a', property: 'g2-2' });
});

test('a hotel breaks down to three houses and sells back one house short of the regular game', () => {
  const state = newGame(undealt);
  own(state, 'a', 'g1-1', 'g1-2');
  build(state, { 'g1-1': HOTEL_LEVEL, 'g1-2': HOTEL_LEVEL });
  const half = street('g1-1').buildingCost / 2;

  const broken = play(undealt, state, { type: 'SELL_BUILDING', player: 'a', property: 'g1-1' });
  assert.equal(broken.properties['g1-1'].level, 3);
  assert.equal(who(broken, 'a').cash, economy.startingCash + half);

  rejects(undealt, state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 4, 'g1-2': 4 } }, 'INVALID_ACTION');
  const cleared = play(undealt, state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 0, 'g1-2': 0 } });
  assert.equal(who(cleared, 'a').cash, economy.startingCash + 2 * 4 * half);

  state.bank.houses = 2;
  rejects(undealt, state, { type: 'SELL_BUILDING', player: 'a', property: 'g1-1' }, 'BANK_SUPPLY');
});

/** a lands on b's hotel at g5-3, cannot cover the rent, and owns a group with hotels of its own. */
function ruinousRent(state: GameState): GameState {
  own(state, 'b', 'g5-1', 'g5-2', 'g5-3');
  own(state, 'a', 'g1-1', 'g1-2', 't2');
  state.properties.t2.mortgaged = true;
  build(state, { 'g5-1': HOTEL_LEVEL, 'g5-2': HOTEL_LEVEL, 'g5-3': HOTEL_LEVEL, 'g1-1': HOTEL_LEVEL, 'g1-2': HOTEL_LEVEL });
  who(state, 'a').cash = 0;
  return landOn(undealt, state, 'a', 'g5-3').state;
}

test('the first bankruptcy does not end the short game, and hotels sell back one house short', () => {
  const state = newGame(undealt);
  who(state, 'b').cash = 500;
  const owing = ruinousRent(state);
  assert.equal(owing.pending.at(-1)?.kind, 'debt');

  const { state: after, events } = step(undealt, owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  assert.equal(after.winner, null);
  const half = street('g1-1').buildingCost / 2;
  assert.equal(who(after, 'b').cash, 500 + 2 * 4 * half - property('t2').mortgageValue / 10);
  assert.ok(!events.some((e) => e.type === 'GAME_OVER'));
});

test('the second bankruptcy ends the game: buildings pass intact and the richest player wins', () => {
  const state = newGame(undealt);
  bankrupt(state, 'd');
  who(state, 'b').cash = 500;
  who(state, 'c').cash = 3000;
  own(state, 'c', 't1');
  state.properties.t1.mortgaged = true;
  const owing = ruinousRent(state);
  const bankBefore = { ...owing.bank };

  const { state: over, events } = step(undealt, owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  assert.equal(over.properties['g1-1'].owner, 'b');
  assert.equal(over.properties['g1-1'].level, HOTEL_LEVEL);
  assert.equal(over.properties.t2.mortgaged, true);
  assert.deepEqual(over.bank, bankBefore);
  assert.equal(who(over, 'b').cash, 500);

  const bWorth = 500 + (200 + 200 + 240) + 3 * 4 * 100 + (70 + 80) + 2 * 4 * 50 + 100 / 2;
  const cWorth = 3000 + 100 / 2;
  const standings = [
    { player: 'c', netWorth: cWorth, cash: 3000 },
    { player: 'b', netWorth: bWorth, cash: 500 },
  ];
  assert.deepEqual(undealt.standings(over), standings);
  assert.equal(undealt.netWorth(over, 'b'), bWorth);
  assert.equal(over.winner, 'c');
  assert.deepEqual(
    events.find((e) => e.type === 'GAME_OVER'),
    { type: 'GAME_OVER', winner: 'c', reason: 'bankruptcyLimit', standings },
  );
  rejects(undealt, over, { type: 'END_TURN', player: 'c' }, 'GAME_OVER');
});

test('a second bankruptcy owed to the bank returns everything to the bank and ends the game', () => {
  const state = newGame(undealt);
  bankrupt(state, 'd');
  own(state, 'a', 't1');
  state.properties.t1.mortgaged = true;
  who(state, 'a').cash = 0;
  who(state, 'c').cash = 1200;

  const owing = landOn(undealt, state, 'a', 'tax').state;
  const { state: over, events } = step(undealt, owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  assert.deepEqual(over.properties.t1, { owner: null, mortgaged: false, level: 0 });
  assert.equal(over.winner, 'c');
  assert.ok(events.some((e) => e.type === 'GAME_OVER' && e.reason === 'bankruptcyLimit'));
});

test('with two players the first bankruptcy still ends the game with the last player', () => {
  const state = newGame(undealt, ['a', 'b']);
  own(state, 'b', 'g5-1', 'g5-2', 'g5-3');
  build(state, { 'g5-1': HOTEL_LEVEL, 'g5-2': HOTEL_LEVEL, 'g5-3': HOTEL_LEVEL });
  who(state, 'a').cash = 0;
  const owing = landOn(undealt, state, 'a', 'g5-3').state;
  const { events } = step(undealt, owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  assert.ok(events.some((e) => e.type === 'GAME_OVER' && e.reason === 'lastPlayer' && e.winner === 'b'));
});

test('random short games end at the second bankruptcy on both boards with every rule invariant intact', () => {
  for (const board of [fixture, threeKingdoms]) {
    const engine = createEngine(board, SHORT_GAME_RULES);
    for (const players of [3, 4, 6]) {
      for (let seed = 1; seed <= 4; seed++) {
        const result = simulateGame(engine, { players, seed: players * 100 + seed, maxActions: 20000 });
        assert.ok(result.finished, `${board.id}: ${players} players, seed ${seed}`);
        const out = result.state.players.filter((p) => p.bankrupt).length;
        assert.ok(out <= 2, `${board.id}: the game ran past the second bankruptcy`);
        assert.equal(result.state.winner, engine.standings(result.state)[0].player);
      }
    }
  }
});
