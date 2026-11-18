import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitLinear } from '../src/sim/linear.ts';

test('least squares recovers the coefficients of an exact 4 by 4 system', () => {
  // y = 2 + 3a - b + 0.5c, sampled at points that make the normal equations well conditioned.
  const truth = [2, 3, -1, 0.5];
  const rows: number[][] = [];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) rows.push([1, a, b * 2, c - 1]);
  const width = truth.length;
  const xtx = new Array<number>(width * width).fill(0);
  const xty = new Array<number>(width).fill(0);
  let total = 0;
  for (const row of rows) {
    const y = row.reduce((sum, x, i) => sum + x * truth[i], 0);
    total += y;
    for (let i = 0; i < width; i++) {
      xty[i] += row[i] * y;
      for (let j = 0; j < width; j++) xtx[i * width + j] += row[i] * row[j];
    }
  }
  const { beta } = fitLinear(xtx, xty, rows.length, total);
  beta.forEach((value, i) => assert.ok(Math.abs(value - truth[i]) < 1e-6, `coefficient ${i}: ${value}`));
});

test('a feature that is never non-zero gets no coefficient', () => {
  const xtx = [4, 2, 0, 2, 2, 0, 0, 0, 0];
  const xty = [3, 2, 0];
  const { beta, error } = fitLinear(xtx, xty, 4, 3);
  assert.ok(Number.isNaN(beta[2]) && Number.isNaN(error[2]));
  assert.ok(Number.isFinite(beta[0]) && Number.isFinite(beta[1]));
});
