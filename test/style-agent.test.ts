import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareWithBaseline, playPreset } from '../scripts/check-style.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { Action, GameState, PlayerId } from '../src/index.ts';
import { blend, compose, META_FIELDS, PARTS } from '../src/sim/parts.ts';
import { resolvePlaybook } from '../src/sim/playbook.ts';
import type { Playbook } from '../src/sim/playbook.ts';
import { signalsOf, SIGNAL_NAMES } from '../src/sim/signals.ts';
import { BASELINE, completeStyle, SETS, styleFrom, TABLE_FIELDS, validateStyle } from '../src/sim/style.ts';
import type { Style } from '../src/sim/style.ts';
import { chooseStyledAction, createStyleMemory, moodOf, observe, readsTable } from '../src/sim/style-agent.ts';
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

test('coldEdge: a seat that answers by the sheet takes the cold edge only while the table is cold', () => {
  const state = table();
  give(state, 'a', 'hulao-pass');
  state.pending = [
    { kind: 'trade', offer: { from: 'b', to: 'a', give: { cash: 250, properties: [], jailCards: 0 }, receive: { cash: 0, properties: ['hulao-pass'], jailCards: 0 } } },
  ];
  const style = styleFrom('test', { valuation: 'v1', answerBy: 'sheet', acceptEdge: 20, coldMood: 0.15, coldEdge: -20 });
  const answer = (answers: boolean[], s: Style = style) => {
    const memory = createStyleMemory();
    memory.answers.push(...answers);
    return chooseStyledAction(engine, state, 'a', never, s, memory)?.type;
  };
  // Eight refusals in a row: the table is cold, and the low edge applies.
  assert.equal(answer(Array(8).fill(false)), 'ACCEPT_TRADE');
  // Eight acceptances, or fewer than eight offers seen: the usual edge applies.
  assert.equal(answer(Array(8).fill(true)), 'REJECT_TRADE');
  assert.equal(answer([false, false]), 'REJECT_TRADE');
  // With coldMood at 0 the table is never cold.
  assert.equal(answer(Array(8).fill(false), { ...style, coldMood: 0 }), 'REJECT_TRADE');
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

test('signals: all twenty-five are numbers, unchanged when the seats are renamed', () => {
  const state = table();
  give(state, 'a', 'dong-zhuo', 'emperor-xian');
  give(state, 'b', 'hulao-pass');
  const signals = signalsOf(engine, state, 'a', createStyleMemory(), 5);
  assert.equal(SIGNAL_NAMES.length, 25);
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
  assert.equal(Object.keys(PRESETS).length, 65); // the 37 of M2, the 15 presets and one playbook of M3b, and 12 corrected forms
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.deepEqual(validateStyle(preset.playbook.base), [], name);
    const size = preset.sizes.includes(4) ? 4 : preset.sizes[0];
    assert.equal(playPreset(engine, name, size, 1).problem, null, name);
  }
});

// ---------- Playing the table (docs/plan/m03b-table-politics.md) ----------

import { worthInCoins } from '../src/sim/deal.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import type { StyleMemory } from '../src/sim/style-agent.ts';
import { v1 } from '../src/sim/valuation.ts';

const ctx = contextOf(engine);
const seatAct = (state: GameState, style: Partial<Style>, memory: StyleMemory) =>
  chooseStyledAction(engine, state, 'a', never, styleFrom('table', style), memory);
type Proposal = Extract<Action, { type: 'PROPOSE_TRADE' }>;

/** Sends an offer through the engine and has the partner refuse it, feeding the memory after each action. */
function refuse(state: GameState, action: Proposal, memory: StyleMemory): GameState {
  const proposed = engine.apply(state, action);
  assert.ok(proposed.ok);
  observe(memory, proposed.events, proposed.state);
  const answered = engine.apply(proposed.state, { type: 'REJECT_TRADE', player: action.to });
  assert.ok(answered.ok);
  observe(memory, answered.events, answered.state);
  return answered.state;
}
/** Moves on to a later turn of `a`: three table turns for each own turn. */
function later(state: GameState, memory: StyleMemory, ownTurns: number): void {
  state.turn.number += 3 * ownTurns;
  memory.ownTurns.a = (memory.ownTurns.a ?? 0) + ownTurns;
}
/** The most `a`, who holds the rest of the group, can pay `b` for Lü Bu without losing by the deal sheet, with 1,350 coins above its reserve. */
function worthOfLuBu(state: GameState): number {
  const changed = structuredClone(state);
  changed.properties['lu-bu'].owner = 'a';
  return worthInCoins(ctx, state, changed, 'a', v1(3), 1350, 'b');
}
/** `a` holds two streets of Chain Stratagem and `b` the third; `a` has rolled. */
function lacksOne(): GameState {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'wang-yun', 'diaochan');
  give(state, 'b', 'lu-bu');
  return state;
}

