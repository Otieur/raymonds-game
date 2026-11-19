import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePaired, outcomesFor, pairedDifference, wilson } from '../src/sim/intervals.ts';

const near = (actual: number, expected: number, digits = 9) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ${expected}`);

test('identical series differ by nothing, with no width', () => {
  const d = pairedDifference([1, 0, 1, 0, 0], [1, 0, 1, 0, 0]);
  assert.equal(d.games, 5);
  near(d.difference, 0);
  near(d.low, 0);
  near(d.high, 0);
  near(d.correlation, 1);
  assert.ok(d.independentHalf > 0);
});

test('the interval comes from the differences by seed', () => {
  // d = [1, 0, 0, 1]: mean 0.5, sample variance 1/3, standard error sqrt(1/12).
  const d = pairedDifference([1, 0, 1, 1], [0, 0, 1, 0]);
  assert.equal(d.games, 4);
  near(d.a, 0.75);
  near(d.b, 0.25);
  near(d.difference, 0.5);
  near(d.high - d.difference, 1.96 * Math.sqrt(1 / 12));
  near(d.difference - d.low, 1.96 * Math.sqrt(1 / 12));
});

test('seeds where either game did not finish are left out', () => {
  const d = pairedDifference([1, -1, 0, 1], [0, 1, -1, 1]);
  assert.equal(d.games, 2);
  near(d.a, 1);
  near(d.b, 0.5);
});

test('related series get a narrower interval than independent ones would', () => {
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < 400; i++) {
    const shared = i % 4 === 0 ? 1 : 0;
    a.push(shared || i % 13 === 0 ? 1 : 0);
    b.push(shared);
  }
  const d = pairedDifference(a, b);
  assert.ok(d.correlation > 0.5);
  assert.ok(d.high - d.difference < d.independentHalf);
});

test('series of different lengths or with bad outcomes are refused', () => {
  assert.throws(() => pairedDifference([1, 0], [1]), /different seeds/);
  assert.throws(() => pairedDifference([1, 2], [1, 0]), /not 1, 0 or -1/);
});

test('too few common seeds give no interval', () => {
  const d = pairedDifference([1, -1], [0, 1]);
  assert.equal(d.games, 1);
  assert.ok(Number.isNaN(d.low));
});

test('the description quotes the figures in points', () => {
  const text = describePaired(pairedDifference([1, 0, 1, 1], [0, 0, 1, 0]));
  assert.match(text, /^Paired by seed: 50\.0 points \(-6\.6 to 106\.6\) over 4 seeds/);
});

test('Wilson\'s interval holds the share', () => {
  const [low, high] = wilson(30, 100);
  assert.ok(low < 0.3 && high > 0.3);
  near(low, 0.2189, 3);
  near(high, 0.3958, 3);
  assert.ok(wilson(0, 0).every(Number.isNaN));
});

test('a set of seats wins when any of them does', () => {
  assert.deepEqual(outcomesFor([2, 3, 0, -1, 1], [2, 3]), [1, 1, 0, -1, 0]);
  assert.deepEqual(outcomesFor([0, 1], [0]), [1, 0]);
});
