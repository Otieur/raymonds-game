/**
 * Measures learner decisions a second through the environment in this process, with random legal
 * actions for the learner and rule-based players in the other seats.
 *
 *   node scripts/bench-env.ts [--size 4] [--games 200] [--no-valuation] [--drafting]
 */
import { legalIndices } from '../src/env/actions.ts';
import { createEnv, DEFAULT_CONFIG } from '../src/env/env.ts';

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const size = Number(option('--size') ?? 4) as 2 | 3 | 4;
const games = Number(option('--games') ?? 200);
const env = createEnv({
  ...DEFAULT_CONFIG,
  players: size,
  drafting: process.argv.includes('--drafting'),
  valuation: !process.argv.includes('--no-valuation'),
  potentials: ['value'],
});
let state = 12345;
const random = () => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};
let step = env.reset();
let decisions = 0;
let played = 0;
let forced = 0;
const started = performance.now();
while (played < games) {
  if (step.done) {
    played += 1;
    forced += step.info.forced;
    step = env.step(0);
    continue;
  }
  const legal = legalIndices(step.legal);
  decisions += 1;
  step = env.step(legal[Math.floor(random() * legal.length)]);
}
const seconds = (performance.now() - started) / 1000;
console.log(
  `${size} players, ${games} games, valuation ${process.argv.includes('--no-valuation') ? 'off' : 'on'}, drafting ${process.argv.includes('--drafting') ? 'on' : 'off'}: ` +
    `${decisions} learner decisions in ${seconds.toFixed(1)} s, ${(decisions / seconds).toFixed(0)} a second; ${(forced / games).toFixed(1)} forced moves a game.`,
);