test('offerBy value: the first ask is openShare of what the street is worth to the seat', () => {
  const state = lacksOne();
  const action = seatAct(state, { offerBy: 'value' }, createStyleMemory()) as Proposal;
  assert.equal(action.type, 'PROPOSE_TRADE');
  assert.equal(action.to, 'b');
  assert.deepEqual(action.receive.properties, ['lu-bu']);
  assert.equal(action.give.cash, Math.round(worthOfLuBu(state) * 0.3));
  // The baseline prices the same ask by list price: 1.7 to 2.2 times 120.
  const listed = act(state, {}) as Proposal;
  assert.equal(listed.give.cash, Math.round(120 * 1.7));
});

test('asking again: a refused ask waits probeGap own turns and comes back raiseStep higher', () => {
  const memory = createStyleMemory();
  const style = { offerBy: 'value' as const };
  let state = lacksOne();
  state = refuse(state, seatAct(state, style, memory) as Proposal, memory);
  assert.equal(memory.relations.asks.a['lu-bu'].refused, 1);
  later(state, memory, 1);
  assert.notEqual(seatAct(state, style, memory)?.type, 'PROPOSE_TRADE');
  later(state, memory, 2);
  const second = seatAct(state, style, memory) as Proposal;
  assert.equal(second.type, 'PROPOSE_TRADE');
  assert.equal(second.give.cash, Math.round(worthOfLuBu(state) * 0.45));
});

test('asking again: the ask is renewed at once, at the same share, when the holder runs short of cash', () => {
  const memory = createStyleMemory();
  const style = { offerBy: 'value' as const };
  let state = lacksOne();
  state = refuse(state, seatAct(state, style, memory) as Proposal, memory);
  later(state, memory, 1);
  cash(state, 'b', 3); // below the rent b could owe on a's streets
  const again = seatAct(state, style, memory) as Proposal;
  assert.equal(again.type, 'PROPOSE_TRADE');
  assert.equal(again.give.cash, Math.round(worthOfLuBu(state) * 0.3));
});

test('asking again: the share never passes maxShare', () => {
  const memory = createStyleMemory();
  const style = { offerBy: 'value' as const };
  let state = lacksOne();
  state = refuse(state, seatAct(state, style, memory) as Proposal, memory);
  memory.relations.asks.a['lu-bu'].refused = 12;
  later(state, memory, 3);
  const last = seatAct(state, style, memory) as Proposal;
  assert.equal(last.give.cash, Math.round(worthOfLuBu(state) * 0.8));
});

test('early asks: a seat with one street of three asks for a second, before earlyBefore and not after', () => {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'wang-yun');
  give(state, 'b', 'diaochan');
  const style = { offerBy: 'value' as const, earlyOffers: true };
  const action = seatAct(state, style, createStyleMemory()) as Proposal;
  assert.equal(action.type, 'PROPOSE_TRADE');
  assert.deepEqual(action.receive.properties, ['diaochan']);
  // Today's agent, and a seat that prices by value without early asks, wait until they lack one street.
  assert.notEqual(act(state, {})?.type, 'PROPOSE_TRADE');
  assert.notEqual(seatAct(state, { offerBy: 'value' }, createStyleMemory())?.type, 'PROPOSE_TRADE');
  state.turn.number = 3 * 25 + 1; // round 25
  assert.notEqual(seatAct(state, style, createStyleMemory())?.type, 'PROPOSE_TRADE');
});

