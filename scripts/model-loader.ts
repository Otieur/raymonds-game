/**
 * Lets league members be named `model:<path>` in the Node scripts: reads a model exported by
 * train/export.py from its path. Imported for its effect by the scripts that play members.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { ModelWeights } from '../src/env/mlp.ts';
import { setModelLoader } from '../src/sim/league.ts';

const load = createRequire(import.meta.url);
setModelLoader((path) => (load(resolve(path)) as { MODEL: ModelWeights }).MODEL);
