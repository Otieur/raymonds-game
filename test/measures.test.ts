import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContext } from '../src/context.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { GameState, PlayerState } from '../src/index.ts';
import { MEASURES, viewOf } from '../src/sim/measures.ts';

const engine = createEngine(threeKingdoms);
const ctx = buildContext(engine.board, engine.rules);

/**
 * a: 500 coins at LuoYang. Han Court whole, both streets at two farmsteads; two passes; Wang Yun.
 * b: 300 coins. Diaochan and Lü Bu, so it lacks only Wang Yun; Yuan Shao, mortgaged.
 * c: 100 coins, in jail, nothing owned.
 */
function position(): GameState {
  const state = engine.newGame({ players: ['a', 'b', 'c'], seed: 1 });
  const set = (id: string, owner: string, level = 0, mortgaged = false) => {
    state.properties[id] = { owner, level, mortgaged };
  };
  set('dong-zhuo', 'a', 2);
  set('emperor-xian', 'a', 2);
  set('hulao-pass', 'a');
  set('guandu-ford', 'a');
  set('wang-yun', 'a');
  set('diaochan', 'b');
  set('lu-bu', 'b');
  set('yuan-shao', 'b', 0, true);
  const [a, b, c] = state.players;
  Object.assign(a, { cash: 500, position: 0 });
  Object.assign(b, { cash: 300, position: 15 });
  Object.assign(c, { cash: 100, position: 10, inJail: true });
  return state;
}

function measured(state: GameState, player: PlayerState): Record<string, number> {
  const view = viewOf(ctx, state);
  return Object.fromEntries(MEASURES.map((m) => [m.key, m.value(view, player)]));
}

test('there are twenty measures with distinct keys', () => {
  assert.equal(MEASURES.length, 20);
  assert.equal(new Set(MEASURES.map((m) => m.key)).size, 20);
});

test('each measure of a player with a built group, two passes and a blocking street', () => {
  const state = position();
  const m = measured(state, state.players[0]);
  // Poll Tax (200) is the worst square within one roll of LuoYang.
  const expectedDues = (200 * 3 + 6 * 5 + 8 * 4) / 36;
  const expected: Record<string, number> = {
    netWorth: 500 + 620 + 200,
    cash: 500,
    spare: 300,
    disposable: 300 + 100 + 100 + 50,
    liquid: 500 + 80 + 80 + 100 + 100 + 50,
    exposure: expectedDues,
    rentRoll: 30 + 60 + 50 + 50 + 6,
    // 500 coins buy six buildings on Han Court, best gain first: 120, 60, 140, 70, 130, 90.
    reachGain: 610,
    reachRoll: 196 + 610,
    room: 0,
    ceilingRoll: 250 + 450 + 50 + 50 + 6,
    sets: 1,
    nearSets: 0,
    needs: 0,
    wanted: 1,
    chips: 100,
    passes: 2,
    properties: 5,
    buildings: 200,
    mortgaged: 0,
  };
  for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(m[key] - value) < 1e-9, `${key}: ${m[key]} != ${value}`);
});

test('a player one street short of a group, with a mortgage', () => {
  const state = position();
  const m = measured(state, state.players[1]);
  assert.equal(m.nearSets, 1);
  assert.equal(m.needs, 1);
  assert.equal(m.wanted, 0);
  assert.equal(m.mortgaged, 140);
  assert.equal(m.netWorth, 300 + 100 + 120 + 70);
  // Its chips: Diaochan and Lü Bu are half wanted, since a rival holds one of the group.
  assert.equal(m.chips, 0.5 * 100 + 0.5 * 120);
});

test('a player with nothing, in jail, has finite measures and no holdings', () => {
  const state = position();
  const m = measured(state, state.players[2]);
  for (const [key, value] of Object.entries(m)) assert.ok(Number.isFinite(value), key);
  for (const key of ['rentRoll', 'reachGain', 'sets', 'chips', 'passes', 'properties', 'buildings', 'mortgaged']) assert.equal(m[key], 0, key);
  assert.equal(m.netWorth, 100);
});

test('everything mortgaged leaves no rent and no idle mortgages to raise', () => {
  const state = position();
  for (const id of ['dong-zhuo', 'emperor-xian']) state.properties[id].level = 0;
  for (const id of ['dong-zhuo', 'emperor-xian', 'hulao-pass', 'guandu-ford', 'wang-yun']) state.properties[id].mortgaged = true;
  const m = measured(state, state.players[0]);
  assert.equal(m.rentRoll, 0);
  assert.equal(m.reachGain, 0);
  assert.equal(m.disposable, m.spare);
  assert.equal(m.mortgaged, 620);
});
