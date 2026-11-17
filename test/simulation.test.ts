import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine, simulateGame } from '../src/index.ts';
import { fixture } from './fixture.ts';

const engine = createEngine(fixture);

test('random games of every table size stay consistent from start to finish', () => {
  let finished = 0;
  let played = 0;
  for (const players of [2, 3, 4, 6, 8]) {
    for (let seed = 1; seed <= 6; seed++) {
      const result = simulateGame(engine, { players, seed: players * 1000 + seed, maxActions: 12000 });
      played += 1;
      if (result.finished) {
        finished += 1;
        assert.equal(result.state.players.filter((p) => !p.bankrupt).length, 1);
      }
    }
  }
  assert.ok(finished >= played / 2);
});

test('random play reaches the rare corners of the rules', () => {
  const seen: Record<string, number> = {};
  for (let seed = 1; seed <= 12; seed++) {
    const result = simulateGame(engine, { players: 4, seed, maxActions: 12000 });
    for (const [type, count] of Object.entries(result.eventCounts)) {
      seen[type] = (seen[type] ?? 0) + count;
    }
  }
  for (const type of [
    'AUCTION_ENDED',
    'BUILDING_AUCTION_STARTED',
    'BUILDINGS_SOLD',
    'DEBT_INCURRED',
    'TRADE_ACCEPTED',
    'MORTGAGE_KEPT',
    'BANKRUPT',
    'GAME_OVER',
  ]) {
    assert.ok((seen[type] ?? 0) > 0, type);
  }
});

test('a simulated game replays identically from its seed', () => {
  const first = simulateGame(engine, { players: 4, seed: 77, maxActions: 3000 });
  const second = simulateGame(engine, { players: 4, seed: 77, maxActions: 3000 });
  assert.deepEqual(first.state, second.state);
  assert.equal(first.actions, second.actions);
});
