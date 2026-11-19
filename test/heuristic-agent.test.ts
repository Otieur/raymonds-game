import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chooseHeuristicAction,
  createAgentMemory,
  createEngine,
  heuristicAgent,
  simulateGame,
  threeKingdoms,
} from '../src/index.ts';
import { fixture } from './fixture.ts';
import { economy, engine, landOn, newGame, own, play, who } from './helpers.ts';

const never = () => 0;

test('heuristic players finish games on both boards without breaking a rule', () => {
  for (const board of [fixture, threeKingdoms]) {
    const game = createEngine(board);
    for (const players of [2, 4, 6]) {
      for (let seed = 1; seed <= 4; seed++) {
        const result = simulateGame(game, { players, seed, maxActions: 40000, agent: heuristicAgent() });
        assert.ok(result.finished, `${board.id}: ${players} players, seed ${seed}`);
      }
    }
  }
});

test('the agent only acts for a player the game is waiting on', () => {
  const state = newGame();
  assert.equal(chooseHeuristicAction(engine, state, 'b', never), null);
  assert.deepEqual(chooseHeuristicAction(engine, state, 'a', never), { type: 'ROLL', player: 'a' });
});

test('the agent buys what it can afford and sends the rest to auction', () => {
  const offered = landOn(newGame(), 'a', 'g1-2');
  assert.deepEqual(chooseHeuristicAction(engine, offered, 'a', never), { type: 'BUY', player: 'a' });

  who(offered, 'a').cash = 20;
  assert.deepEqual(chooseHeuristicAction(engine, offered, 'a', never), { type: 'DECLINE', player: 'a' });
});

test('the agent stretches for a street that completes its own group', () => {
  const state = newGame();
  own(state, 'a', 'g1-1');
  who(state, 'a').cash = 85;
  const offered = landOn(state, 'a', 'g1-2');
  assert.deepEqual(chooseHeuristicAction(engine, offered, 'a', never), { type: 'BUY', player: 'a' });
});

test('the agent stops bidding once the price passes what the property is worth to it', () => {
  const auction = play(landOn(newGame(), 'a', 'g1-2'), { type: 'DECLINE', player: 'a' });
  assert.deepEqual(chooseHeuristicAction(engine, auction, 'b', never), { type: 'BID', player: 'b', amount: 10 });

  const pricey = play(auction, { type: 'BID', player: 'c', amount: 200 });
  assert.deepEqual(chooseHeuristicAction(engine, pricey, 'b', never), { type: 'PASS', player: 'b' });
});

test('the agent sells the last street of a rival group only for a rich price', () => {
  const state = newGame();
  own(state, 'a', 'g1-1');
  own(state, 'b', 'g1-2');
  const offer = (cash: number) =>
    play(state, {
      type: 'PROPOSE_TRADE',
      player: 'a',
      to: 'b',
      give: { cash, properties: [], jailCards: 0 },
      receive: { cash: 0, properties: ['g1-2'], jailCards: 0 },
    });
  assert.deepEqual(chooseHeuristicAction(engine, offer(100), 'b', never), { type: 'REJECT_TRADE', player: 'b' });
  assert.deepEqual(chooseHeuristicAction(engine, offer(170), 'b', never), { type: 'ACCEPT_TRADE', player: 'b' });
});

test('with a memory, the agent offers cash for the street its group lacks, once a turn', () => {
  const state = newGame();
  own(state, 'a', 'g1-1');
  own(state, 'b', 'g1-2');
  state.turn.phase = 'postRoll';
  const memory = createAgentMemory();

  const first = chooseHeuristicAction(engine, state, 'a', never, memory);
  assert.equal(first?.type, 'PROPOSE_TRADE');
  if (first?.type !== 'PROPOSE_TRADE') return;
  assert.equal(first.to, 'b');
  assert.deepEqual(first.receive.properties, ['g1-2']);
  assert.ok(first.give.cash >= 80 * 1.3 && first.give.cash <= economy.startingCash);

  assert.deepEqual(chooseHeuristicAction(engine, state, 'a', never, memory), { type: 'END_TURN', player: 'a' });
  assert.deepEqual(chooseHeuristicAction(engine, state, 'a', never), { type: 'END_TURN', player: 'a' });
});
