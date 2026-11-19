import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { GameState, PlayerId } from '../src/index.ts';
import { applyDeal, dealSheet, denialWorth, distressOf, incomeInReach, isFailing, pointsPerCoin, threatOf, worthInCoins } from '../src/sim/deal.ts';
import type { Deal } from '../src/sim/deal.ts';
import { viewOf } from '../src/sim/measures.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import { v1 } from '../src/sim/valuation.ts';

const engine = createEngine(threeKingdoms);
const ctx = contextOf(engine);
const valuation = v1(4);

function table(): GameState {
  const state = engine.newGame({ players: ['a', 'b', 'c', 'd'], seed: 1, startingPlayer: 'a' });
  state.turn.number = 41; // round 10
  return state;
}
function give(state: GameState, owner: PlayerId | null, ...ids: string[]): void {
  for (const id of ids) state.properties[id].owner = owner;
}
const seat = (state: GameState, id: PlayerId) => state.players.find((p) => p.id === id) as GameState['players'][number];
const side = (cash: number, ...properties: string[]) => ({ cash, properties, jailCards: 0 });

/** `a` holds two streets of Chain Stratagem and `b` the third. */
function oneShort(): GameState {
  const state = table();
  give(state, 'a', 'wang-yun', 'diaochan');
  give(state, 'b', 'lu-bu');
  give(state, 'c', 'cao-cao');
  give(state, 'd', 'liu-bei');
  return state;
}

test('deal sheet: the changes sum to zero, and a street for one coin moves chance to the seat that gets it', () => {
  const state = oneShort();
  const deal: Deal = { from: 'b', to: 'a', give: side(0, 'lu-bu'), receive: side(1) };
  const sheet = dealSheet(ctx, state, deal, valuation);
  assert.ok(Math.abs(sheet.delta.reduce((sum, d) => sum + d, 0)) < 1e-9);
  assert.ok(sheet.delta[0] > 0.05, `a gains: ${sheet.delta[0]}`);
  assert.ok(sheet.delta[1] < 0, `b loses: ${sheet.delta[1]}`);
  // The seats outside the deal pay for it too.
  assert.ok(sheet.delta[2] < 0 && sheet.delta[3] < 0);
});

test('deal sheet: renaming the seats changes nothing', () => {
  const state = oneShort();
  const names: Record<string, string> = { a: 'w', b: 'x', c: 'y', d: 'z' };
  const renamed = structuredClone(state);
  for (const p of renamed.players) p.id = names[p.id];
  for (const held of Object.values(renamed.properties)) if (held.owner) held.owner = names[held.owner];
  renamed.turn.player = names[renamed.turn.player];
  const first = dealSheet(ctx, state, { from: 'a', to: 'b', give: side(250), receive: side(0, 'lu-bu') }, valuation);
  const second = dealSheet(ctx, renamed, { from: 'w', to: 'x', give: side(250), receive: side(0, 'lu-bu') }, valuation);
  first.delta.forEach((d, i) => assert.ok(Math.abs(d - second.delta[i]) < 1e-12));
});

test('applyDeal agrees with the engine and keeps the table whole', () => {
  const state = oneShort();
  state.turn.phase = 'postRoll';
  const deal: Deal = { from: 'a', to: 'b', give: side(250, 'wang-yun'), receive: side(40, 'lu-bu') };
  const proposed = engine.apply(state, { type: 'PROPOSE_TRADE', player: 'a', to: 'b', give: deal.give, receive: deal.receive });
  assert.ok(proposed.ok);
  const accepted = engine.apply(proposed.state, { type: 'ACCEPT_TRADE', player: 'b' });
  assert.ok(accepted.ok);
  const mine = applyDeal(ctx, state, deal);
  for (const p of mine.players) assert.equal(p.cash, seat(accepted.state, p.id).cash, `cash of ${p.id}`);
  for (const id of Object.keys(mine.properties)) assert.equal(mine.properties[id].owner, accepted.state.properties[id].owner, id);
  assert.deepEqual(engine.checkInvariants(mine), []);
  const total = (s: GameState) => s.players.reduce((sum, p) => sum + p.cash, 0);
  assert.equal(total(mine), total(state));
});

test('applyDeal: the receiver of a mortgaged property pays the interest', () => {
  const state = oneShort();
  state.properties['lu-bu'].mortgaged = true;
  const before = seat(state, 'a').cash;
  const after = applyDeal(ctx, state, { from: 'a', to: 'b', give: side(100), receive: side(0, 'lu-bu') });
  assert.equal(seat(after, 'a').cash, before - 100 - 6); // 10% of Lü Bu's mortgage value of 60
});

