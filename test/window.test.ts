import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playTable } from '../scripts/league.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { Action, GameState, PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent, playbookAgent } from '../src/sim/league.ts';
import { styleFrom } from '../src/sim/style.ts';
import type { Style } from '../src/sim/style.ts';
import { chooseStyledAction, createStyleMemory } from '../src/sim/style-agent.ts';
import type { SeatAgent } from '../src/sim/styles.ts';
import { createDebtWindows, debtWindow } from '../src/sim/window.ts';

const engine = createEngine(threeKingdoms);
const noDraw = () => {
  throw new Error('A random number was drawn.');
};
const seatOf = (state: GameState, id: PlayerId) => state.players.find((p) => p.id === id) as GameState['players'][number];
const give = (state: GameState, owner: PlayerId, ...ids: string[]) => {
  for (const id of ids) state.properties[id].owner = owner;
};
const styled = (changes: Partial<Style>): SeatAgent => playbookAgent({ name: 'test', base: styleFrom('test', changes), rules: [] });

/** `c` owes `b` 300 and holds 20 coins and one street, which would complete `a`'s group. */
function debt(): GameState {
  const state = engine.newGame({ players: ['a', 'b', 'c', 'd'], seed: 1, startingPlayer: 'a' });
  state.turn.number = 41;
  state.turn.phase = 'postRoll';
  give(state, 'a', 'yuan-shao', 'xu-you');
  give(state, 'c', 'yan-liang-wen-chou');
  seatOf(state, 'c').cash = 20;
  state.pending = [{ kind: 'debt', debtor: 'c', creditor: 'b', amount: 300, reason: 'rent' }];
  return state;
}

test('the rules: while a debt is open, another seat may offer the debtor a deal, and the debtor answers it', () => {
  const state = debt();
  assert.deepEqual(engine.awaiting(state), ['c']);
  const offer: Action = { type: 'PROPOSE_TRADE', player: 'a', to: 'c', give: { cash: 320, properties: [], jailCards: 0 }, receive: { cash: 0, properties: ['yan-liang-wen-chou'], jailCards: 0 } };
  const proposed = engine.apply(state, offer);
  assert.ok(proposed.ok, proposed.ok ? '' : proposed.error.message);
  assert.deepEqual(engine.awaiting(proposed.state), ['c']);
  const accepted = engine.apply(proposed.state, { type: 'ACCEPT_TRADE', player: 'c' });
  assert.ok(accepted.ok);
  assert.equal(accepted.state.properties['yan-liang-wen-chou'].owner, 'a');
  assert.equal(seatOf(accepted.state, 'c').bankrupt, false);
  // The sale covered the debt, so the creditor is paid and the estate does not pass to it.
  assert.ok(!accepted.state.pending.some((p) => p.kind === 'debt'));
  assert.equal(seatOf(accepted.state, 'b').cash, 1500 + 300);
});

test('the debt window: a seat that offers at a debt is asked before the debtor acts, once, and the creditor never', () => {
  const state = debt();
  const agents = new Map<PlayerId, SeatAgent>([
    ['a', styled({ offerBy: 'value', debtOffers: true })],
    ['b', styled({ offerBy: 'value', debtOffers: true })],
    ['c', memberAgent('baseline')],
    ['d', memberAgent('baseline')],
  ]);
  const windows = createDebtWindows();
  const first = debtWindow(engine, state, (id) => agents.get(id), noDraw, windows);
  assert.ok(first);
  assert.equal(first.actor, 'a');
  assert.equal(first.action.type, 'PROPOSE_TRADE');
  const offer = first.action as Extract<Action, { type: 'PROPOSE_TRADE' }>;
  assert.equal(offer.to, 'c');
  assert.deepEqual(offer.receive.properties, ['yan-liang-wen-chou']);
  assert.ok(offer.give.cash >= 160, `never under list price: ${offer.give.cash}`);
  assert.equal(engine.validate(state, offer), null);
  // Everyone has now been asked at this debt.
  assert.equal(debtWindow(engine, state, (id) => agents.get(id), noDraw, windows), null);
  // The creditor is left out even when it is the only seat that would offer.
  agents.set('a', memberAgent('baseline'));
  assert.equal(debtWindow(engine, state, (id) => agents.get(id), noDraw, createDebtWindows()), null);
});

