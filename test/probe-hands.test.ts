import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidatesOf, report, summarize } from '../scripts/probe-hands.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { GameState, PlayerId } from '../src/index.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import { v1 } from '../src/sim/valuation.ts';

const engine = createEngine(threeKingdoms);
const ctx = contextOf(engine);

function table(): GameState {
  const state = engine.newGame({ players: ['a', 'b', 'c', 'd'], seed: 1, startingPlayer: 'a' });
  state.turn.number = 41;
  return state;
}
const give = (state: GameState, owner: PlayerId, ...ids: string[]) => {
  for (const id of ids) state.properties[id].owner = owner;
};
const cells = (state: GameState) => candidatesOf(ctx, state, 10, v1(4)).map((c) => `${c.cell}:${c.deal.from}>${c.deal.to}`);

test('the probe of deals: a second street is found at three prices, from either holder, with the third street in the bank', () => {
  const state = table();
  give(state, 'a', 'wang-yun');
  give(state, 'b', 'diaochan');
  const found = cells(state);
  for (const multiple of [1, 1.5, 2]) {
    assert.ok(found.includes(`4|second|chain|10|${multiple}|bank:a>b`));
    assert.ok(found.includes(`4|second|chain|10|${multiple}|bank:b>a`));
  }
  assert.equal(found.length, 6);
  // With the third street in a third seat's hands the cell says so.
  give(state, 'c', 'lu-bu');
  assert.ok(cells(state).includes('4|second|chain|10|1|third:a>b'));
  // Every deal is one the engine accepts.
  state.turn.phase = 'postRoll';
  for (const c of candidatesOf(ctx, state, 10, v1(4))) {
    assert.equal(engine.validate(state, { type: 'PROPOSE_TRADE', player: c.deal.from, to: c.deal.to, give: c.deal.give, receive: c.deal.receive }), null);
  }
});

test('the probe of deals: a denying purchase is filed by the buyer\'s rank among the rival\'s opponents', () => {
  const state = table();
  give(state, 'b', 'cao-cao', 'cao-pi');
  give(state, 'c', 'xun-yu');
  give(state, 'a', 'liu-bei', 'guan-yu', 'zhuge-liang');
  const found = cells(state).filter((c) => c.includes('|denial|'));
  // `a`, with a whole group, is the nearest of `b`'s opponents; `d` is not the seller and ranks below it.
  assert.ok(found.includes('4|denial|wei|10|1|nearest:a>c'));
  assert.ok(found.some((c) => c.endsWith(':d>c') && !c.includes('nearest')));
  assert.ok(!found.some((c) => c.endsWith('>b')));
});

test('the probe of deals: a failing seat\'s street is found for a buyer that holds part of its group', () => {
  const state = table();
  give(state, 'b', 'wang-yun', 'diaochan', 'lu-bu');
  for (const id of ['wang-yun', 'diaochan', 'lu-bu']) state.properties[id].level = 3;
  give(state, 'c', 'cao-cao');
  give(state, 'a', 'cao-pi');
  (state.players[2] as { cash: number }).cash = 20;
  assert.ok(cells(state).includes('4|estate|self|10:a>c'));
});

test('the probe of deals: the summary counts where the deal sheet has the sign right', () => {
  const outcome = (cell: string, without: number, withDeal: number, predicted: number) => ({
    cell,
    playouts: 8,
    unfinished: 0,
    without: [without, 2, 2] as [number, number, number],
    withDeal: [withDeal, 2, 2] as [number, number, number],
    predicted: [predicted, 0, 0] as [number, number, number],
  });
  const outcomes = [
    ...Array.from({ length: 30 }, () => outcome('4|second|wei|10|1|bank', 2, 5, 0.2)),
    ...Array.from({ length: 30 }, () => outcome('4|denial|wei|10|2|last', 2, 1, 0.05)),
    ...Array.from({ length: 5 }, () => outcome('4|estate|self|10', 2, 2, 0)),
  ];
  const summaries = summarize(outcomes);
  assert.equal(summaries.length, 3);
  const second = summaries.find((s) => s.cell.includes('second'));
  assert.ok(second && Math.abs(second.measured[0] - 3 / 8) < 1e-9);
  const lines = report(summaries, 30);
  assert.match(lines[0], /2 have a measured change for the buyer whose interval excludes zero; the deal sheet has the same sign in 1/);
  assert.ok(lines.some((line) => line.includes('(thin)')));
});
