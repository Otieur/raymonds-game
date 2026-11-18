/**
 * Checks an exported model against a fixture written by train/fixture.py: the TypeScript forward
 * pass must give the same outputs as PyTorch within 1e-3, and the same most likely legal action
 * in at least 999 cases of 1,000.
 *
 *   node scripts/check-model.ts --model assets/models/<name>.ts --fixture <file.json>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMlp } from '../src/env/mlp.ts';
import type { ModelWeights } from '../src/env/mlp.ts';

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const { MODEL } = (await import(pathToFileURL(resolve(option('--model') as string)).href)) as { MODEL: ModelWeights };
const fixture = JSON.parse(readFileSync(option('--fixture') as string, 'utf8')) as { obs: number[][]; mask: number[][]; logits: number[][]; value: number[][] };
const mlp = createMlp(MODEL);
let worst = 0;
let same = 0;
const started = performance.now();
fixture.obs.forEach((obs, i) => {
  const { policy, value } = mlp.forward(Float32Array.from(obs));
  const expected = fixture.logits[i];
  for (let a = 0; a < policy.length; a++) worst = Math.max(worst, Math.abs(policy[a] - expected[a]));
  for (let k = 0; k < value.length; k++) worst = Math.max(worst, Math.abs(value[k] - fixture.value[i][k]));
  const pick = (scores: ArrayLike<number>) => {
    let best = -1;
    let top = -Infinity;
    for (let a = 0; a < scores.length; a++) if (fixture.mask[i][a] && scores[a] > top) [top, best] = [scores[a], a];
    return best;
  };
  if (pick(policy) === pick(expected)) same += 1;
});
const n = fixture.obs.length;
const ms = (performance.now() - started) / n;
console.log(`${MODEL.name}: largest difference ${worst.toExponential(2)}; same most likely legal action in ${same} of ${n}; ${ms.toFixed(2)} ms a decision.`);
process.exit(worst < 1e-3 && same >= Math.ceil(0.999 * n) ? 0 : 1);