test('early asks: with earlyNeed, no ask when the holder of the third street has refused twice', () => {
  const state = table();
  state.turn.phase = 'postRoll';
  give(state, 'a', 'wang-yun');
  give(state, 'b', 'diaochan');
  give(state, 'c', 'lu-bu');
  const refusedTwice = () => {
    const memory = createStyleMemory();
    memory.relations.asks.a = { 'lu-bu': { partner: 'c', share: 0.45, cash: 60, turn: 0, refused: 2, chance: 0.33, short: false } };
    return memory;
  };
  const style = { offerBy: 'value' as const, earlyOffers: true };
  assert.equal(seatAct(state, style, refusedTwice())?.type, 'PROPOSE_TRADE');
  assert.notEqual(seatAct(state, { ...style, earlyNeed: 0.5 }, refusedTwice())?.type, 'PROPOSE_TRADE');
});

test('the table fields: every one is in the list, has a default, and leaves a stored style playing as before', () => {
  const stored = Object.fromEntries(Object.entries(BASELINE).filter(([key]) => !(TABLE_FIELDS as readonly string[]).includes(key)));
  assert.deepEqual(completeStyle(stored as never), BASELINE);
  assert.equal(TABLE_FIELDS.length, 34);
  assert.equal(readsTable(BASELINE), false);
});

// ---------- Denying, estates, answers by the sheet, signals, hunting ----------

import { dealSheet, denialWorth, pointsPerCoin } from '../src/sim/deal.ts';
import { goodwillOf } from '../src/sim/relations.ts';
import { areAllied } from '../src/sim/style-agent.ts';

/** Four players at round 10, `a` to move after its roll. */
function four(): GameState {
  const state = engine.newGame({ players: ['a', 'b', 'c', 'd'], seed: 1, startingPlayer: 'a' });
  state.turn.number = 41;
  state.turn.phase = 'postRoll';
  return state;
}
const level = (state: GameState, steps: number, ...ids: string[]) => {
  for (const id of ids) state.properties[id].level = steps;
};
const side = (cashAmount: number, ...properties: string[]) => ({ cash: cashAmount, properties, jailCards: 0 });
const play = (state: GameState, style: Partial<Style>, memory: StyleMemory = createStyleMemory(), actor: PlayerId = 'a') =>
  chooseStyledAction(engine, state, actor, never, styleFrom('table', style), memory);

/** `b` holds two streets of Chain Stratagem and wants the third, which `c` holds. */
function rivalOneShort(): GameState {
  const state = four();
  give(state, 'b', 'wang-yun', 'diaochan', 'cao-cao', 'cao-pi', 'xun-yu');
  level(state, 3, 'cao-cao', 'cao-pi', 'xun-yu');
  give(state, 'c', 'lu-bu');
  give(state, 'a', 'liu-bei');
  return state;
}

test('denying: asks a third seat for the street the strongest rival wants, and not when ranked below denyRank', () => {
  const state = rivalOneShort();
  const style = { offerBy: 'value' as const, denyOffers: true, denyShare: 1, maxShare: 1 };
  const action = play(state, style) as Proposal;
  assert.equal(action.type, 'PROPOSE_TRADE');
  assert.equal(action.to, 'c');
  assert.deepEqual(action.receive.properties, ['lu-bu']);
  // Without the field it has no reason to ask for a street of a group it holds nothing of.
  assert.notEqual(play(state, { offerBy: 'value' })?.type, 'PROPOSE_TRADE');
  // `b` is ranked first, so a seat that denies only when ranked first does not.
  assert.notEqual(play(state, { ...style, denyRank: 1 })?.type, 'PROPOSE_TRADE');
});

test('denying: in an auction the cap rises to what stopping the rival is worth', () => {
  const state = rivalOneShort();
  give(state, null, 'lu-bu');
  state.pending = [{ kind: 'auction', property: 'lu-bu', bidders: ['a', 'b'], highBid: 200, highBidder: 'b' }];
  assert.equal(play(state, {})?.type, 'PASS'); // today's cap: 110% of 120
  const worth = (denialWorth(ctx, state, 'a', 'b', 'lu-bu', v1(4), 1) / pointsPerCoin(ctx, state, 'a', v1(4)));
  assert.ok(worth > 201, `denial is worth ${worth} coins`);
  assert.equal(play(state, { denyOffers: true, denyShare: 1 })?.type, 'BID');
});

