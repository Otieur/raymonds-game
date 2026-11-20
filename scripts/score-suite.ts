/**
 * Scores league members on an offer suite (M9, task 7): the share of its cases each answers as measured.
 *
 *   node scripts/score-suite.ts --suite test/fixtures/offers-4.json --members baseline,refuser,found-4-b2t1p1c2,model:<path>
 *
 * Prints one line for each member (the share, its interval, and the cases right by template) and a
 * table of the share by template.
 */
import { readFileSync } from 'node:fs';
import { createEngine, SHORT_GAME_RULES, threeKingdoms } from '../src/index.ts';
import { memberAgent } from '../src/sim/league.ts';
import { describeScore, scoreSuite, TEMPLATES } from '../src/sim/offer-suite.ts';
import type { Suite } from '../src/sim/offer-suite.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import './model-loader.ts';

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const file = option('--suite');
if (!file) throw new Error('Give --suite <file>.');
const suite = JSON.parse(readFileSync(file, 'utf8')) as Suite;
const engine = suite.rules === 'short' ? createEngine(threeKingdoms, SHORT_GAME_RULES) : createEngine(threeKingdoms);
const ctx = contextOf(engine);
const members = (option('--members') ?? 'baseline').split(',').filter(Boolean);
const scores = members.map((name) => ({ name, score: scoreSuite(engine, ctx, suite, () => memberAgent(name)) }));
for (const { name, score } of scores) console.log(describeScore(name, score));
const used = TEMPLATES.filter((t) => suite.cases.some((c) => c.template === t));
const rows = used.map((t) => {
  const cases = suite.cases.filter((c) => c.template === t).length;
  return `| ${t} | ${cases} | ${scores.map(({ score }) => `${((100 * (score.byTemplate[t]?.right ?? 0)) / cases).toFixed(0)}%`).join(' | ')} |`;
});
console.log(['', `| Template | Cases | ${members.join(' | ')} |`, `| --- | ---: | ${members.map(() => '---:').join(' | ')} |`, ...rows].join('\n'));
