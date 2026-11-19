import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyTally, memberOf, playNamed, report } from '../scripts/table.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { Action, GameState, PlayerId } from '../src/index.ts';
import { createPoliticsWatch } from '../src/sim/politics.ts';
import type { PoliticsWatch } from '../src/sim/politics.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import { v1 } from '../src/sim/valuation.ts';

const engine = createEngine(threeKingdoms);
const ctx = contextOf(engine);
const ids = ['a', 'b', 'c', 'd'];
const side = (cash: number, ...properties: string[]) => ({ cash, properties, jailCards: 0 });
const seatOf = (state: GameState, id: PlayerId) => state.players.find((p) => p.id === id) as GameState['players'][number];

function table(): GameState {
  const state = engine.newGame({ players: ids, seed: 1, startingPlayer: 'a' });
  state.turn.number = 41;
  state.turn.phase = 'postRoll';
  return state;
}
const give = (state: GameState, owner: PlayerId, ...properties: string[]) => {
  for (const id of properties) state.properties[id].owner = owner;
};
/** Applies an action and feeds the watch. */
function step(state: GameState, watch: PoliticsWatch, action: Action): GameState {
  const result = engine.apply(state, action);
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  watch.note(state, result.events, result.state);
  return result.state;
}
const ask = (from: PlayerId, to: PlayerId, cash: number, property: string): Action => ({ type: 'PROPOSE_TRADE', player: from, to, give: side(cash), receive: side(0, property) });

test('politics: an early purchase, its price and the asks it took are counted for the buyer', () => {
  let state = table();
  give(state, 'a', 'wang-yun');
  give(state, 'b', 'diaochan');
  const watch = createPoliticsWatch(ctx, ids, v1(4));
  state = step(state, watch, ask('a', 'b', 90, 'diaochan'));
  state = step(state, watch, { type: 'REJECT_TRADE', player: 'b' });
  state = step(state, watch, ask('a', 'b', 150, 'diaochan'));
  state = step(state, watch, { type: 'ACCEPT_TRADE', player: 'b' });
  const { seats } = watch.finish(state);
  assert.equal(seats.a.earlyDeals, 1);
  assert.equal(seats.a.paid.early, 150);
  assert.equal(seats.a.list.early, 100);
  assert.equal(seats.a.purchases, 1);
  assert.equal(seats.a.asks, 2);
  assert.equal(seats.a.deals, 1);
  assert.equal(seats.b.deals, 1);
  assert.equal(seats.b.earlyDeals, 0);
});

test('politics: the street that completes a group is a completing purchase, and one the strongest rival wanted is a denying one', () => {
  let state = table();
  give(state, 'a', 'wang-yun', 'diaochan');
  give(state, 'c', 'lu-bu');
  const watch = createPoliticsWatch(ctx, ids, v1(4));
  state = step(state, watch, ask('a', 'c', 300, 'lu-bu'));
  state = step(state, watch, { type: 'ACCEPT_TRADE', player: 'c' });
  assert.equal(watch.finish(state).seats.a.paid.completing, 300);

  // Now `b` holds two of the group and wants the third; `d` buys it from `c`.
  let second = table();
  give(second, 'b', 'wang-yun', 'diaochan');
  give(second, 'c', 'lu-bu');
  const other = createPoliticsWatch(ctx, ids, v1(4));
  second = step(second, other, ask('d', 'c', 200, 'lu-bu'));
  second = step(second, other, { type: 'ACCEPT_TRADE', player: 'c' });
  const seen = other.finish(second).seats;
  assert.equal(seen.d.denyingDeals, 1);
  assert.equal(seen.d.paid.denying, 200);
  assert.equal(seen.d.earlyDeals, 0);
});

