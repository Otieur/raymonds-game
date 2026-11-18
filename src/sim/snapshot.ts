/**
 * Snapshots of positions from simulated games, one JSON line each, and the state rebuilt from a
 * line. The valuation is fitted from these files, and the intervention study plays positions on
 * from them.
 */
import type { Context } from '../context.ts';
import { newGame } from '../engine/setup.ts';
import { seedFrom } from '../rng.ts';
import type { GameState, PlayerState } from '../types.ts';

export interface SnapshotRow {
  v: 1;
  /** The study table the game came from, such as `full-4`. */
  table: string;
  seed: number;
  /** Rounds played: the snapshot is taken as turn `round * n + 1` begins. */
  round: number;
  /** Seats at the start of the game. */
  n: number;
  /** The seat whose turn is beginning. */
  turn: number;
  /** One entry for each seat, in the order of play. */
  cash: number[];
  pos: number[];
  jail: number[];
  /** One character for each property, in the order of the board: `.` for the bank or the owner's seat. */
  own: string;
  /** Building level, 0 to 5, one digit for each property. */
  lvl: string;
  /** 1 for a mortgaged property. */
  mort: string;
  /** Farmsteads and fortresses left in the bank. */
  bank: [number, number];
  /** The seat that won. */
  win: number;
  /** For each seat, the turn on which it went bankrupt, or 0. */
  gone: number[];
  /** The length of the game in turns. */
  turns: number;
}

export type OpenRow = Omit<SnapshotRow, 'win' | 'gone' | 'turns'>;

/** The snapshot of a state at the start of a turn, before the game's end is known. */
export function snapshotOf(ctx: Context, state: GameState, meta: { table: string; seed: number; round: number; n: number }): OpenRow {
  const seat = new Map(state.players.map((p, i) => [p.id, i]));
  let own = '';
  let lvl = '';
  let mort = '';
  for (const sq of ctx.propertyOrder) {
    const property = state.properties[sq.id];
    own += property.owner === null ? '.' : String(seat.get(property.owner));
    lvl += String(property.level);
    mort += property.mortgaged ? '1' : '0';
  }
  return {
    v: 1,
    ...meta,
    turn: seat.get(state.turn.player) ?? 0,
    cash: state.players.map((p) => p.cash),
    pos: state.players.map((p) => p.position),
    jail: state.players.map((p) => (p.inJail ? 1 : 0)),
    own,
    lvl,
    mort,
    bank: [state.bank.houses, state.bank.hotels],
  };
}

/** The ids the study gives to the seats of a game: p1, p2, and so on, in the order of play. */
export const seatIds = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Whether the seat is out of the game at the snapshot. */
export function isOut(row: SnapshotRow, seat: number): boolean {
  const gone = row.gone[seat];
  return gone > 0 && gone < row.round * row.n + 1;
}

/**
 * A state rebuilt from a snapshot: players, properties and the bank as they were, the turn
 * beginning, nothing pending. Cards a player held to leave jail are not recorded, so they are
 * back in their decks, which are shuffled from `seed` (the game's own seed by default).
 */
export function stateOf(ctx: Context, row: SnapshotRow, seed: number | string = row.seed): GameState {
  const ids = seatIds(row.n);
  const numeric = typeof seed === 'number' ? seed : seedFrom(seed);
  const state = newGame(ctx, { players: ids, seed: numeric, startingPlayer: ids[0] });
  state.players = ids.map(
    (id, i): PlayerState => ({
      id,
      name: id,
      cash: isOut(row, i) ? 0 : row.cash[i],
      position: row.pos[i],
      inJail: row.jail[i] === 1 && !isOut(row, i),
      jailRolls: 0,
      jailCards: [],
      bankrupt: isOut(row, i),
    }),
  );
  ctx.propertyOrder.forEach((sq, k) => {
    const owner = row.own[k];
    state.properties[sq.id] = {
      owner: owner === '.' ? null : ids[Number(owner)],
      level: Number(row.lvl[k]),
      mortgaged: row.mort[k] === '1',
    };
  });
  state.bank = { houses: row.bank[0], hotels: row.bank[1] };
  state.turn = { player: ids[row.turn], number: row.round * row.n + 1, phase: 'preRoll', doubles: 0, lastRoll: null };
  return state;
}
