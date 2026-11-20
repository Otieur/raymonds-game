import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { memberAgent } from '../src/sim/league.ts';

const DIR = join(import.meta.dirname, '..', 'train', 'configs');
const configs = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, cfg: JSON.parse(readFileSync(join(DIR, f), 'utf8')) }));

test('every training configuration names members that exist, at sizes it plays', () => {
  for (const { file, cfg } of configs) {
    if (!cfg.members) continue;
    const lists: [string, string[]][] = Array.isArray(cfg.members) ? [['all', cfg.members]] : Object.entries(cfg.members);
    const sizes = new Set((cfg.games ?? []).map((g: { players: number }) => String(g.players)));
    for (const [size, names] of lists) {
      if (size !== 'all') assert.ok(sizes.has(size), `${file}: members for ${size} players, a size it does not play`);
      for (const name of names) if (!name.startsWith('model:')) assert.doesNotThrow(() => memberAgent(name), `${file}: ${name}`);
    }
    if (!Array.isArray(cfg.members)) for (const size of sizes) assert.ok(cfg.members[size as string], `${file}: no members for ${size} players`);
  }
});

test('every training configuration has games with positive shares, and checks the engine can play', () => {
  for (const { file, cfg } of configs) {
    if (cfg.games) {
      // Shares are relative weights: run.py divides them by their sum.
      for (const g of cfg.games) assert.ok(g.share > 0, `${file}: share ${g.share}`);
      for (const g of cfg.games) assert.ok([2, 3, 4].includes(g.players) && ['full', 'short'].includes(g.rules), `${file}: ${JSON.stringify(g)}`);
    }
    const checks = cfg.checks == null ? [] : Array.isArray(cfg.checks) ? cfg.checks : [cfg.checks];
    for (const check of checks) {
      assert.ok([2, 3, 4].includes(check.size), `${file}: check size ${check.size}`);
      assert.ok(check.rules === undefined || check.rules === 'full' || check.rules === 'short', `${file}: check rules ${check.rules}`);
      if (check.suite) assert.match(check.suite, /^test\/fixtures\/offers-\d(-short)?\.json$/, `${file}: suite ${check.suite}`);
    }
    if (cfg.drafting) {
      assert.ok(cfg.drafting.share >= 0 && cfg.drafting.share <= 1, `${file}: drafting share`);
      if (cfg.drafting.then !== undefined) assert.ok(cfg.drafting.then >= 0 && cfg.drafting.then <= 1 && cfg.drafting.at > 0 && cfg.drafting.at < 1, `${file}: drafting schedule`);
    }
  }
});
