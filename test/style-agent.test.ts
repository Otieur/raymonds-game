import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareWithBaseline, playPreset } from '../scripts/check-style.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { Action, GameState, PlayerId } from '../src/index.ts';
import { blend, compose, META_FIELDS, PARTS } from '../src/sim/parts.ts';
import { resolvePlaybook } from '../src/sim/playbook.ts';
import type { Playbook } from '../src/sim/playbook.ts';
import { signalsOf, SIGNAL_NAMES } from '../src/sim/signals.ts';
import { BASELINE, SETS, styleFrom, validateStyle } from '../src/sim/style.ts';
import type { Style } from '../src/sim/style.ts';
import { chooseStyledAction, createStyleMemory, moodOf, observe } from '../src/sim/style-agent.ts';
import { PRESETS, school } from '../src/sim/styles.ts';

const engine = createEngine(threeKingdoms);
const never = () => 0;

/** A game with three players, past the opening roll, with `a` to move. */
function table(): GameState {
  return engine.newGame({ players: ['a', 'b', 'c'], seed: 1, startingPlayer: 'a' });
}
function give(state: GameState, owner: PlayerId | null, ...ids: string[]): void {
  for (const id of ids) state.properties[id].owner = owner;
}
const cash = (state: GameState, id: PlayerId, amount: number) => {
  (state.players.find((p) => p.id === id) as { cash: number }).cash = amount;
};
const act = (state: GameState, style: Partial<Style>, actor: PlayerId = 'a') =>
  chooseStyledAction(engine, state, actor, never, styleFrom('test', style), createStyleMemory());
const buyDecision = (state: GameState, property: string, player: PlayerId = 'a') => {
  state.turn.phase = 'postRoll';
  state.pending = [{ kind: 'buy', player, property }];
};

test('the baseline style makes the same decisions as the rule-based agent', () => {
  for (const players of [2, 3, 4]) {
    for (let seed = 1; seed <= 3; seed++) assert.equal(compareWithBaseline(engine, players, seed).difference, null);
  }
});

test('the default style validates, and a value out of range is named', () => {
  assert.deepEqual(validateStyle(BASELINE), []);
  const problems = validateStyle({ ...BASELINE, reserve: -5 });
  assert.ok(problems.some((p) => p.startsWith('reserve')));
});

test('buy: a seat with buy.works at 0 declines a works it could afford', () => {
  const state = table();
  buyDecision(state, 'ironworks');
  assert.equal(act(state, {})?.type, 'BUY');
  assert.equal(act(state, { buy: { ...BASELINE.buy, works: 0 } })?.type, 'DECLINE');
});

test('bidCeiling: bids up to its ceiling and no further', () => {
  const state = table();
  state.turn.phase = 'postRoll';
  const style = { bidCap: Object.fromEntries(SETS.map((s) => [s, 3])) as Style['bidCap'], bidCeiling: { passes: 450 } };
  state.pending = [{ kind: 'auction', property: 'hulao-pass', bidders: ['a', 'b'], highBid: 449, highBidder: 'b' }];
  assert.deepEqual(act(state, style), { type: 'BID', player: 'a', amount: 450 });
  state.pending = [{ kind: 'auction', property: 'hulao-pass', bidders: ['a', 'b'], highBid: 450, highBidder: 'b' }];
  assert.equal(act(state, style)?.type, 'PASS');
});

test('buildTarget: a group at the target waits while another group is below it', () => {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'dong-zhuo', 'emperor-xian', 'wang-yun', 'diaochan', 'lu-bu');
  for (const id of ['dong-zhuo', 'emperor-xian']) state.properties[id].level = 3;
  for (const id of ['wang-yun', 'diaochan', 'lu-bu']) state.properties[id].level = 1;
  state.bank.houses -= 9;
  cash(state, 'a', 2000);
  const action = act(state, { buildTarget: 3 }) as Extract<Action, { type: 'BUILD' }>;
  assert.equal(action.type, 'BUILD');
  assert.ok(['wang-yun', 'diaochan', 'lu-bu'].includes(action.property));
});

test('holdHouses: no fortress while the bank is short of farmsteads', () => {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'dong-zhuo', 'emperor-xian');
  for (const id of ['dong-zhuo', 'emperor-xian']) state.properties[id].level = 4;
  state.bank.houses = 5;
  cash(state, 'a', 2000);
  assert.equal(act(state, {})?.type, 'BUILD');
  assert.notEqual(act(state, { holdHouses: true })?.type, 'BUILD');
});

