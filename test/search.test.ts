import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode, encode, perturb } from '../scripts/search-styles.ts';
import { validateStyle } from '../src/sim/style.ts';
import { PRESETS } from '../src/sim/styles.ts';

function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

test('every plain preset survives the trip through a genome as a sound style', () => {
  for (const preset of Object.values(PRESETS)) {
    if (preset.playbook.rules.length > 0) continue;
    const style = decode(encode(preset.playbook.base), preset.name);
    assert.deepEqual(validateStyle(style), [], preset.name);
    assert.equal(style.buildTarget, preset.playbook.base.buildTarget, `${preset.name} build target`);
    assert.equal(Number.isFinite(style.acceptMargin), Number.isFinite(preset.playbook.base.acceptMargin), `${preset.name} refusing`);
  }
});

test('perturbed genomes always decode to sound styles, and the same seed gives the same child', () => {
  const random = generator(4);
  let genome = encode(PRESETS.baseline.playbook.base);
  for (let i = 0; i < 300; i++) {
    genome = perturb(genome, 0.3, random);
    assert.deepEqual(validateStyle(decode(genome, `child-${i}`)), []);
  }
  const a = perturb(encode(PRESETS.hoarder.playbook.base), 0.15, generator(9));
  const b = perturb(encode(PRESETS.hoarder.playbook.base), 0.15, generator(9));
  assert.deepEqual(a, b);
});

test('table politics: its genes are in the genome only when asked for, and survive the trip when they are', () => {
  const plain = encode(PRESETS.statesman.playbook.base, false);
  assert.ok(!('offerByValue' in plain) && !('againstLeader' in plain));
  // Without them a perturbation draws what it drew before the fields existed: the same child from the same seed.
  assert.deepEqual(perturb(encode(PRESETS.hoarder.playbook.base, false), 0.15, generator(9), false), perturb(encode(PRESETS.hoarder.playbook.base), 0.15, generator(9)));

  for (const name of ['statesman', 'reference-2', 'envoy', 'broker', 'scavenger', 'debtor', 'hunter', 'warden']) {
    const base = PRESETS[name].playbook.base;
    const style = decode(encode(base, true), name);
    assert.deepEqual(validateStyle(style), [], name);
    for (const key of ['offerBy', 'completeBy', 'earlyOffers', 'denyOffers', 'estateOffers', 'rescue', 'debtOffers', 'debtSales', 'courtAllies', 'answerBy', 'huntFailing', 'probeGap', 'denyRank'] as const) {
      assert.equal(style[key], base[key], `${name}.${key}`);
    }
    for (const key of ['openShare', 'maxShare', 'raiseStep', 'denyShare', 'againstLeader', 'forWeak', 'reciprocity'] as const) {
      assert.ok(Math.abs(style[key] - base[key]) < 1e-3, `${name}.${key}: ${style[key]} against ${base[key]}`);
    }
  }
  // A genome stored before the fields existed gains them from the baseline when it is perturbed with them.
  const random = generator(11);
  let genome = encode(PRESETS.baseline.playbook.base, false);
  for (let i = 0; i < 200; i++) {
    genome = perturb(genome, 0.3, random, true);
    assert.deepEqual(validateStyle(decode(genome, `table-child-${i}`)), []);
  }
  assert.ok('courtAllies' in genome);
});
