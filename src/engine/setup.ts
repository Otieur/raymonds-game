import type { Context } from '../context.ts';
import { seedFrom, shuffle } from '../rng.ts';
import type { GameState, PlayerId, PlayerState, PropertySquare } from '../types.ts';

export interface NewGameOptions {
  players: readonly (PlayerId | { id: PlayerId; name?: string })[];
  seed?: number | string;
  /**
   * Skips the opening roll: this player starts and the rest follow in the order given.
   * Without it the game opens with every player rolling for the order of play.
   */
  startingPlayer?: PlayerId;
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
    opening: null,
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
  dealStartingDeeds(ctx, state);
  if (options.startingPlayer !== undefined) {
    state.turn.player = options.startingPlayer;
  } else {
    state.turn.phase = 'order';
    state.opening = { round: 1, groups: [players.map((p) => p.id)], rolls: {} };
  }
  return state;
}

/** Deals title deeds one at a time around the table; each player pays the printed price. */
function dealStartingDeeds(ctx: Context, state: GameState): void {
  const perPlayer = ctx.rules.startingDeeds;
  if (perPlayer === 0) return;
  const needed = perPlayer * state.players.length;
  if (needed > ctx.propertyOrder.length) {
    throw new Error(
      `Dealing ${perPlayer} deeds to ${state.players.length} players needs ${needed} properties; the board has ${ctx.propertyOrder.length}.`,
    );
  }
  const pack = shuffle(
    state,
    ctx.propertyOrder.map((sq) => sq.id),
  );
  for (let round = 0; round < perPlayer; round++) {
    for (const player of state.players) {
      const sq = ctx.properties.get(pack.shift() as string) as PropertySquare;
      if (player.cash < sq.price) {
        throw new Error(`${player.id} cannot pay ${sq.price} for the dealt deed ${sq.name}.`);
      }
      player.cash -= sq.price;
      state.properties[sq.id].owner = player.id;
    }
  }
}
