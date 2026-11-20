import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import '../scripts/model-loader.ts';
import { ACTIONS, ACTIONS_VERSION } from '../src/env/actions.ts';
import { OBS_SIZE, OBS_VERSION } from '../src/env/observe.ts';
import { createEngine, isShortGame, SHORT_GAME_RULES, threeKingdoms } from '../src/index.ts';
import type { PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent } from '../src/sim/league.ts';
import type { SeatAgent } from '../src/sim/styles.ts';

/** A model of the exported form with every weight zero, written where `model:<path>` can name it. */
function tinyModel(): string {
  const shapes: [number, number][] = [[OBS_SIZE, 4], [4, 4], [4, 4], [4, ACTIONS], [4, 3]];
  const count = shapes.reduce((n, [inputs, outputs]) => n + inputs * outputs + outputs, 0);
  const model = { name: 'tiny', obsVersion: OBS_VERSION, actionsVersion: ACTIONS_VERSION, shapes, data: Buffer.alloc(count * 2).toString('base64') };
  const path = join(mkdtempSync(join(tmpdir(), 'model-member-')), 'tiny.ts');
  writeFileSync(path, `export const MODEL = ${JSON.stringify(model)};\n`);
  return path;
}

test('a member named model:<path> plays an exported model at a table, every action accepted', () => {
  const engine = createEngine(threeKingdoms);
  const path = tinyModel();
  const ids: PlayerId[] = ['p1', 'p2'];
  // The learner sits second, so that it observes the first player's actions before its own first decision.
  const agents = new Map<PlayerId, SeatAgent>([['p1', memberAgent('baseline')], ['p2', memberAgent(`model:${path}`)]]);
  const holder = { rng: seedFrom('model-member') };
  const random = () => nextFloat(holder);
  let state = engine.newGame({ players: ids, seed: 3 });
  let learned = 0;
  for (let i = 0; i < 800 && state.winner === null; i++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const action = agents.get(actor)?.choose(engine, state, actor, random);
    assert.ok(action, `${actor} has an action`);
    const result = engine.apply(state, action);
    assert.ok(result.ok, `${JSON.stringify(action)} is accepted`);
    state = result.state;
    for (const agent of agents.values()) agent.observe(result.events, state);
    if (actor === 'p2') learned += 1;
  }
  assert.ok(learned > 20);
  assert.deepEqual(engine.checkInvariants(state), []);
});

test('a model member names a file that must exist', () => {
  assert.throws(() => memberAgent('model:/no/such/model.ts'));
});

test('model members: ?own lets the network draft and plays a full game; ?trade=<school> lets the school answer offers', () => {
  const engine = createEngine(threeKingdoms);
  const path = tinyModel();
  // A full game with the network drafting its own offers: every action is accepted.
  const agents = new Map<PlayerId, SeatAgent>([['p1', memberAgent('baseline')], ['p2', memberAgent(`model:${path}?own`)]]);
  const holder = { rng: seedFrom('model-own') };
  const random = () => nextFloat(holder);
  let state = engine.newGame({ players: ['p1', 'p2'], seed: 4 });
  for (let i = 0; i < 800 && state.winner === null; i++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const action = agents.get(actor)?.choose(engine, state, actor, random);
    assert.ok(action);
    const result = engine.apply(state, action);
    assert.ok(result.ok, `${JSON.stringify(action)} is accepted`);
    state = result.state;
    for (const agent of agents.values()) agent.observe(result.events, state);
  }
  // An offer to the model's seat: the all-zero network takes the first legal answer (accept); the refuser, answering for it, refuses.
  const offered = engine.newGame({ players: ['p1', 'p2'], seed: 5, startingPlayer: 'p1' });
  offered.properties['hulao-pass'].owner = 'p2';
  offered.turn.phase = 'postRoll';
  offered.pending = [{ kind: 'trade', offer: { from: 'p1', to: 'p2', give: { cash: 10, properties: [], jailCards: 0 }, receive: { cash: 0, properties: ['hulao-pass'], jailCards: 0 } } }];
  const answer = (name: string) => memberAgent(name).choose(engine, offered, 'p2', () => 0.5)?.type;
  assert.equal(answer(`model:${path}`), 'ACCEPT_TRADE');
  assert.equal(answer(`model:${path}?trade=refuser`), 'REJECT_TRADE');
  assert.throws(() => memberAgent(`model:${path}?drafts`), /Unknown option/);
  assert.throws(() => memberAgent(`model:${path}?trade=nobody`), /No school named nobody/);
});

test('the short game is recognised from an engine\'s rules', () => {
  assert.equal(isShortGame(createEngine(threeKingdoms, SHORT_GAME_RULES).rules), true);
  assert.equal(isShortGame(createEngine(threeKingdoms).rules), false);
});
