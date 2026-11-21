import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ACTIONS } from '../src/env/actions.ts';
import { createMlp } from '../src/env/mlp.ts';
import type { ModelWeights } from '../src/env/mlp.ts';
import { OBS_SIZE } from '../src/env/observe.ts';
import { createEngine, SHORT_GAME_RULES, threeKingdoms } from '../src/index.ts';
import type { PlayerId } from '../src/index.ts';
import { memberAgent } from '../src/sim/league.ts';
import { DEFAULT_OPPONENT, opponentFor, opponentsFor } from '../src/sim/opponents.ts';
import type { Lines, Mode, OpponentAgent } from '../src/sim/opponents.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';

const lines = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'assets', 'lines.json'), 'utf8')) as Lines;
const GAMES = Number(process.env.OPPONENT_GAMES ?? 1); // M10's check plays 200: OPPONENT_GAMES=200

test('the opponents offered: the rule-based agent first, characters by size, the style line\'s holder, a learned one only when shipped', () => {
  for (const size of [2, 3, 4] as const) {
    const offered = opponentsFor(size, 'regular', lines);
    assert.equal(offered[0].id, DEFAULT_OPPONENT);
    assert.equal(offered[0].level, 1);
    assert.equal(offered.some((o) => o.id === 'school-statesman-book-2'), size > 2, `statesman at ${size}`);
    assert.ok(offered.some((o) => o.id === `style-${size}` && o.level === 3), `style holder at ${size}`);
    assert.ok(!offered.some((o) => o.level === 4));
    for (const o of offered) {
      assert.ok(o.sizes.includes(size) && o.name.zh && o.name.en && o.describe.zh && o.describe.en, o.id);
      assert.equal(new Set(offered.map((x) => x.id)).size, offered.length);
    }
  }
  const holder = lines.lines['main-2'].holder;
  const shipped = { 'main-2': { holder, create: async () => memberAgent('rules') } };
  assert.ok(opponentsFor(2, 'regular', lines, shipped).some((o) => o.id === 'main-2' && o.level === 4));
  assert.ok(!opponentsFor(2, 'short', lines, shipped).some((o) => o.id === 'main-2'));
  assert.ok(!opponentsFor(3, 'regular', lines, shipped).some((o) => o.id === 'main-2'));
  // A shipped model that no longer holds its line is not offered.
  const stale = { 'main-2': { holder: 'model:an-older-export.ts', create: async () => memberAgent('rules') } };
  assert.ok(!opponentsFor(2, 'regular', lines, stale).some((o) => o.id === 'main-2'));
  // A choice that cannot sit at the table falls back: a character to the default, a level to the nearest below.
  assert.equal(opponentFor('school-statesman-book-2', 2, 'regular', lines).id, DEFAULT_OPPONENT);
  assert.equal(opponentFor('nobody', 3, 'short', lines).id, DEFAULT_OPPONENT);
  assert.equal(opponentFor('school-dealer', 3, 'short', lines).id, 'school-dealer');
  assert.equal(opponentFor('main-2', 2, 'regular', lines).id, 'style-2');
  assert.equal(opponentFor('main-2', 2, 'short', lines, shipped).id, 'style-2');
  assert.equal(opponentFor('main-2', 2, 'regular', lines, shipped).id, 'main-2');
  assert.equal(opponentFor('style-3', 2, 'regular', lines).id, 'style-2');
});

test('every opponent plays full games at each of its sizes, in both modes, with every action accepted', async () => {
  for (const mode of ['regular', 'short'] as Mode[]) {
    const engine = mode === 'short' ? createEngine(threeKingdoms, SHORT_GAME_RULES) : createEngine(threeKingdoms);
    for (const size of [2, 3, 4] as const) {
      for (const opponent of opponentsFor(size, mode, lines)) {
        for (let game = 0; game < GAMES; game++) {
          const ids: PlayerId[] = Array.from({ length: size }, (_, i) => `p${i + 1}`);
          const agents = new Map<PlayerId, OpponentAgent>();
          for (const [i, id] of ids.entries()) agents.set(id, i === 0 ? await opponent.create() : memberAgent('rules'));
          const holder = { rng: seedFrom(`opponents-${opponent.id}-${size}-${mode}-${game}`) };
          const random = () => nextFloat(holder);
          let state = engine.newGame({ players: ids, seed: 9000 + game });
          for (let actions = 0; state.winner === null && actions < 40000; actions++) {
            const waiting = engine.awaiting(state);
            const actor = waiting[Math.floor(random() * waiting.length)];
            const action = await agents.get(actor)?.choose(engine, state, actor, random);
            assert.ok(action, `${opponent.id} at ${size} (${mode}): ${actor} has an action`);
            const result = engine.apply(state, action);
            assert.ok(result.ok, `${opponent.id} at ${size} (${mode}): ${JSON.stringify(action)}`);
            state = result.state;
            for (const agent of agents.values()) agent.observe(result.events, state);
          }
        }
      }
    }
  }
});

test('every shipped model loads and is the holder of its line', async () => {
  const dir = join(import.meta.dirname, '..', 'assets', 'models');
  const records = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('._')) : [];
  for (const name of records) {
    const record = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { line: string; holder: string };
    assert.equal(record.line, name.replace(/\.json$/, ''), `${name} names its own line`);
    assert.equal(record.holder, lines.lines[record.line]?.holder, `${name}: its line is now held by another member; ship that one`);
    const { MODEL } = (await import(join(dir, name.replace(/\.json$/, '.ts')))) as { MODEL: ModelWeights };
    const mlp = createMlp(MODEL);
    assert.equal(mlp.forward(new Float32Array(OBS_SIZE)).policy.length, ACTIONS);
  }
});