test('politics: a purchase from a seat that then goes bankrupt is an estate purchase, and the creditor is counted', () => {
  let state = table();
  give(state, 'c', 'yuan-shao', 'xu-you');
  const watch = createPoliticsWatch(ctx, ids, v1(4));
  state = step(state, watch, ask('a', 'c', 150, 'yuan-shao'));
  state = step(state, watch, { type: 'ACCEPT_TRADE', player: 'c' });
  // `c` then owes `b` more than everything it has.
  seatOf(state, 'c').cash = 0;
  state.properties['xu-you'].mortgaged = true;
  state.pending = [{ kind: 'debt', debtor: 'c', creditor: 'b', amount: 900, reason: 'rent' }];
  assert.ok(engine.legalActions(state, 'c').some((a) => a.type === 'DECLARE_BANKRUPTCY'));
  state = step(state, watch, { type: 'DECLARE_BANKRUPTCY', player: 'c' });
  const { seats, table: whole } = watch.finish(state);
  assert.equal(seats.a.estateValue, 140);
  assert.equal(seats.a.paid.estate, 150);
  assert.equal(seats.b.creditorOf, 1);
  assert.equal(whole.bankruptcies, 1);
  assert.equal(whole.bankruptValue, 140); // Xu You, which passed to the creditor
  assert.equal(whole.soldBeforeValue, 140); // Yuan Shao, sold before
});

test('politics: an offer to a debtor is counted as made at a debt, and a debt survived is counted for the debtor', () => {
  let state = table();
  give(state, 'c', 'yan-liang-wen-chou');
  seatOf(state, 'c').cash = 20;
  const watch = createPoliticsWatch(ctx, ids, v1(4));
  // The debt opens: the watch sees it on the first action after.
  state.pending = [{ kind: 'debt', debtor: 'c', creditor: 'b', amount: 300, reason: 'rent' }];
  state = step(state, watch, ask('a', 'c', 320, 'yan-liang-wen-chou'));
  state = step(state, watch, { type: 'ACCEPT_TRADE', player: 'c' });
  const { seats, table: whole } = watch.finish(state);
  assert.equal(seats.a.debtOffers, 1);
  assert.equal(seats.a.debtOffersAccepted, 1);
  assert.equal(whole.soldAtDebtValue, 160);
  assert.equal(seats.c.ownDebts, 1);
  assert.equal(seats.c.ownDebtsSurvived, 1);
});

test('named tables: whole games add up, and today\'s agent makes no early purchase', () => {
  for (const size of [2, 3, 4]) {
    const members = Array.from({ length: size }, () => 'baseline');
    const tally = emptyTally(size);
    for (let seed = 1; seed <= 6; seed++) playNamed(engine, members, seed, tally);
    assert.equal(tally.games, 6);
    assert.equal(tally.wins.reduce((a, b) => a + b, 0), tally.finished);
    assert.equal(tally.table.games, 6);
    assert.ok(tally.table.leader10Wins <= tally.table.leader10 && tally.table.leader10 <= tally.finished);
    assert.equal(tally.seats.reduce((sum, seat) => sum + seat.deals, 0) % 2, 0);
    for (const seat of tally.seats) {
      assert.equal(seat.games, 6);
      assert.equal(seat.earlyDeals, 0);
      assert.equal(seat.debtOffers, 0);
      assert.ok(seat.dealsWithFirst + (size > 2 ? seat.dealsWithLast : 0) <= seat.deals);
    }
    const lines = report(members, members, tally, [1, 6]);
    assert.ok(lines.some((line) => line.startsWith('| The seat ranked first at round 10 won')));
  }
});

test('named tables: a line of succession stands for its holder', () => {
  assert.equal(memberOf('baseline'), 'baseline');
  assert.match(memberOf('style-4'), /^found-4-/);
});

test('a member named with changes plays the preset with those fields set, and a bad change is refused', () => {
  const tally = emptyTally(4);
  playNamed(engine, ['balancer+againstLeader=2+forWeak=0.5', 'baseline', 'baseline', 'baseline'], 1, tally);
  assert.equal(tally.games, 1);
  assert.throws(() => playNamed(engine, ['balancer+noSuchField=1', 'baseline', 'baseline', 'baseline'], 1, emptyTally(4)), /No field noSuchField/);
  assert.throws(() => playNamed(engine, ['balancer+openShare=1.5+maxShare=0.5', 'baseline', 'baseline', 'baseline'], 1, emptyTally(4)), /maxShare/);
});
