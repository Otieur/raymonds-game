import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContext } from '../src/context.ts';
import { chooseHeuristicAction, createAgentMemory, createEngine, threeKingdoms } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { MEASURES, viewOf } from '../src/sim/measures.ts';
import { seatIds, snapshotOf, stateOf } from '../src/sim/snapshot.ts';
import type { SnapshotRow } from '../src/sim/snapshot.ts';

const engine = createEngine(threeKingdoms);
const ctx = buildContext(engine.board, engine.rules);
const GAMES = Number(process.env.SNAPSHOT_CHECK_GAMES ?? 8);

test('every measure computed from a rebuilt state equals the measure in the live game', () => {
  let compared = 0;
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= GAMES; seed++) {
      const holder = { rng: seedFrom(`snapshot-test-${n}-${seed}`) };
      const random = () => nextFloat(holder);
      const memory = createAgentMemory();
      let state = engine.newGame({ players: seatIds(n), seed });
      for (let actions = 0; state.winner === null && actions < 40000; actions++) {
        const waiting = engine.awaiting(state);
        const actor = waiting[Math.floor(random() * waiting.length)];
        const action = chooseHeuristicAction(engine, state, actor, random, memory);
        assert.ok(action);
        const result = engine.apply(state, action);
        assert.ok(result.ok);
        state = result.state;
        for (const event of result.events) {
          if (event.type !== 'TURN_STARTED' || (event.turn - 1) % n !== 0) continue;
          const round = (event.turn - 1) / n;
          if (round === 0 || round % 5 !== 0) continue;
          const gone = state.players.map((p) => (p.bankrupt ? 1 : 0));
          const row: SnapshotRow = { ...snapshotOf(ctx, state, { table: `full-${n}`, seed, round, n }), win: 0, gone, turns: 0 };
          const rebuilt = stateOf(ctx, row);
          assert.deepEqual(engine.checkInvariants(rebuilt), [], `seed ${seed}, round ${round}`);
          const live = viewOf(ctx, state);
          const copy = viewOf(ctx, rebuilt);
          state.players.forEach((player, i) => {
            for (const measure of MEASURES) {
              const a = measure.value(live, player);
              const b = measure.value(copy, rebuilt.players[i]);
              assert.ok(Math.abs(a - b) < 1e-9, `${n} players, seed ${seed}, round ${round}, seat ${i}, ${measure.key}: ${a} != ${b}`);
            }
          });
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 0);
});

test('a rebuilt state can be played on to the end', () => {
  const holder = { rng: seedFrom('playout') };
  const random = () => nextFloat(holder);
  const row: SnapshotRow = {
    v: 1, table: 'full-3', seed: 5, round: 10, n: 3, turn: 1,
    cash: [400, 900, 250], pos: [3, 18, 30], jail: [0, 0, 0],
    own: '00.111..2.2................', lvl: '0000000000000000000000000000', mort: '0000000000000000000000000000',
    bank: [32, 12], win: 0, gone: [0, 0, 0], turns: 0,
  };
  row.own = row.own.padEnd(ctx.propertyOrder.length, '.');
  let state = stateOf(ctx, row, 'fresh draw 1');
  assert.deepEqual(engine.checkInvariants(state), []);
  const memory = createAgentMemory();
  for (let actions = 0; state.winner === null && actions < 40000; actions++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const result = engine.apply(state, chooseHeuristicAction(engine, state, actor, random, memory) ?? { type: 'END_TURN', player: actor });
    assert.ok(result.ok);
    state = result.state;
  }
  assert.notEqual(state.winner, null);
});