test('neverSell: refuses any price for a pass', () => {
  const state = table();
  give(state, 'a', 'hulao-pass');
  state.pending = [
    { kind: 'trade', offer: { from: 'b', to: 'a', give: { cash: 1400, properties: [], jailCards: 0 }, receive: { cash: 0, properties: ['hulao-pass'], jailCards: 0 } } },
  ];
  assert.equal(act(state, {})?.type, 'ACCEPT_TRADE');
  assert.equal(act(state, { neverSell: ['passes'] })?.type, 'REJECT_TRADE');
});

test('the mood of the table flips after enough refusals and flips back', () => {
  const memory = createStyleMemory();
  const offer = { from: 'a', to: 'b', give: { cash: 1, properties: [], jailCards: 0 }, receive: { cash: 0, properties: [], jailCards: 0 } };
  assert.equal(moodOf(memory, 4), null);
  for (let i = 0; i < 4; i++) observe(memory, [{ type: 'TRADE_REJECTED', offer }]);
  assert.equal(moodOf(memory, 4), 0);
  for (let i = 0; i < 4; i++) observe(memory, [{ type: 'TRADE_ACCEPTED', offer }]);
  assert.equal(moodOf(memory, 4), 1);
});

test('mortgageToBuy: a seat short of cash mortgages an idle property to buy', () => {
  const state = table();
  give(state, 'a', 'jiange-pass');
  // 200 coins buy Xun Yu but leave less than half the reserve; mortgaging the pass makes up the rest.
  cash(state, 'a', 200);
  buyDecision(state, 'xun-yu');
  assert.equal(act(state, {})?.type, 'DECLINE');
  assert.deepEqual(act(state, { mortgageToBuy: true }), { type: 'MORTGAGE', player: 'a', property: 'jiange-pass' });
});

test('declinePoor: declines when no rival could pay, buys when one could', () => {
  const state = table();
  buyDecision(state, 'xun-yu');
  cash(state, 'b', 200);
  cash(state, 'c', 200);
  assert.equal(act(state, { declinePoor: 1.5 })?.type, 'DECLINE');
  cash(state, 'c', 400);
  assert.equal(act(state, { declinePoor: 1.5 })?.type, 'BUY');
});

test("buildSpread 'one': the second group gets nothing while the first is below target", () => {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'dong-zhuo', 'emperor-xian', 'wang-yun', 'diaochan', 'lu-bu');
  for (const id of ['wang-yun', 'diaochan', 'lu-bu']) state.properties[id].level = 1;
  state.bank.houses -= 3;
  cash(state, 'a', 3000);
  const action = act(state, { buildSpread: 'one', buildTarget: 4 }) as Extract<Action, { type: 'BUILD' }>;
  assert.ok(['wang-yun', 'diaochan', 'lu-bu'].includes(action.property), action.property);
});

test('buildNear: builds with a rival seven squares before the group, not with the rival past it', () => {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'sima-yi', 'sima-zhao');
  cash(state, 'a', 3000);
  state.players[1].position = 30;
  state.players[2].position = 1;
  assert.equal(act(state, { buildNear: 12 })?.type, 'BUILD');
  state.players[1].position = 2;
  assert.notEqual(act(state, { buildNear: 12 })?.type, 'BUILD');
});

test('jailStayBuilt: stays in jail once a rival has a group at three', () => {
  const state = table();
  Object.assign(state.players[0], { inJail: true, position: 10 });
  give(state, 'b', 'dong-zhuo', 'emperor-xian');
  for (const id of ['dong-zhuo', 'emperor-xian']) state.properties[id].level = 3;
  state.bank.houses -= 6;
  assert.equal(act(state, {})?.type, 'PAY_BAIL');
  assert.equal(act(state, { jailStayBuilt: true })?.type, 'ROLL');
});

test('sellOffers: offers an idle street to the rival who holds the rest of its group', () => {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'wang-yun');
  give(state, 'b', 'diaochan', 'lu-bu');
  cash(state, 'b', 1200);
  const action = act(state, { sellOffers: true, offerHigh: 3 }) as Extract<Action, { type: 'PROPOSE_TRADE' }>;
  assert.equal(action.type, 'PROPOSE_TRADE');
  assert.equal(action.to, 'b');
  assert.deepEqual(action.give.properties, ['wang-yun']);
  assert.ok(action.receive.cash >= 100);
});

test('distressOffers: offers under list price to a rival who cannot cover its next roll', () => {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'yuan-shao', 'xu-you');
  give(state, 'b', 'yan-liang-wen-chou');
  give(state, 'c', 'sima-yi', 'sima-zhao');
  state.properties['sima-zhao'].level = 2;
  state.properties['sima-yi'].level = 2;
  state.bank.houses -= 4;
  state.players[1].position = 30;
  cash(state, 'b', 50);
  const action = act(state, { distressOffers: true }) as Extract<Action, { type: 'PROPOSE_TRADE' }>;
  assert.equal(action.type, 'PROPOSE_TRADE');
  assert.equal(action.to, 'b');
  assert.ok(action.give.cash <= 160);
});

