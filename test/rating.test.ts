import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitStrengths, rate } from '../src/sim/rating.ts';

function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Finishing orders drawn by the Plackett-Luce model itself. */
function draw(strengths: Record<string, number>, games: number, seats: number, random: () => number): string[][] {
  const members = Object.keys(strengths);
  const orders: string[][] = [];
  for (let g = 0; g < games; g++) {
    let left = Array.from({ length: seats }, () => members[Math.floor(random() * members.length)]);
    const order: string[] = [];
    while (left.length > 0) {
      const total = left.reduce((sum, m) => sum + strengths[m], 0);
      let pick = random() * total;
      let k = 0;
      while (pick > strengths[left[k]]) pick -= strengths[left[k++]];
      k = Math.min(k, left.length - 1);
      order.push(left[k]);
      left = left.filter((_, i) => i !== k);
    }
    orders.push(order);
  }
  return orders;
}

test('the fit recovers known strengths from orders drawn by them', () => {
  const truth = { a: 1, b: 2, c: 4, d: 0.5 };
  const orders = draw(truth, 8000, 4, generator(3));
  const fitted = fitStrengths(orders, Object.keys(truth));
  const scale = (fitted.get('a') ?? 1) / truth.a;
  for (const [m, s] of Object.entries(truth)) {
    const ratio = (fitted.get(m) ?? 0) / scale / s;
    assert.ok(ratio > 0.9 && ratio < 1.1, `${m}: ${ratio}`);
  }
});

test('a member that always wins gets a finite rating, and the intervals contain the truth', () => {
  const orders = Array.from({ length: 50 }, () => ['best', 'x', 'y']);
  const fitted = fitStrengths(orders, ['best', 'x', 'y']);
  assert.ok(Number.isFinite(fitted.get('best')));
  const truth = { a: 1, b: 2 };
  const rated = rate(draw(truth, 3000, 2, generator(11)), ['a', 'b'], 'a', 50);
  const b = rated.find((r) => r.member === 'b');
  assert.ok(b && b.low < 100 && b.high > 100, `${b?.low} to ${b?.high}`);
  assert.equal(rated.find((r) => r.member === 'a')?.rating, 0);
});
