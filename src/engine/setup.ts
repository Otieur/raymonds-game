import type { Context } from '../context.ts';
import { randomInt, seedFrom, shuffle } from '../rng.ts';
import type { GameState, PlayerId, PlayerState } from '../types.ts';

export interface NewGameOptions {
  players: readonly (PlayerId | { id: PlayerId; name?: string })[];
  seed?: number | string;
  startingPlayer?: PlayerId;
}

function rollOff(state: GameState): PlayerId {
  let contenders = state.players.map((p) => p.id);
  while (contenders.length > 1) {
    const totals = contenders.map(() => 2 + randomInt(state, 6) + randomInt(state, 6));
    const best = Math.max(...totals);
    contenders = contenders.filter((_, i) => totals[i] === best);
  }
  return contenders[0];
}

export function newGame(ctx: Context, options: NewGameOptions): GameState {
  const { board, rules } = ctx;
  const players: PlayerState[] = options.players.map((entry) => {
    const id = typeof entry === 'string' ? entry : entry.id;
    const name = typeof entry === 'string' ? entry : (entry.name ?? entry.id);
    return {
      id,
      name,
      cash: board.economy.startingCash,
      position: 0,
      inJail: false,
      jailRolls: 0,
      jailCards: [],
      bankrupt: false,
    };
  });

  if (players.length < rules.minPlayers || players.length > rules.maxPlayers) {
    throw new Error(`A game needs ${rules.minPlayers} to ${rules.maxPlayers} players.`);
  }
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length || ids.has('')) {
    throw new Error('Player ids must be unique and non-empty.');
  }
  if (options.startingPlayer !== undefined && !ids.has(options.startingPlayer)) {
    throw new Error(`Starting player "${options.startingPlayer}" is not in the game.`);
  }

  const state: GameState = {
    schema: 1,
    board: board.id,
    players,
    properties: {},
    bank: { houses: board.economy.houses, hotels: board.economy.hotels },
    decks: {},
    turn: { player: players[0].id, number: 1, phase: 'preRoll', doubles: 0, lastRoll: null },
    pending: [],
    auctionQueue: [],
    rng: seedFrom(options.seed ?? Math.floor(Math.random() * 2 ** 32)),
    diceQueue: [],
    winner: null,
  };

  for (const sq of ctx.propertyOrder) {
    state.properties[sq.id] = { owner: null, mortgaged: false, level: 0 };
  }
  for (const [deckId, deck] of Object.entries(board.decks)) {
    state.decks[deckId] = shuffle(
      state,
      deck.map((card) => card.id),
    );
  }
  state.turn.player = options.startingPlayer ?? rollOff(state);
  return state;
}