test('the debt window: nothing happens when the debtor can pay, or when no seat offers at a debt', () => {
  const state = debt();
  const baselines = new Map<PlayerId, SeatAgent>(['a', 'b', 'c', 'd'].map((id) => [id, memberAgent('baseline')]));
  assert.equal(debtWindow(engine, state, (id) => baselines.get(id), noDraw, createDebtWindows()), null);
  seatOf(state, 'c').cash = 400;
  const keen = new Map<PlayerId, SeatAgent>([['a', styled({ offerBy: 'value', debtOffers: true })]]);
  assert.equal(debtWindow(engine, state, (id) => keen.get(id), noDraw, createDebtWindows()), null);
});

test('the debt window: games among today\'s agent are the same with it as without it', () => {
  for (const players of [2, 3, 4]) {
    for (let seed = 1; seed <= 8; seed++) {
      const members = Array.from({ length: players }, () => 'baseline');
      const withWindow = playTable(engine, members, seed, 'window-test');
      // The same game, driven without the window.
      const holder = { rng: seedFrom(`window-test-${players}-${seed}`) };
      const random = () => nextFloat(holder);
      const ids = members.map((_, i) => `p${i + 1}`);
      const agents = new Map(ids.map((id) => [id, memberAgent('baseline')]));
      let state = engine.newGame({ players: ids, seed });
      for (let actions = 0; state.winner === null && actions < 20000; actions++) {
        const waiting = engine.awaiting(state);
        const actor = waiting[Math.floor(random() * waiting.length)];
        const result = engine.apply(state, agents.get(actor)?.choose(engine, state, actor, random) as Action);
        assert.ok(result.ok);
        state = result.state;
        for (const agent of agents.values()) agent.observe(result.events, state);
      }
      assert.equal(withWindow.turns, state.turn.number);
      assert.equal(withWindow.winner, state.winner === null ? -1 : ids.indexOf(state.winner));
    }
  }
});

test('debtSales: a debtor that mortgages could not save sells to a seat other than its creditor, and stays in', () => {
  const state = debt();
  // Today's agent mortgages what it has, which does not cover the debt.
  const usual = chooseStyledAction(engine, state, 'c', noDraw, styleFrom('test', {}), createStyleMemory());
  assert.notEqual(usual?.type, 'PROPOSE_TRADE');
  const memory = createStyleMemory();
  const sale = chooseStyledAction(engine, state, 'c', noDraw, styleFrom('test', { debtSales: true }), memory) as Extract<Action, { type: 'PROPOSE_TRADE' }>;
  assert.equal(sale.type, 'PROPOSE_TRADE');
  assert.equal(sale.to, 'a'); // the seat it completes a group for; never the creditor
  assert.deepEqual(sale.give.properties, ['yan-liang-wen-chou']);
  assert.equal(sale.receive.cash, 280); // what it lacks, which is above the list price of 160
  const proposed = engine.apply(state, sale);
  assert.ok(proposed.ok, proposed.ok ? '' : proposed.error.message);
  const accepted = engine.apply(proposed.state, { type: 'ACCEPT_TRADE', player: 'a' });
  assert.ok(accepted.ok);
  assert.equal(seatOf(accepted.state, 'c').bankrupt, false);
  assert.ok(!accepted.state.pending.some((p) => p.kind === 'debt'));
  // It tries once a debt: refused, it raises funds as today.
  const again = chooseStyledAction(engine, state, 'c', noDraw, styleFrom('test', { debtSales: true }), memory);
  assert.notEqual(again?.type, 'PROPOSE_TRADE');
});