/** `c` is failing: almost no cash, and `b`'s built group just ahead of it. */
function failing(): GameState {
  const state = four();
  give(state, 'b', 'wang-yun', 'diaochan', 'lu-bu', 'yuan-shao', 'xu-you');
  level(state, 3, 'wang-yun', 'diaochan', 'lu-bu');
  give(state, 'c', 'cao-cao', 'yan-liang-wen-chou');
  cash(state, 'c', 20);
  return state;
}

test('estates: asks a failing rival for the street worth most to it, and never under list price', () => {
  const state = failing();
  give(state, 'a', 'cao-pi');
  const action = play(state, { offerBy: 'value', estateOffers: 'self' }) as Proposal;
  assert.equal(action.type, 'PROPOSE_TRADE');
  assert.equal(action.to, 'c');
  assert.deepEqual(action.receive.properties, ['cao-cao']);
  assert.ok(action.give.cash >= 180, `cash ${action.give.cash}`);
  // A rival with cash in hand is not failing, and is not asked.
  cash(state, 'c', 1500);
  assert.notEqual(play(state, { offerBy: 'value', estateOffers: 'self' })?.type, 'PROPOSE_TRADE');
});

test('estates: with both, asks for the street the strongest rival wants; with rescue the cash covers the failing seat\'s largest due', () => {
  // `a` leads with Shu Han built; `b` is its challenger and lacks one street of House of Yuan, which the failing `c` holds.
  const state = four();
  give(state, 'b', 'wang-yun', 'diaochan', 'lu-bu', 'yuan-shao', 'xu-you');
  level(state, 3, 'wang-yun', 'diaochan', 'lu-bu');
  give(state, 'a', 'liu-bei', 'guan-yu', 'zhuge-liang');
  level(state, 3, 'liu-bei', 'guan-yu', 'zhuge-liang');
  give(state, 'c', 'yan-liang-wen-chou');
  cash(state, 'c', 20);
  // For itself the street is worth nothing to `a`, so a seat that buys estates only for itself does not ask.
  // Its own group stands at its build target, so it has nothing to build.
  const built = { buildTarget: 3 as const, buildBeyond: null };
  assert.notEqual(play(state, { ...built, offerBy: 'value', estateOffers: 'self' })?.type, 'PROPOSE_TRADE');
  const style = { ...built, offerBy: 'value' as const, estateOffers: 'both' as const, denyShare: 1 };
  const action = play(state, style) as Proposal;
  assert.equal(action.type, 'PROPOSE_TRADE');
  assert.equal(action.to, 'c');
  assert.deepEqual(action.receive.properties, ['yan-liang-wen-chou']);
  assert.ok(action.give.cash >= 160, `never under list price: ${action.give.cash}`);
  // `c` could owe 300 on Lü Bu with 20 in hand, and its creditor would be `b`: a rescue pays at least the 280 it lacks.
  const worth = denialWorth(ctx, state, 'a', 'b', 'yan-liang-wen-chou', v1(4), 1) / pointsPerCoin(ctx, state, 'a', v1(4));
  assert.ok(worth >= 280, `stopping b is worth ${worth} coins`);
  const rescue = play(state, { ...style, rescue: true }) as Proposal;
  assert.ok(rescue.give.cash >= 280, `cash ${rescue.give.cash}`);
  assert.ok(action.give.cash < 280, `without rescue it offers ${action.give.cash}`);
});

test('answering by the sheet: one offer is taken from the seat ranked last and refused from the leader', () => {
  const offerFor = (proposer: PlayerId): GameState => {
    const state = four();
    give(state, 'b', 'cao-cao', 'cao-pi', 'xun-yu');
    level(state, 3, 'cao-cao', 'cao-pi', 'xun-yu');
    give(state, proposer, 'wang-yun', 'diaochan');
    give(state, 'a', 'lu-bu');
    cash(state, 'd', 700);
    state.pending = [{ kind: 'trade', offer: { from: proposer, to: 'a', give: side(300), receive: side(0, 'lu-bu') } }];
    return state;
  };
  const style = { answerBy: 'sheet' as const, againstLeader: 1 };
  assert.equal(play(offerFor('b'), style)?.type, 'REJECT_TRADE');
  assert.equal(play(offerFor('d'), style)?.type, 'ACCEPT_TRADE');
});

