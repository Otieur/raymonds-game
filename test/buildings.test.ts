import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine } from '../src/index.ts';
import type { GameState } from '../src/index.ts';
import { board, build, economy, engine, landOn, newGame, own, play, rejects, street, who } from './helpers.ts';

const cost = street('g1-1').buildingCost;
const start = economy.startingCash;

function withGroup(): GameState {
  const state = newGame();
  own(state, 'a', 'g1-1', 'g1-2');
  return state;
}

function withShortage(left: number): GameState {
  const state = withGroup();
  own(state, 'b', 'g2-1', 'g2-2', 'g2-3');
  own(state, 'c', 'g3-1', 'g3-2', 'g4-1', 'g4-2');
  build(state, { 'g3-1': 4, 'g3-2': 4, 'g4-1': 4, 'g4-2': 4 });
  assert.equal(state.bank.houses, 4);
  const spare = state.bank.houses - left;
  if (spare > 0) {
    own(state, 'c', 'g5-1', 'g5-2', 'g5-3');
    const levels = [0, 0, 0];
    for (let i = 0; i < spare; i++) levels[i % 3] += 1;
    build(state, { 'g5-1': levels[0], 'g5-2': levels[1], 'g5-3': levels[2] });
  }
  assert.equal(state.bank.houses, left);
  assert.deepEqual(engine.checkInvariants(state), []);
  return state;
}

test('building needs the whole group, unmortgaged', () => {
  const partial = newGame();
  own(partial, 'a', 'g1-1');
  rejects(partial, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'GROUP_INCOMPLETE');

  const mortgaged = withGroup();
  mortgaged.properties['g1-2'].mortgaged = true;
  rejects(mortgaged, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'GROUP_MORTGAGED');

  const state = withGroup();
  rejects(state, { type: 'BUILD', player: 'b', property: 'g1-1' }, 'NOT_OWNER');
  rejects(state, { type: 'BUILD', player: 'a', property: 't1' }, 'NOT_A_STREET');
  rejects(state, { type: 'BUILD', player: 'a', property: 'nowhere' }, 'UNKNOWN_PROPERTY');
});

test('buildings must go up evenly across the group', () => {
  const one = play(withGroup(), { type: 'BUILD', player: 'a', property: 'g1-1' });
  assert.equal(one.properties['g1-1'].level, 1);
  assert.equal(who(one, 'a').cash, start - cost);
  rejects(one, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'UNEVEN_BUILD');

  const two = play(
    one,
    { type: 'BUILD', player: 'a', property: 'g1-2' },
    { type: 'BUILD', player: 'a', property: 'g1-1' },
  );
  assert.equal(two.properties['g1-1'].level, 2);
  assert.equal(two.bank.houses, economy.houses - 3);
});

test('a hotel needs four houses on every street and returns them to the bank', () => {
  const state = withGroup();
  build(state, { 'g1-1': 4, 'g1-2': 3 });
  rejects(state, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'UNEVEN_BUILD');

  const level = play(state, { type: 'BUILD', player: 'a', property: 'g1-2' });
  assert.equal(level.bank.houses, economy.houses - 8);

  const hotel = play(level, { type: 'BUILD', player: 'a', property: 'g1-1' });
  assert.equal(hotel.properties['g1-1'].level, 5);
  assert.equal(hotel.bank.houses, economy.houses - 4);
  assert.equal(hotel.bank.hotels, economy.hotels - 1);
  rejects(hotel, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'MAX_LEVEL');
});

test('building needs the cash and a free moment', () => {
  const broke = withGroup();
  who(broke, 'a').cash = cost - 1;
  rejects(broke, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'INSUFFICIENT_CASH');

  const deciding = landOn(withGroup(), 'a', 't2');
  rejects(deciding, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'DECISION_PENDING');
});

test('players may build outside their own turn', () => {
  const state = newGame();
  own(state, 'b', 'g1-1', 'g1-2');
  assert.equal(state.turn.player, 'a');
  const built = play(state, { type: 'BUILD', player: 'b', property: 'g1-2' });
  assert.equal(built.properties['g1-2'].level, 1);
});

test('nothing can be built once the bank runs out', () => {
  const state = withShortage(0);
  rejects(state, { type: 'BUILD', player: 'a', property: 'g1-1' }, 'BANK_SUPPLY');
});

test('buildings sell back evenly at half price', () => {
  const state = withGroup();
  build(state, { 'g1-1': 2, 'g1-2': 2 });
  const sold = play(state, { type: 'SELL_BUILDING', player: 'a', property: 'g1-1' });
  assert.equal(sold.properties['g1-1'].level, 1);
  assert.equal(who(sold, 'a').cash, start + cost / 2);
  assert.equal(sold.bank.houses, economy.houses - 3);
  rejects(sold, { type: 'SELL_BUILDING', player: 'a', property: 'g1-1' }, 'UNEVEN_BUILD');

  const empty = withGroup();
  rejects(empty, { type: 'SELL_BUILDING', player: 'a', property: 'g1-1' }, 'NO_BUILDINGS');
});

test('a hotel sells down to four houses when the bank has them', () => {
  const state = withGroup();
  build(state, { 'g1-1': 5, 'g1-2': 5 });
  const sold = play(state, { type: 'SELL_BUILDING', player: 'a', property: 'g1-1' });
  assert.equal(sold.properties['g1-1'].level, 4);
  assert.equal(sold.bank.houses, economy.houses - 4);
  assert.equal(sold.bank.hotels, economy.hotels - 1);
  assert.equal(who(sold, 'a').cash, start + cost / 2);
});

