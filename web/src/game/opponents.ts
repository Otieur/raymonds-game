/**
 * The opponents this build offers. The lines of succession come from `assets/lines.json`; the learned
 * models from `assets/models/`, each a module written by train/export.py beside a record (`<line>.json`)
 * whose `holder` names the member it was exported from, so that only a line's holder is offered. The
 * app's build carries the models inside its one script; the dev server loads each on first use.
 *
 * In the dev server only, models put in `assets/models/dev/` (not committed) are offered too, as
 * development opponents for every table, whatever the lines say.
 */
import lines from '../../../assets/lines.json';
import type { ModelWeights } from '../../../src/env/mlp.ts';
import { opponentFor as offeredOpponent, opponentsFor as offeredOpponents } from '../../../src/sim/opponents.ts';
import type { Lines, Mode, Opponent, ShippedModel } from '../../../src/sim/opponents.ts';
import { brainAgent } from './brain.ts';

type Size = 2 | 3 | 4;

const LINES = lines as Lines;

const modules = import.meta.glob<ModelWeights>('../../../assets/models/*.ts', { import: 'MODEL' });
const records = import.meta.glob<{ holder?: string }>('../../../assets/models/*.json', { eager: true, import: 'default' });
const devModules = import.meta.env.DEV ? import.meta.glob<ModelWeights>('../../../assets/models/dev/*.ts', { import: 'MODEL' }) : {};

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.(ts|json)$/, '');

const SHIPPED: Record<string, ShippedModel> = {};
for (const [path, load] of Object.entries(modules)) {
  const holder = records[path.replace(/\.ts$/, '.json')]?.holder;
  if (!holder) {
    console.warn(`assets/models/${baseName(path)}.ts has no record naming the member it was exported from; it is not offered.`);
    continue;
  }
  SHIPPED[baseName(path)] = { holder, create: (query, mode) => brainAgent(load, query, mode) };
}

function devOpponents(mode: Mode): Opponent[] {
  return Object.entries(devModules).map(([path, load]) => ({
    id: `dev-${baseName(path)}`,
    level: null,
    sizes: [2, 3, 4],
    modes: ['regular', 'short'],
    name: { zh: `开发模型 ${baseName(path)}`, en: `Development model ${baseName(path)}` },
    describe: {
      zh: '只在开发服务器里出现：assets/models/dev/ 里的模型，交易由常规打法代提。',
      en: 'Dev server only: a model from assets/models/dev/, its offers made by the standard player.',
    },
    create: () => brainAgent(load, '', mode),
  }));
}

/** Every opponent that can sit at a table of `size` in `mode`, the default first. */
export function opponentsFor(size: Size, mode: Mode): Opponent[] {
  return [...offeredOpponents(size, mode, LINES, SHIPPED), ...devOpponents(mode)];
}

/** The opponent with this id, or the one that takes its place at this table (see `src/sim/opponents.ts`). */
export function opponentFor(id: string | undefined, size: Size, mode: Mode): Opponent {
  return devOpponents(mode).find((o) => o.id === id) ?? offeredOpponent(id, size, mode, LINES, SHIPPED);
}