test('reciprocity: a seat that has shown ill will is asked that many points more', () => {
  const state = four();
  give(state, 'a', 'yuan-shao');
  // Find a price at which the deal is worth between one and three points to `a`.
  let price = 0;
  for (let coins = 100; coins <= 900 && price === 0; coins += 10) {
    const gain = dealSheet(ctx, state, { from: 'd', to: 'a', give: side(coins), receive: side(0, 'yuan-shao') }, v1(4)).delta[0] * 100;
    if (gain > 1 && gain < 3) price = coins;
  }
  assert.ok(price > 0);
  state.pending = [{ kind: 'trade', offer: { from: 'd', to: 'a', give: side(price), receive: side(0, 'yuan-shao') } }];
  const style = { answerBy: 'sheet' as const, reciprocity: 1 };
  assert.equal(play(state, style)?.type, 'ACCEPT_TRADE');
  const grudge = createStyleMemory();
  grudge.relations.shown.a = { d: [{ round: 10, points: -4 }] };
  assert.equal(play(state, style, grudge)?.type, 'REJECT_TRADE');
  assert.equal(play(state, { answerBy: 'sheet' }, grudge)?.type, 'ACCEPT_TRADE'); // a seat that does not read signals
});

test('signals: a trailing seat invites another, the offer is legal, and an answer in kind makes them allies', () => {
  const state = four();
  give(state, 'b', 'wang-yun', 'diaochan', 'lu-bu');
  level(state, 1, 'wang-yun', 'diaochan', 'lu-bu');
  give(state, 'a', 'cao-cao', 'liu-bei');
  give(state, 'c', 'cao-pi', 'guan-yu');
  const style = { courtAllies: true, reciprocity: 1, allyAt: 1 };
  const memory = createStyleMemory();
  const invitation = play(state, style, memory) as Proposal;
  assert.equal(invitation.type, 'PROPOSE_TRADE');
  assert.equal(invitation.to, 'c'); // never the leader
  assert.equal(engine.validate(state, invitation), null);
  const sheet = dealSheet(ctx, state, { from: 'a', to: 'c', give: invitation.give, receive: invitation.receive }, v1(4));
  assert.ok(sheet.delta[0] >= 0 && (sheet.delta[2] - sheet.delta[0]) * 100 >= 2 && sheet.delta[1] <= 0);
  // A seat that does not court sends nothing of the kind.
  assert.notEqual(play(state, {})?.type, 'PROPOSE_TRADE');

  // `c` accepts: `a` has shown `c` goodwill, by the sheet's difference.
  const proposed = engine.apply(state, invitation);
  assert.ok(proposed.ok);
  observe(memory, proposed.events, proposed.state);
  const accepted = engine.apply(proposed.state, { type: 'ACCEPT_TRADE', player: 'c' });
  assert.ok(accepted.ok);
  observe(memory, accepted.events, accepted.state);
  const shown = goodwillOf(memory.relations, 'c', 'a', 10, 4);
  assert.ok(Math.abs(shown - Math.min(5, (sheet.delta[2] - sheet.delta[0]) * 100)) < 1e-6);
  assert.equal(areAllied(engine, accepted.state, 'a', 'c', styleFrom('t', style), memory), false); // nothing has come back yet

  // `c` answers in kind, and they are allied; a denying purchase by `c` ends it.
  memory.relations.shown.a = { c: [{ round: 10, points: 3 }] };
  assert.equal(areAllied(engine, accepted.state, 'a', 'c', styleFrom('t', style), memory), true);
  memory.relations.shown.a.c.push({ round: 10, points: -5 });
  assert.equal(areAllied(engine, accepted.state, 'a', 'c', styleFrom('t', style), memory), false);
});

