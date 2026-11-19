/**
 * The debt window. The rules let any player propose a trade whenever no decision is open, and while a
 * debt is open they allow trades that involve the debtor. Agents act only when the engine awaits
 * them, so nobody ever offered for a debtor's property at the moment it could not pay. A driver that
 * calls `debtWindow` before asking the awaited seat gives the other seats that moment.
 *
 * Only agents that have a `window` are asked, and an agent whose style does not offer at a debt
 * answers without drawing a random number, so games among today's agent are unchanged, draw for draw.
 */
import type { Engine } from '../engine/engine.ts';
import type { Action, GameState, PlayerId } from '../types.ts';
import type { SeatAgent } from './styles.ts';

/** Which seats have been asked at the debt now open. Keep one for a whole game. */
export interface DebtWindows {
  key: string;
  asked: Set<PlayerId>;
}

export const createDebtWindows = (): DebtWindows => ({ key: '', asked: new Set() });

/**
 * When a debt is open that the debtor's cash does not cover: the next offer to the debtor from a
 * seat that has not yet been asked at this debt, in the order of play after the debtor, leaving out
 * the creditor. Null when nobody (else) offers; the driver then asks the awaited seat as usual.
 */
export function debtWindow(
  engine: Engine,
  state: GameState,
  agentOf: (id: PlayerId) => SeatAgent | undefined,
  random: () => number,
  windows: DebtWindows,
): { actor: PlayerId; action: Action } | null {
  const top = state.pending[state.pending.length - 1];
  if (!top || top.kind !== 'debt') return null;
  const start = state.players.findIndex((p) => p.id === top.debtor);
  if (start === -1 || state.players[start].cash >= top.amount) return null;
  const key = `${state.turn.number}:${top.debtor}:${top.creditor}:${top.amount}`;
  if (windows.key !== key) {
    windows.key = key;
    windows.asked = new Set();
  }
  for (let k = 1; k < state.players.length; k++) {
    const seat = state.players[(start + k) % state.players.length];
    if (seat.bankrupt || seat.id === top.creditor || windows.asked.has(seat.id)) continue;
    windows.asked.add(seat.id);
    const action = agentOf(seat.id)?.window?.(engine, state, seat.id, random) ?? null;
    if (action) return { actor: seat.id, action };
  }
  return null;
}
