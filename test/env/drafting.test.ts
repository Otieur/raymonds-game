import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS, ACTIONS_VERSION, CASH0, codecFor, DROP, emptyDraft, GIVE0, legalIndices, PARTNER0 } from '../../src/env/actions.ts';
import type { Draft } from '../../src/env/actions.ts';
import { createLedger } from '../../src/env/ledger.ts';
import { createMlp } from '../../src/env/mlp.ts';
import { observe, OBS_LAYOUT, OBS_SIZE } from '../../src/env/observe.ts';
import { createEngine, threeKingdoms } from '../../src/index.ts';
import type { GameState } from '../../src/index.ts';
import { viewOf } from '../../src/sim/measures.ts';
import { contextOf } from '../../src/sim/style-agent.ts';

const engine = createEngine(threeKingdoms);
const ctx = contextOf(engine);

/** Three players, `a` on its own free turn after the roll; `b` holds two streets of a three-street group and `a` the third. */
function table(): { state: GameState; streets: string[]; k: number } {
  const state = engine.newGame({ players: ['a', 'b', 'c'], seed: 1, startingPlayer: 'a' });
  state.turn.phase = 'postRoll';
  state.pending = [];
  const [, group] = [...ctx.groups].find(([, sqs]) => sqs.length === 3) as [string, readonly { id: string }[]];
  const streets = group.map((sq) => sq.id);
  state.properties[streets[0]].owner = 'b';
  state.properties[streets[1]].owner = 'b';
  state.properties[streets[2]].owner = 'a';
  return { state, streets, k: ctx.propertyOrder.findIndex((sq) => sq.id === streets[2]) };
}

const options = (refusedSales: string[] = []) => ({ drafting: true, proposalsLeft: 2, refused: new Set<number>(), refusedSales: new Set(refusedSales) });
const draftOf = (decoded: ReturnType<ReturnType<typeof codecFor>['decode']>): Draft => {
  assert.equal(decoded.kind, 'draft');
  return (decoded as { kind: 'draft'; draft: Draft }).draft;
};

test('a sale: give, then the partner, then a price the partner pays; every price the mask allows is an offer the engine accepts', () => {
  const { state, streets, k } = table();
  const start = codecFor(ctx, engine, state, 'a', emptyDraft(), options());
  assert.equal(start.mask[GIVE0 + k], 1);
  const naming = draftOf(start.decode(GIVE0 + k));
  assert.deepEqual(naming, { stage: 'partner', partner: null, ask: -1, give: k });

  const partners = codecFor(ctx, engine, state, 'a', naming, options());
  // The seats after a in the order of play are b and c; a table of three has no third partner.
  assert.deepEqual([partners.mask[PARTNER0], partners.mask[PARTNER0 + 1], partners.mask[PARTNER0 + 2]], [1, 1, 0]);
  assert.equal(partners.mask[DROP], 1);
  const pricing = draftOf(partners.decode(PARTNER0));
  assert.equal(pricing.partner, 'b');
  assert.equal(pricing.stage, 'cash');

  const prices = codecFor(ctx, engine, state, 'a', pricing, options());
  const offers = legalIndices(prices.mask).filter((index) => index !== DROP);
  assert.ok(offers.length >= 1);
  for (const index of offers) {
    assert.ok(index >= CASH0 && index < CASH0 + 9);
    const decoded = prices.decode(index);
    assert.equal(decoded.kind, 'engine');
    const action = (decoded as { kind: 'engine'; action: { type: string; give: { cash: number; properties: string[] }; receive: { cash: number; properties: string[] } } }).action;
    assert.equal(action.type, 'PROPOSE_TRADE');
    assert.deepEqual(action.give, { cash: 0, properties: [streets[2]], jailCards: 0 });
    assert.ok(action.receive.cash > 0);
    assert.deepEqual(action.receive.properties, []);
    assert.equal(engine.validate(state, decoded.kind === 'engine' ? decoded.action : (null as never)), null);
  }
});

test('a sale refused this turn is not offered again to the same partner, and not at all once every partner has refused it', () => {
  const { state, k } = table();
  const naming: Draft = { stage: 'partner', partner: null, ask: -1, give: k };
  const one = codecFor(ctx, engine, state, 'a', naming, options([`${k}>b`]));
  assert.deepEqual([one.mask[PARTNER0], one.mask[PARTNER0 + 1]], [0, 1]);
  const both = codecFor(ctx, engine, state, 'a', emptyDraft(), options([`${k}>b`, `${k}>c`]));
  assert.equal(both.mask[GIVE0 + k], 0);
});

