import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameState, PropertyId } from '../src/index.ts';
import {
  board,
  build,
  economy,
  engine,
  giveJailCard,
  indexOf,
  landOn,
  newGame,
  own,
  play,
  playWithEvents,
  property,
  rejects,
  street,
  who,
} from './helpers.ts';

const start = economy.startingCash;
const baseRent = street('g1-2').rents[0];

function interestOn(id: PropertyId): number {
  return Math.ceil((property(id).mortgageValue * engine.rules.mortgageInterestPercent) / 100);
}

test('a debt the player can cover must be paid by raising cash', () => {
  const state = newGame();
  own(state, 'b', 'g1-2');
  own(state, 'a', 't1');
  who(state, 'a').cash = baseRent - 1;
  const owing = landOn(state, 'a', 'g1-2');
  assert.deepEqual(owing.pending, [{ kind: 'debt', debtor: 'a', creditor: 'b', amount: baseRent, reason: 'rent' }]);
  assert.equal(who(owing, 'a').cash, baseRent - 1);
  rejects(owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' }, 'CAN_STILL_PAY');
  rejects(owing, { type: 'END_TURN', player: 'a' }, 'DECISION_PENDING');

  const settled = play(owing, { type: 'MORTGAGE', player: 'a', property: 't1' });
  assert.deepEqual(settled.pending, []);
  assert.equal(who(settled, 'a').cash, baseRent - 1 + property('t1').mortgageValue - baseRent);
  assert.equal(who(settled, 'b').cash, start + baseRent);
});

test('only a player with a debt on the table can declare bankruptcy', () => {
  const state = newGame();
  rejects(state, { type: 'DECLARE_BANKRUPTCY', player: 'a' }, 'WRONG_PHASE');
});

function ruined(): GameState {
  const state = newGame();
  own(state, 'b', 'g5-1', 'g5-2', 'g5-3');
  own(state, 'a', 'g1-1', 'g1-2', 't2');
  build(state, { 'g5-1': 1, 'g5-2': 1, 'g5-3': 1, 'g1-1': 1, 'g1-2': 1 });
  state.properties.t2.mortgaged = true;
  giveJailCard(state, 'a', 'q', 'q-free');
  who(state, 'a').cash = 5;
  return landOn(state, 'a', 'g5-3');
}

test('bankruptcy to a player hands over everything, with buildings cashed in at half', () => {
  const owing = ruined();
  const rent = street('g5-3').rents[1];
  assert.deepEqual(owing.pending, [{ kind: 'debt', debtor: 'a', creditor: 'b', amount: rent, reason: 'rent' }]);

  const { state, events } = playWithEvents(owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  const refund = 2 * (street('g1-1').buildingCost / 2);
  const interest = interestOn('t2');

  assert.equal(who(state, 'a').bankrupt, true);
  assert.equal(who(state, 'a').cash, 0);
  assert.equal(who(state, 'b').cash, start + 5 + refund - interest);
  for (const id of ['g1-1', 'g1-2', 't2']) {
    assert.equal(state.properties[id].owner, 'b');
    assert.equal(state.properties[id].level, 0);
  }
  assert.equal(state.properties.t2.mortgaged, true);
  assert.equal(state.bank.houses, economy.houses - 3);
  assert.deepEqual(who(state, 'b').jailCards, [{ deck: 'q', card: 'q-free' }]);
  assert.ok(events.some((e) => e.type === 'BANKRUPT' && e.player === 'a' && e.creditor === 'b'));

  assert.deepEqual(state.pending, [{ kind: 'mortgageTransfer', player: 'b', property: 't2' }]);
  assert.equal(state.turn.player, 'b');
  rejects(state, { type: 'ROLL', player: 'b' }, 'DECISION_PENDING');

  const lifted = play(state, { type: 'SETTLE_TRANSFER', player: 'b', lift: true });
  assert.equal(lifted.properties.t2.mortgaged, false);
  assert.equal(who(lifted, 'b').cash, start + 5 + refund - interest - property('t2').mortgageValue);
  play(lifted, { type: 'ROLL', player: 'b' });
});

test('a bankrupt player takes no further part', () => {
  const state = play(ruined(), { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  rejects(state, { type: 'ROLL', player: 'a' }, 'PLAYER_BANKRUPT');
  assert.deepEqual(engine.legalActions(state, 'a'), []);
});

test('bankruptcy to the bank auctions the estate, free of mortgages', () => {
  const state = newGame();
  own(state, 'a', 'g1-2', 'u1');
  state.properties['g1-2'].mortgaged = true;
  giveJailCard(state, 'a', 'p', 'p-free');
  who(state, 'a').cash = 10;
  const tax = board.squares[indexOf('tax')];
  assert.equal(tax.kind, 'tax');
  if (tax.kind !== 'tax') return;

  const owing = landOn(state, 'a', 'tax');
  assert.deepEqual(owing.pending, [{ kind: 'debt', debtor: 'a', creditor: null, amount: tax.amount, reason: 'tax' }]);

  const gone = play(owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  assert.equal(who(gone, 'a').bankrupt, true);
  assert.equal(gone.decks.p.at(-1), 'p-free');
  assert.equal(gone.properties['g1-2'].mortgaged, false);
  assert.equal(gone.properties['g1-2'].owner, null);
  assert.equal(gone.turn.player, 'b');

  assert.ok(indexOf('g1-2') < indexOf('u1'));
  assert.deepEqual(gone.pending, [
    { kind: 'auction', property: 'g1-2', bidders: ['b', 'c'], highBid: 0, highBidder: null },
  ]);
  assert.deepEqual(gone.auctionQueue, ['u1']);
  rejects(gone, { type: 'ROLL', player: 'b' }, 'DECISION_PENDING');

  const first = play(gone, { type: 'BID', player: 'c', amount: 1 }, { type: 'PASS', player: 'b' });
  assert.equal(first.properties['g1-2'].owner, 'c');
  assert.equal(who(first, 'c').cash, start - 1);
  assert.equal(first.pending[0].kind, 'auction');
  assert.deepEqual(first.auctionQueue, []);

  const second = play(first, { type: 'PASS', player: 'b' }, { type: 'PASS', player: 'c' });
  assert.equal(second.properties.u1.owner, null);
  assert.deepEqual(second.pending, []);
  play(second, { type: 'ROLL', player: 'b' });
});

test('the last player standing wins, and the game then accepts nothing more', () => {
  const state = newGame(['a', 'b']);
  own(state, 'b', 'g5-1', 'g5-2', 'g5-3');
  build(state, { 'g5-1': 5, 'g5-2': 5, 'g5-3': 5 });
  who(state, 'a').cash = 100;
  const owing = landOn(state, 'a', 'g5-3');

  const { state: over, events } = playWithEvents(owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  assert.equal(over.winner, 'b');
  assert.deepEqual(over.pending, []);
  assert.equal(who(over, 'b').cash, start + 100);
  assert.ok(events.some((e) => e.type === 'GAME_OVER' && e.winner === 'b'));
  assert.deepEqual(engine.awaiting(over), []);
  assert.deepEqual(engine.legalActions(over, 'b'), []);
  rejects(over, { type: 'ROLL', player: 'b' }, 'GAME_OVER');
});

test('a player in debt may trade their way out', () => {
  const state = newGame();
  own(state, 'b', 'g1-2');
  giveJailCard(state, 'a', 'p', 'p-free');
  who(state, 'a').cash = 0;
  const owing = landOn(state, 'a', 'g1-2');
  assert.equal(owing.pending[0].kind, 'debt');

  const nothing = { cash: 0, properties: [], jailCards: 0 };
  rejects(
    owing,
    { type: 'PROPOSE_TRADE', player: 'b', to: 'c', give: { ...nothing, cash: 5 }, receive: { ...nothing, cash: 1 } },
    'DECISION_PENDING',
  );

  const saved = play(
    owing,
    {
      type: 'PROPOSE_TRADE',
      player: 'a',
      to: 'c',
      give: { ...nothing, jailCards: 1 },
      receive: { ...nothing, cash: baseRent + 4 },
    },
    { type: 'ACCEPT_TRADE', player: 'c' },
  );
  assert.deepEqual(saved.pending, []);
  assert.equal(who(saved, 'a').cash, 4);
  assert.equal(who(saved, 'a').bankrupt, false);
  assert.equal(who(saved, 'b').cash, start + baseRent);
});

test('an heir who cannot pay the interest on inherited mortgages owes the bank', () => {
  const state = newGame();
  own(state, 'b', 'g1-2');
  own(state, 'a', 't1');
  state.properties.t1.mortgaged = true;
  who(state, 'a').cash = 0;
  who(state, 'b').cash = 0;
  const owing = landOn(state, 'a', 'g1-2');
  const interest = interestOn('t1');

  const gone = play(owing, { type: 'DECLARE_BANKRUPTCY', player: 'a' });
  assert.equal(gone.properties.t1.owner, 'b');
  assert.deepEqual(gone.pending.at(-1), {
    kind: 'debt',
    debtor: 'b',
    creditor: null,
    amount: interest,
    reason: 'interest',
  });

  const raised = play(gone, { type: 'MORTGAGE', player: 'b', property: 'g1-2' });
  assert.deepEqual(raised.pending, [{ kind: 'mortgageTransfer', player: 'b', property: 't1' }]);
  assert.equal(who(raised, 'b').cash, property('g1-2').mortgageValue - interest);
  const kept = play(raised, { type: 'SETTLE_TRANSFER', player: 'b', lift: false });
  assert.deepEqual(kept.pending, []);
});
