import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chances, knotOf, lbfgs, objective } from '../src/sim/logit.ts';
import type { Grouped } from '../src/sim/logit.ts';

/** A small random generator, so the test is the same every run. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

test('knots: a round between two knots is weighted toward the nearer', () => {
  assert.deepEqual(knotOf([5, 10, 20], 15), { k: 1, t: 0.5 });
  assert.deepEqual(knotOf([5, 10, 20], 3), { k: 0, t: 0 });
  assert.deepEqual(knotOf([5, 10, 20], 99), { k: 1, t: 1 });
});

test('the fit recovers known weights from winners drawn by them', () => {
  const knots = [5, 10, 20];
  const fw = 3;
  // Weights that change with the round: [knot][feature].
  const truth = [
    [1.0, -0.5, 0.0],
    [1.5, 0.0, 0.5],
    [0.5, 0.5, 1.0],
  ];
  const random = generator(7);
  const snapshots = 30000;
  const start = new Int32Array(snapshots);
  const count = new Int8Array(snapshots);
  const winner = new Int8Array(snapshots);
  const round = new Int16Array(snapshots);
  const values: number[] = [];
  const rounds = [5, 10, 15, 20];
  let rows = 0;
  for (let s = 0; s < snapshots; s++) {
    const c = 2 + Math.floor(random() * 3);
    const r = rounds[s % rounds.length];
    const { k, t } = knotOf(knots, r);
    const w = truth[0].map((_, f) => (1 - t) * truth[k][f] + t * truth[k + 1][f]);
    const scores: number[] = [];
    for (let i = 0; i < c; i++) {
      const x = [random() * 2 - 1, random() * 2 - 1, random() < 0.3 ? 1 : 0];
      values.push(...x);
      scores.push(Math.exp(x.reduce((sum, v, f) => sum + v * w[f], 0)));
    }
    const total = scores.reduce((a, b) => a + b, 0);
    let pick = random() * total;
    let win = 0;
    while (pick > scores[win]) pick -= scores[win++];
    start[s] = rows;
    count[s] = c;
    winner[s] = Math.min(win, c - 1);
    round[s] = r;
    rows += c;
  }
  const data: Grouped = { start, count, winner, round, seatRows: rows };
  const feats = { values: Float32Array.from(values), width: fw, offset: 0 };
  const all = Int32Array.from({ length: snapshots }, (_, s) => s);
  const w = lbfgs((v) => objective(knots, data, feats, fw, all, v, 0.01, 0), new Float64Array(knots.length * fw));
  truth.forEach((row, k) =>
    row.forEach((value, f) => assert.ok(Math.abs(w[k * fw + f] - value) < 0.2, `knot ${k}, feature ${f}: ${w[k * fw + f]} against ${value}`)),
  );
  const p = chances(knots, data, feats, fw, all, w);
  for (let s = 0; s < 100; s++) {
    let sum = 0;
    for (let i = 0; i < count[s]; i++) sum += p[start[s] + i];
    assert.ok(Math.abs(sum - 1) < 1e-9);
  }
});
