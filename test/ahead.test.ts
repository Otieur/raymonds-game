import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseHeuristicAction, createAgentMemory, createEngine, threeKingdoms } from '../src/index.ts';
import type { PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent } from '../src/sim/league.ts';
import type { Opponent } from '../src/sim/opponents.ts';
import { PRESETS } from '../src/sim/styles.ts';
import { chancesNow, percentages } from '../web/src/game/ahead.ts';
import { INTENT_WORDS, intentWords } from '../web/src/game/intents.ts';
import { Seats } from '../web/src/game/seats.ts';

const engine = createEngine(threeKingdoms);

test('percentages: whole numbers that add up to exactly 100, a bankrupt seat at 0', () => {
  assert.deepEqual(percentages([1 / 3, 1 / 3, 1 / 3]), [34, 33, 33]);
  assert.deepEqual(percentages([0.5, 0.5, 0]), [50, 50, 0]);
  assert.deepEqual(percentages([0, 0]), [0, 0]);
  const holder = { rng: seedFrom('percentages') };
  for (let k = 0; k < 2000; k++) {
    const shares = Array.from({ length: 2 + (k % 3) }, () => (nextFloat(holder) < 0.2 ? 0 : nextFloat(holder)));
    if (shares.every((s) => s === 0)) continue;
    const out = percentages(shares);
    assert.equal(out.reduce((a, b) => a + b, 0), 100, JSON.stringify(shares));
    shares.forEach((s, i) => {
      if (s === 0) assert.equal(out[i], 0);
    });
  }
});

test("the strip's figures add up to 100 at every moment of a recorded game", () => {
  for (const [size, seed] of [[4, 3], [3, 8], [2, 5]] as const) {
    const ids: PlayerId[] = ['wei', 'shu', 'wu', 'qun'].slice(0, size);
    const memory = createAgentMemory();
    const holder = { rng: seedFrom(`strip-${size}`) };
    let state = engine.newGame({ players: ids, seed });
    let read = 0;
    for (let i = 0; i < 4000 && state.winner === null; i++) {
      if (state.turn.phase !== 'order') {
        const figures = chancesNow(engine, state);
        assert.equal(figures.reduce((a, b) => a + b, 0), 100, `${size} players, action ${i}`);
        state.players.forEach((p, k) => {
          if (p.bankrupt) assert.equal(figures[k], 0);
        });
        read += 1;
      }
      const actor = engine.awaiting(state)[0];
      const result = engine.apply(state, chooseHeuristicAction(engine, state, actor, () => nextFloat(holder), memory) ?? { type: 'END_TURN', player: actor });
      assert.ok(result.ok);
      state = result.state;
    }
    assert.ok(read > 100);
  }
});

test('every rule of the playbooks offered has words in both languages, and a seat reports the rules it has on', async () => {
  for (const preset of ['opportunist', 'statesman-book-2']) {
    for (const rule of PRESETS[preset].playbook.rules) {
      const words = INTENT_WORDS[preset][rule.name];
      assert.ok(words?.zh && words.en, `${preset}: ${rule.name}`);
    }
  }
  // The later rules first: they override the earlier ones.
  assert.equal(intentWords('school-opportunist', ['opening', 'build out', 'behind'], 'en'), 'behind: dealing · building out');
  // The Statesman's ladder is named by its last rule on.
  assert.equal(intentWords('school-statesman-book-2', ['nobody ahead', 'a rival ahead'], 'zh'), '合纵抗强');
  assert.equal(intentWords('school-statesman-book-2', ['ahead'], 'zh'), '扶弱收残');
  assert.equal(intentWords('rules', ['ahead'], 'en'), '');

  const opportunist: Opponent = {
    id: 'school-opportunist', level: null, sizes: [3, 4], modes: ['regular'], name: { zh: '', en: '' }, describe: { zh: '', en: '' },
    create: () => memberAgent('opportunist'),
  };
  const seats = new Seats(engine, [{ id: 'wei', opponent: opportunist }]);
  const memory = createAgentMemory();
  let state = engine.newGame({ players: ['wei', 'shu', 'wu'], seed: 4 });
  let reported = false;
  for (let i = 0; i < 600 && state.winner === null; i++) {
    const actor = engine.awaiting(state)[0];
    const action = actor === 'wei' ? await seats.ask(state, actor, Math.random) : chooseHeuristicAction(engine, state, actor, Math.random, memory);
    const result = engine.apply(state, action ?? { type: 'END_TURN', player: actor });
    assert.ok(result.ok);
    state = result.state;
    seats.observe(result.events, state);
    const doing = seats.intent('wei');
    if (doing && doing.rules.length > 0) {
      assert.equal(doing.opponent, 'school-opportunist');
      reported = true;
    }
  }
  assert.ok(reported, 'the Opportunist reported its rules');
  assert.equal(seats.intent('shu'), null, 'a seat without a computer opponent reports nothing');
});
