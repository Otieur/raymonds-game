import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { GameEvent, GameState, PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent } from '../src/sim/league.ts';
import { acceptRate, createRelations, dealsBetween, goodwillOf, noteRelations, pairKey, recordAsk } from '../src/sim/relations.ts';
import type { Relations } from '../src/sim/relations.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import { v1 } from '../src/sim/valuation.ts';

const engine = createEngine(threeKingdoms);
const ctx = contextOf(engine);
const valuation = v1(4);
const side = (cash: number, ...properties: string[]) => ({ cash, properties, jailCards: 0 });

function table(): GameState {
  const state = engine.newGame({ players: ['a', 'b', 'c', 'd'], seed: 1, startingPlayer: 'a' });
  state.turn.number = 41;
  state.turn.phase = 'postRoll';
  for (const [owner, ids] of Object.entries({ a: ['wang-yun', 'diaochan'], c: ['lu-bu', 'cao-cao'], b: ['yuan-shao'], d: ['liu-bei'] })) {
    for (const id of ids) state.properties[id].owner = owner;
  }
  return state;
}

/** Proposes and answers one offer through the engine, feeding the record after each action. */
function offer(state: GameState, relations: Relations, from: PlayerId, to: PlayerId, give: ReturnType<typeof side>, receive: ReturnType<typeof side>, accept: boolean): GameState {
  const proposed = engine.apply(state, { type: 'PROPOSE_TRADE', player: from, to, give, receive });
  assert.ok(proposed.ok, proposed.ok ? '' : proposed.error.message);
  noteRelations(relations, proposed.state, proposed.events, ctx, valuation);
  const answered = engine.apply(proposed.state, { type: accept ? 'ACCEPT_TRADE' : 'REJECT_TRADE', player: to });
  assert.ok(answered.ok, answered.ok ? '' : answered.error.message);
  noteRelations(relations, answered.state, answered.events, ctx, valuation);
  return answered.state;
}

test('relations: deals, refusals and the rate of accepting are counted', () => {
  const relations = createRelations();
  let state = table();
  assert.equal(acceptRate(relations, 'c'), 0.5);
  state = offer(state, relations, 'a', 'c', side(100), side(0, 'lu-bu'), false);
  state = offer(state, relations, 'a', 'c', side(150), side(0, 'lu-bu'), false);
  assert.equal(relations.refusals.a.c, 2);
  assert.equal(acceptRate(relations, 'c'), 0.5); // fewer than three answers yet
  state = offer(state, relations, 'a', 'c', side(400), side(0, 'lu-bu'), true);
  assert.equal(dealsBetween(relations, 'c', 'a'), 1);
  assert.equal(relations.deals[pairKey('a', 'c')], 1);
  assert.equal(acceptRate(relations, 'c'), 1 / 3);
  assert.equal(state.properties['lu-bu'].owner, 'a');
});

test('relations: an ask keeps its count of refusals across repeats', () => {
  const relations = createRelations();
  let state = table();
  recordAsk(relations, 'a', 'lu-bu', { partner: 'c', share: 0.3, cash: 100, turn: 41, chance: 0.25, short: false });
  state = offer(state, relations, 'a', 'c', side(100), side(0, 'lu-bu'), false);
  recordAsk(relations, 'a', 'lu-bu', { partner: 'c', share: 0.45, cash: 150, turn: 53, chance: 0.25, short: false });
  offer(state, relations, 'a', 'c', side(150), side(0, 'lu-bu'), false);
  assert.equal(relations.asks.a['lu-bu'].refused, 2);
  assert.equal(relations.asks.a['lu-bu'].share, 0.45);
});

test('goodwill: an offer in the receiver\'s favour shows goodwill, a refused fair offer and a denying purchase take it away', () => {
  const relations = createRelations();
  relations.tracking = true;
  let state = table();
  const round = 10;
  // c lets a have the street that completes its group for one coin: all in a's favour.
  state = offer(state, relations, 'c', 'a', side(0, 'lu-bu'), side(1), true);
  const shown = goodwillOf(relations, 'a', 'c', round, 4);
  assert.ok(shown > 2, `c has shown a ${shown}`);
  assert.equal(goodwillOf(relations, 'c', 'a', round, 4), 0);
  // It halves in four rounds.
  assert.ok(Math.abs(goodwillOf(relations, 'a', 'c', round + 4, 4) - shown / 2) < 1e-9);

  // b refuses an offer that favoured it: that counts against b in d's eyes, and d's goodwill still counts by half.
  const second = createRelations();
  second.tracking = true;
  state = table();
  state = offer(state, second, 'd', 'b', side(600), side(0, 'yuan-shao'), false);
  assert.ok(goodwillOf(second, 'd', 'b', round, 4) <= -2);
  assert.ok(goodwillOf(second, 'b', 'd', round, 4) > 0);

  // b buys from c the street that a lacked: a holds it against b.
  state = offer(state, second, 'b', 'c', side(300), side(0, 'lu-bu'), true);
  assert.ok(goodwillOf(second, 'a', 'b', round, 4) <= -5);
});