test('hunting: builds first where a failing rival is about to land, and as today when none is failing', () => {
  const state = table();
  give(state, 'a', 'wang-yun', 'diaochan', 'lu-bu', 'cao-cao', 'cao-pi', 'xun-yu');
  cash(state, 'a', 2500);
  const c = state.players.find((p) => p.id === 'c') as { position: number };
  c.position = 9; // seven squares before Cao Cao
  const usual = act(state, {}) as Extract<Action, { type: 'BUILD' }>;
  assert.equal(usual.type, 'BUILD');
  assert.equal(act(state, { huntFailing: true })?.type, 'BUILD');
  assert.deepEqual(act(state, { huntFailing: true }), usual); // `c` is not failing
  cash(state, 'c', 5);
  const hunt = act(state, { huntFailing: true }) as Extract<Action, { type: 'BUILD' }>;
  assert.ok(['cao-cao', 'cao-pi', 'xun-yu'].includes(hunt.property), `built on ${hunt.property}`);
  assert.ok(!['cao-cao', 'cao-pi', 'xun-yu'].includes(usual.property), `today's agent builds on ${usual.property}`);
});

test('each school that prices by value has a corrected form, the same but for today\'s price for the last street', () => {
  for (const name of ['early-bird', 'prober', 'warden', 'undertaker', 'broker', 'balancer', 'patron', 'envoy', 'scavenger', 'statesman', 'statesman-book']) {
    const first = PRESETS[name].playbook.base;
    const corrected = PRESETS[`${name}-2`].playbook.base;
    assert.equal(first.offerBy, 'value', name);
    assert.equal(first.completeBy, 'value', name);
    assert.equal(corrected.completeBy, 'list', name);
    const differ = Object.keys(first).filter((key) => !['name', 'completeBy', 'earlyBefore'].includes(key) && JSON.stringify(first[key as keyof typeof first]) !== JSON.stringify(corrected[key as keyof typeof corrected]));
    assert.deepEqual(differ, [], name);
  }
  assert.equal(PRESETS['reference-3'].playbook.base.completeBy, 'list');
  assert.deepEqual(PRESETS['statesman-book-2'].playbook.rules, PRESETS['statesman-book'].playbook.rules);
});

test('completeBy list: a seat that prices by value keeps today\'s price for the last street of a group, and still asks early by value', () => {
  const state = lacksOne();
  const style = { offerBy: 'value' as const, completeBy: 'list' as const };
  const last = seatAct(state, style, createStyleMemory()) as Proposal;
  assert.equal(last.type, 'PROPOSE_TRADE');
  assert.equal(last.give.cash, Math.round(120 * 1.7)); // the baseline's price, with this test's draws
  const early = table();
  early.turn.phase = 'postRoll';
  give(early, 'a', 'wang-yun');
  give(early, 'b', 'diaochan');
  const ask = seatAct(early, { ...style, earlyOffers: true }, createStyleMemory()) as Proposal;
  assert.equal(ask.type, 'PROPOSE_TRADE');
  assert.deepEqual(ask.receive.properties, ['diaochan']);
});

test('passOffers: asks a rival for its pass at offerLow to offerHigh times list, and only with the field', () => {
  const state = four();
  give(state, 'b', 'hulao-pass');
  give(state, 'a', 'guandu-ford');
  const pass = engine.board.squares.find((sq) => sq.id === 'hulao-pass') as { price: number };
  const style = { passOffers: true, offerLow: 2, offerHigh: 3 };
  const action = play(state, style) as Proposal;
  assert.equal(action.type, 'PROPOSE_TRADE');
  assert.equal(action.to, 'b');
  assert.deepEqual(action.receive.properties, ['hulao-pass']);
  assert.equal(action.give.cash, pass.price * 2, 'the random draw of 0 gives offerLow times list');
  assert.notEqual(play(state, {})?.type, 'PROPOSE_TRADE');
  // The Pass baron has it on; no other preset does.
  assert.equal(PRESETS['pass-baron'].playbook.base.passOffers, true);
  assert.deepEqual(Object.values(PRESETS).filter((preset) => preset.playbook.base.passOffers).map((preset) => preset.name), ['pass-baron']);
});