test('worthInCoins: the last street of a group is worth more than its price, and nothing is worth nothing', () => {
  const state = oneShort();
  const changed = structuredClone(state);
  changed.properties['lu-bu'].owner = 'a';
  const worth = worthInCoins(ctx, state, changed, 'a', valuation, 2000);
  assert.ok(worth > 120, `worth ${worth}`);
  assert.ok(worth <= seat(state, 'a').cash);
  // Paying exactly that leaves the seat about where it was.
  const paid = structuredClone(changed);
  seat(paid, 'a').cash -= worth;
  assert.ok(Math.abs(valuation.chances(ctx, paid)[0] - valuation.chances(ctx, state)[0]) < 0.005);
  assert.equal(worthInCoins(ctx, state, structuredClone(state), 'a', valuation, 2000), 0);
  // Paid to the holder and not to the bank, the same street is worth less: the cash strengthens a rival.
  const toHolder = worthInCoins(ctx, state, changed, 'a', valuation, 2000, 'b');
  assert.ok(toHolder > 120 && toHolder < worth, `to the holder ${toHolder}, to the bank ${worth}`);
  const sheet = dealSheet(ctx, state, { from: 'a', to: 'b', give: side(toHolder), receive: side(0, 'lu-bu') }, valuation);
  assert.ok(Math.abs(sheet.delta[0]) < 0.005, `at that price a neither gains nor loses: ${sheet.delta[0]}`);
  assert.ok(pointsPerCoin(ctx, state, 'a', valuation) > 0);
});

test('threat: a seat one street short wants that street, and its potential is above its chance now', () => {
  const state = oneShort();
  const threat = threatOf(ctx, state, 'a', valuation);
  assert.equal(threat.wants, 'lu-bu');
  assert.ok(threat.potential > threat.now);
  assert.equal(threat.canBuild, 0);
  // With the whole group and cash in hand it can build.
  give(state, 'a', 'lu-bu');
  assert.ok(threatOf(ctx, state, 'a', valuation).canBuild >= 10);
  // A seat that holds nothing of any set wants nothing.
  give(state, null, 'liu-bei');
  const idle = threatOf(ctx, state, 'd', valuation);
  assert.equal(idle.wants, null);
  assert.equal(idle.potential, idle.now);
});

test('distress: a seat with everything mortgaged and cash below its dues is failing, and names its creditor', () => {
  const state = oneShort();
  give(state, 'c', 'wang-yun', 'diaochan', 'lu-bu');
  for (const id of ['wang-yun', 'diaochan', 'lu-bu']) state.properties[id].level = 5;
  give(state, 'b', 'cao-pi');
  state.properties['cao-pi'].mortgaged = true;
  seat(state, 'b').cash = 40;
  const distress = distressOf(ctx, state, 'b', valuation);
  assert.equal(distress.short, true);
  assert.equal(distress.mortgaged, 1);
  assert.equal(distress.creditor, 'c');
  assert.ok(distress.chance < 0.4, `chance ${distress.chance}`);
  assert.equal(isFailing(distress, 0.4), true);
  // A seat with cash in hand and nothing owed ahead is not short.
  const sound = distressOf(ctx, state, 'c', valuation);
  assert.equal(sound.short, false);
  assert.equal(isFailing(sound, 0.4), false);
  // Falling: its chance fell in each of the last three rounds on record.
  assert.equal(distressOf(ctx, state, 'b', valuation, [0.4, 0.3, 0.2, 0.1]).falling, true);
  assert.equal(distressOf(ctx, state, 'b', valuation, [0.1, 0.3, 0.2, 0.1]).falling, false);
  assert.equal(distressOf(ctx, state, 'b', valuation, [0.3, 0.2, 0.1]).falling, false);
});

test('denial: stopping a rival is worth something when the holder may sell, and nothing when it will not', () => {
  const state = oneShort();
  assert.ok(denialWorth(ctx, state, 'c', 'a', 'lu-bu', valuation, 1) > 0);
  assert.equal(denialWorth(ctx, state, 'c', 'a', 'lu-bu', valuation, 0), 0);
});

test('income in reach: rent expected from the other seats\' next rolls', () => {
  const state = oneShort();
  // Everyone stands on LuoYang; Wang Yun is six squares on, Diaochan eight.
  assert.ok(incomeInReach(viewOf(ctx, state), 'a') > 0);
  assert.equal(incomeInReach(viewOf(ctx, state), 'd'), 0); // Liu Bei is twenty-one squares on
});