test('the offer block: a sale that completes the partner\'s group, the marks of the draft, and the buildings it could pay for', () => {
  const { state, streets, k } = table();
  const off = (OBS_LAYOUT.find((b) => b.name === 'offer') as { offset: number }).offset;
  const read = (draft: Draft) =>
    Array.from(observe({ ctx, state, view: viewOf(ctx, state), seat: 0, ledger: createLedger(), chances: [1 / 3, 1 / 3, 1 / 3], draft, proposalsLeft: 1, shortGame: false }).slice(off, off + 6));
  // Naming the partner: no deal yet, so nothing is completed; the draft is a sale at the partner step.
  assert.deepEqual(read({ stage: 'partner', partner: null, ask: -1, give: k }), [0, 0, 0, 0, 1, 1]);
  // Priced to b, who holds the other two streets: it completes b's group, and b's cash pays for some buildings.
  const b = state.players.find((p) => p.id === 'b') as { cash: number };
  const cost = (ctx.properties.get(streets[0]) as { buildingCost: number }).buildingCost;
  const buildings = Math.min(15, Math.floor(b.cash / cost));
  const priced = read({ stage: 'cash', partner: 'b', ask: -1, give: k });
  assert.deepEqual(priced.slice(0, 2), [0, 1]);
  assert.ok(Math.abs(priced[3] - buildings / 15) < 1e-6);
  assert.deepEqual(priced.slice(4), [0, 1]);
  // No draft and no offer: the block is all zeros.
  assert.deepEqual(read(emptyDraft()), [0, 0, 0, 0, 0, 0]);
});

/** IEEE half-precision bits of a value that half precision holds exactly. */
function halfBits(v: number): number {
  if (v === 0) return 0;
  const sign = v < 0 ? 0x8000 : 0;
  const a = Math.abs(v);
  const e = Math.floor(Math.log2(a));
  return sign | ((e + 15) << 10) | Math.round((a / 2 ** e - 1) * 1024);
}

test('a model of observation version 3 and action version 2 is widened as it loads, and plays as it did', () => {
  const shapes: [number, number][] = [[1023, 2], [2, 2], [2, 2], [2, 188], [2, 3]];
  const values: number[] = [];
  let t = 0;
  for (const [inputs, outputs] of shapes) for (let i = 0; i < inputs * outputs + outputs; i++) values.push((((t++ * 7) % 17) - 8) / 8);
  const bytes = new Uint8Array(values.length * 2);
  values.forEach((v, i) => {
    const bits = halfBits(v);
    bytes[2 * i] = bits & 0xff;
    bytes[2 * i + 1] = bits >> 8;
  });
  const data = btoa(String.fromCharCode(...bytes));
  const mlp = createMlp({ name: 'old', obsVersion: 3, actionsVersion: 2, shapes, data });

  // The reference: the old network on the first 1,023 inputs, computed here.
  let at = 0;
  const layers = shapes.map(([inputs, outputs]) => {
    const w = values.slice(at, at + inputs * outputs);
    at += inputs * outputs;
    const b = values.slice(at, at + outputs);
    at += outputs;
    return { inputs, outputs, w, b };
  });
  const dense = (layer: (typeof layers)[number], x: number[], relu: boolean) =>
    Array.from({ length: layer.outputs }, (_, o) => {
      let sum = layer.b[o];
      for (let i = 0; i < layer.inputs; i++) sum += layer.w[o * layer.inputs + i] * x[i];
      return relu && sum < 0 ? 0 : sum;
    });
  const input = Array.from({ length: 1023 }, (_, i) => ((i % 5) - 2) / 4);
  let h = dense(layers[0], input, true);
  h = dense(layers[1], h, true);
  h = dense(layers[2], h, true);
  const policy = dense(layers[3], h, false);

  for (const tail of [[0, 0, 0, 0, 0, 0], [1, 1, 0.5, 0.25, 1, 1]]) {
    const out = mlp.forward(Float32Array.from([...input, ...tail]));
    assert.equal(out.policy.length, ACTIONS);
    policy.forEach((v, i) => assert.ok(Math.abs(out.policy[i] - v) < 1e-3, `logit ${i}`));
    assert.deepEqual(Array.from(out.policy.slice(188)), [0, 0, 0]);
  }
  assert.equal(OBS_SIZE, 1029);
  assert.equal(ACTIONS_VERSION, 3);
});