test('afterFirstGroup: its preferences change once its first group reaches the target', () => {
  const style = styleFrom('stages', { buildTarget: 1, buy: { ...BASELINE.buy, wu: 0 }, afterFirstGroup: { buy: { ...BASELINE.buy, wu: 1 } } });
  const state = table();
  buyDecision(state, 'sun-quan');
  assert.equal(chooseStyledAction(engine, state, 'a', never, style, createStyleMemory())?.type, 'DECLINE');
  give(state, 'a', 'dong-zhuo', 'emperor-xian');
  for (const id of ['dong-zhuo', 'emperor-xian']) state.properties[id].level = 1;
  state.bank.houses -= 2;
  assert.equal(chooseStyledAction(engine, state, 'a', never, style, createStyleMemory())?.type, 'BUY');
});

test('parts: every field but the few about the whole style is in exactly one part', () => {
  const counts = new Map<string, number>();
  for (const fields of Object.values(PARTS)) for (const f of fields) counts.set(f, (counts.get(f) ?? 0) + 1);
  for (const field of Object.keys(BASELINE)) {
    if ((META_FIELDS as string[]).includes(field)) continue;
    assert.equal(counts.get(field), 1, field);
  }
});

test('blend gives each style at its ends, and a composed style validates', () => {
  const a = school('hoarder');
  const b = school('all-in');
  assert.deepEqual({ ...blend(a, b, 0), name: a.name }, a);
  assert.deepEqual({ ...blend(a, b, 1), name: b.name }, b);
  assert.equal(blend(a, b, 0.5).reserve, (a.reserve + b.reserve) / 2);
  assert.deepEqual(validateStyle(compose(BASELINE, { buy: school('sniper'), answer: school('refuser') })), []);
});

test('playbooks: a later rule wins while both are on, and a rule holds for its turns', () => {
  const state = table();
  const memory = createStyleMemory();
  const playbook: Playbook = {
    name: 'order',
    base: BASELINE,
    rules: [
      { name: 'first', when: [{ signal: 'players', is: '>=', value: 3 }], set: { reserve: 111 }, hold: 0 },
      { name: 'second', when: [{ signal: 'players', is: '>=', value: 3 }], set: { reserve: 222 }, hold: 0 },
      { name: 'held', when: [{ signal: 'round', is: '<', value: 1 }], set: { buildTarget: 2 }, hold: 3 },
    ],
  };
  const { style, on } = resolvePlaybook(engine, state, 'a', playbook, memory, school);
  assert.equal(style.reserve, 222);
  assert.deepEqual(on, ['first', 'second', 'held']);
  // Three of the seat's own turns later the round condition no longer holds, but the rule still does.
  state.turn.number = 40;
  memory.ownTurns.a = 3;
  assert.equal(resolvePlaybook(engine, state, 'a', playbook, memory, school).style.buildTarget, 2);
  memory.ownTurns.a = 4;
  assert.equal(resolvePlaybook(engine, state, 'a', playbook, memory, school).style.buildTarget, 5);
});

test('signals: all twenty-one are numbers, unchanged when the seats are renamed', () => {
  const state = table();
  give(state, 'a', 'dong-zhuo', 'emperor-xian');
  give(state, 'b', 'hulao-pass');
  const signals = signalsOf(engine, state, 'a', createStyleMemory(), 5);
  assert.equal(SIGNAL_NAMES.length, 21);
  for (const name of SIGNAL_NAMES) assert.ok(Number.isFinite(signals[name]), name);
  assert.equal(signals.groups, 1);
  const renamed = structuredClone(state);
  const map: Record<string, string> = { a: 'x', b: 'y', c: 'z' };
  renamed.players.forEach((p) => {
    p.id = map[p.id];
  });
  for (const property of Object.values(renamed.properties)) if (property.owner) property.owner = map[property.owner];
  renamed.turn.player = map[renamed.turn.player];
  assert.deepEqual(signalsOf(engine, renamed, 'x', createStyleMemory(), 5), signals);
});

test('every preset validates and plays a four-player game by the rules', () => {
  assert.equal(Object.keys(PRESETS).length, 37);
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.deepEqual(validateStyle(preset.playbook.base), [], name);
    const size = preset.sizes.includes(4) ? 4 : preset.sizes[0];
    assert.equal(playPreset(engine, name, size, 1).problem, null, name);
  }
});