test('with too few houses in the bank, hotels can only be sold further down in one step', () => {
  const state = withGroup();
  own(state, 'c', 'g3-1', 'g3-2', 'g4-1', 'g4-2', 'g5-1', 'g5-2', 'g5-3');
  build(state, {
    'g1-1': 5,
    'g1-2': 5,
    'g3-1': 4,
    'g3-2': 4,
    'g4-1': 4,
    'g4-2': 4,
    'g5-1': 1,
    'g5-2': 1,
  });
  assert.equal(state.bank.houses, 2);

  rejects(state, { type: 'SELL_BUILDING', player: 'a', property: 'g1-1' }, 'BANK_SUPPLY');
  rejects(state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 4 } }, 'BANK_SUPPLY');
  rejects(state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 2, 'g1-2': 1 } }, 'BANK_SUPPLY');

  const sold = play(state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 1, 'g1-2': 1 } });
  assert.equal(sold.bank.houses, 0);
  assert.equal(sold.bank.hotels, economy.hotels);
  assert.equal(who(sold, 'a').cash, start + 8 * (cost / 2));

  const cleared = play(state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 0, 'g1-2': 0 } });
  assert.equal(who(cleared, 'a').cash, start + 10 * (cost / 2));
});

test('a group sale must stay even, stay within one group, and only go down', () => {
  const state = withGroup();
  own(state, 'a', 'g2-1', 'g2-2', 'g2-3');
  build(state, { 'g1-1': 2, 'g1-2': 2, 'g2-2': 1 });
  rejects(state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 0 } }, 'UNEVEN_BUILD');
  rejects(state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 3 } }, 'INVALID_ACTION');
  rejects(state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 1, 'g2-2': 0 } }, 'INVALID_ACTION');
  rejects(state, { type: 'SELL_BUILDINGS', player: 'a', levels: { 'g1-1': 2 } }, 'NO_BUILDINGS');
  rejects(state, { type: 'SELL_BUILDINGS', player: 'a', levels: {} }, 'INVALID_ACTION');
});

test('no auction is held while the bank can supply everyone', () => {
  const state = withGroup();
  own(state, 'b', 'g2-1', 'g2-2', 'g2-3');
  const built = play(state, { type: 'BUILD', player: 'a', property: 'g1-1' });
  assert.deepEqual(built.pending, []);
  assert.equal(built.properties['g1-1'].level, 1);
});

test('a building in short supply goes to auction among the players who could place it', () => {
  const state = play(withShortage(4), { type: 'BUILD', player: 'a', property: 'g1-1' });
  const auction = state.pending[0];
  assert.equal(auction.kind, 'buildingAuction');
  if (auction.kind !== 'buildingAuction') return;
  assert.deepEqual(auction.bidders, ['a', 'b']);
  assert.equal(auction.highBidder, 'a');
  assert.equal(auction.highBid, cost);
  assert.equal(state.properties['g1-1'].level, 0);
  assert.equal(who(state, 'a').cash, start);
  assert.deepEqual(engine.awaiting(state), ['b']);
});

test('the requester gets the building at list price when rivals pass', () => {
  const state = play(
    withShortage(4),
    { type: 'BUILD', player: 'a', property: 'g1-1' },
    { type: 'PASS', player: 'b' },
  );
  assert.deepEqual(state.pending, []);
  assert.equal(state.properties['g1-1'].level, 1);
  assert.equal(who(state, 'a').cash, start - cost);
  assert.equal(state.bank.houses, 3);
});

test('a rival who outbids places the building on a street of their own', () => {
  const opened = play(withShortage(4), { type: 'BUILD', player: 'a', property: 'g1-1' });
  const rivalCost = street('g2-2').buildingCost;
  const bid = rivalCost + 10;
  assert.ok(rivalCost > cost);
  rejects(opened, { type: 'BID', player: 'b', amount: bid }, 'INVALID_ACTION');
  rejects(opened, { type: 'BID', player: 'b', amount: rivalCost - 5, property: 'g2-2' }, 'BID_TOO_LOW');
  rejects(opened, { type: 'BID', player: 'b', amount: bid, property: 'g1-1' }, 'NOT_OWNER');
  rejects(opened, { type: 'MORTGAGE', player: 'b', property: 'g2-2' }, 'DECISION_PENDING');

  const outbid = play(opened, { type: 'BID', player: 'b', amount: bid, property: 'g2-2' });
  const won = play(outbid, { type: 'PASS', player: 'a' });
  assert.equal(won.properties['g2-2'].level, 1);
  assert.equal(won.properties['g1-1'].level, 0);
  assert.equal(who(won, 'b').cash, start - bid);
  assert.equal(who(won, 'a').cash, start);

  const fought = play(outbid, { type: 'BID', player: 'a', amount: bid + 20 }, { type: 'PASS', player: 'b' });
  assert.equal(fought.properties['g1-1'].level, 1);
  assert.equal(who(fought, 'a').cash, start - bid - 20);
});

test('the shortage auction can be switched off', () => {
  const relaxed = createEngine(board, { buildingShortageAuction: false });
  const result = relaxed.apply(withShortage(4), { type: 'BUILD', player: 'a', property: 'g1-1' });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.state.pending, []);
  assert.equal(result.state.properties['g1-1'].level, 1);
});
