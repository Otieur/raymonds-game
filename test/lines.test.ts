import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { memberOf } from '../scripts/lines.ts';

const lines = JSON.parse(readFileSync(new URL('../assets/lines.json', import.meta.url), 'utf8')) as { lines: Record<string, { holder: string }> };

test('a line of succession stands for its holder, and any other name for itself', () => {
  for (const name of ['style-2', 'style-3', 'style-4', 'main-2']) {
    if (lines.lines[name]) assert.equal(memberOf(name), lines.lines[name].holder);
  }
  assert.equal(memberOf('baseline'), 'baseline');
  assert.equal(memberOf('balancer+againstLeader=2'), 'balancer+againstLeader=2');
  assert.equal(memberOf('model:/some/model.ts'), 'model:/some/model.ts');
});

test('a line with no holder is refused', () => {
  if (!lines.lines['main-3']) assert.throws(() => memberOf('main-3'), /No holder recorded for main-3/);
});
