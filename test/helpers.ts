import assert from 'node:assert/strict';
import { createEngine, HOTEL_LEVEL } from '../src/index.ts';
import type {
  Action,
  CardId,
  DeckId,
  Dice,
  ErrorCode,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  PropertyId,
  PropertySquare,
  SquareId,
  StreetSquare,
} from '../src/index.ts';
import { fixture } from './fixture.ts';

export const board = fixture;
export const engine = createEngine(fixture);
export const economy = fixture.economy;
export const size = fixture.squares.length;

export function newGame(players: PlayerId[] = ['a', 'b', 'c']): GameState {
  return engine.newGame({ players, seed: 42, startingPlayer: players[0] });
}

export function play(state: GameState, ...actions: Action[]): GameState {
  let current = state;
  for (const action of actions) {
    current = playWithEvents(current, action).state;
  }
  return current;
}

export function playWithEvents(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const result = engine.apply(state, action);
  if (!result.ok) {
    assert.fail(`${action.type} was rejected: ${result.error.code} (${result.error.message})`);
  }
  assert.deepEqual(engine.checkInvariants(result.state), []);
  return { state: result.state, events: result.events };
}

export function rejects(state: GameState, action: Action, code: ErrorCode): void {
  const result = engine.apply(state, action);
  if (result.ok) assert.fail(`${action.type} should have been rejected with ${code}.`);
  assert.equal(result.error.code, code);
}

export function who(state: GameState, id: PlayerId): PlayerState {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error(`No player "${id}".`);
  return player;
}

export function indexOf(squareId: SquareId): number {
  const index = fixture.squares.findIndex((sq) => sq.id === squareId);
  if (index < 0) throw new Error(`No square "${squareId}".`);
  return index;
}

export function property(id: PropertyId): PropertySquare {
  const sq = fixture.squares[indexOf(id)];
  if (sq.kind !== 'street' && sq.kind !== 'transit' && sq.kind !== 'utility') {
    throw new Error(`"${id}" is not a property.`);
  }
  return sq;
}

export function street(id: PropertyId): StreetSquare {
  const sq = property(id);
  if (sq.kind !== 'street') throw new Error(`"${id}" is not a street.`);
  return sq;
}

export function own(state: GameState, player: PlayerId, ...ids: PropertyId[]): void {
  for (const id of ids) state.properties[id].owner = player;
}

export function build(state: GameState, levels: Record<PropertyId, number>): void {
  for (const [id, level] of Object.entries(levels)) state.properties[id].level = level;
  let houses = 0;
  let hotels = 0;
  for (const item of Object.values(state.properties)) {
    if (item.level === HOTEL_LEVEL) hotels += 1;
    else houses += item.level;
  }
  state.bank = { houses: economy.houses - houses, hotels: economy.hotels - hotels };
}

export function roll(state: GameState, ...dice: Dice[]): void {
  state.diceQueue.push(...dice);
}

export function landOn(state: GameState, player: PlayerId, squareId: SquareId, dice: Dice = [1, 2]): GameState {
  who(state, player).position = (indexOf(squareId) - dice[0] - dice[1] + size) % size;
  state.diceQueue.unshift(dice);
  return play(state, { type: 'ROLL', player });
}

export function stack(state: GameState, deck: DeckId, card: CardId): void {
  state.decks[deck] = [card, ...state.decks[deck].filter((id) => id !== card)];
}

export function giveJailCard(state: GameState, player: PlayerId, deck: DeckId, card: CardId): void {
  state.decks[deck] = state.decks[deck].filter((id) => id !== card);
  who(state, player).jailCards.push({ deck, card });
}

export function jail(state: GameState, player: PlayerId): void {
  const p = who(state, player);
  p.inJail = true;
  p.jailRolls = 0;
  p.position = indexOf('jail');
}