test('goodwill: a favour taken and not returned within the waiting rounds counts against the taker, when the reader asks', () => {
  const relations = createRelations();
  relations.tracking = true;
  let state = table();
  const round = 10;
  // c lets a have the street that completes its group for one coin, and a accepts: a has taken a favour from c.
  state = offer(state, relations, 'c', 'a', side(0, 'lu-bu'), side(1), true);
  assert.equal(relations.taken.a.c.length, 1);
  const favour = relations.taken.a.c[0].points;
  assert.ok(favour > 0);
  // Read without the rule, a has shown c nothing either way.
  assert.equal(goodwillOf(relations, 'c', 'a', round + 4, 4), 0);
  // With it, nothing counts before the four rounds have passed, and the favour counts against a after.
  assert.equal(goodwillOf(relations, 'c', 'a', round + 3, 4, 1), 0);
  assert.ok(Math.abs(goodwillOf(relations, 'c', 'a', round + 4, 4, 1) + favour / 2) < 1e-9);
  // a returns it two rounds later with an offer in c's favour (refused, it still shows goodwill by half): the favour no longer counts against a.
  state.turn.number += 8;
  state = offer(state, relations, 'a', 'c', side(0, 'wang-yun'), side(1), false);
  assert.ok(goodwillOf(relations, 'c', 'a', round + 6, 4, 1) > 0);
});

test('relations: without tracking, only the counts are kept', () => {
  const relations = createRelations();
  const state = offer(table(), relations, 'c', 'a', side(0, 'lu-bu'), side(1), true);
  assert.equal(dealsBetween(relations, 'a', 'c'), 1);
  assert.deepEqual(relations.shown, {});
  assert.deepEqual(relations.chances, {});
  assert.equal(state.properties['lu-bu'].owner, 'a');
});

test('relations: over whole games the counts equal a tally of the events, and the chance log holds eight rounds', () => {
  for (const players of [3, 4]) {
    for (let seed = 1; seed <= 6; seed++) {
      const ids = Array.from({ length: players }, (_, i) => `p${i + 1}`);
      const holder = { rng: seedFrom(`relations-${players}-${seed}`) };
      const random = () => nextFloat(holder);
      const agents = new Map(ids.map((id) => [id, memberAgent('baseline')]));
      const relations = createRelations();
      relations.tracking = true;
      const log: GameEvent[] = [];
      let state = engine.newGame({ players: ids, seed });
      for (let actions = 0; state.winner === null && actions < 20000; actions++) {
        const waiting = engine.awaiting(state);
        const actor = waiting[Math.floor(random() * waiting.length)];
        const action = agents.get(actor)?.choose(engine, state, actor, random);
        assert.ok(action);
        const result = engine.apply(state, action);
        assert.ok(result.ok);
        state = result.state;
        log.push(...result.events);
        noteRelations(relations, state, result.events, ctx, v1(players));
        for (const agent of agents.values()) agent.observe(result.events, state);
      }
      const accepted = log.filter((e) => e.type === 'TRADE_ACCEPTED').length;
      const rejected = log.filter((e) => e.type === 'TRADE_REJECTED').length;
      assert.equal(Object.values(relations.deals).reduce((a, b) => a + b, 0), accepted);
      assert.equal(Object.values(relations.refusals).flatMap((by) => Object.values(by)).reduce((a, b) => a + b, 0), rejected);
      assert.equal(Object.values(relations.answers).reduce((sum, answer) => sum + answer.received, 0), accepted + rejected);
      assert.deepEqual(relations.open, {});
      for (const id of ids) assert.ok((relations.chances[id] ?? []).length <= 8 && (relations.chances[id] ?? []).length > 0);
    }
  }
});
