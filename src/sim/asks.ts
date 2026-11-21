/**
 * How often a computer seat may make offers (M10's `maxAsks`): at most `maxAsks` offers in one turn
 * (one 回合, as the client numbers them), counted across every seat it asks. Each offer counts once,
 * whoever receives it: a repeat of a refused ask, an invitation, an offer at a rival's debt.
 *
 * The author set this on 20 November 2026 to five a turn ("一回合最多五人次提交易"), replacing the plan's
 * one offer to a seat in a round, which he found too few.
 *
 * The limit works through what a seat is shown rather than by overruling its answer: once a seat has
 * made its offers for the turn, the engine view it is given lists no trade partners and refuses any
 * offer. Every kind of agent takes its partners from `legalActions` and checks its offers with
 * `validate`, so each chooses something else of its own accord.
 */
import type { Engine } from '../engine/engine.ts';
import type { GameEvent, GameState, LegalAction, PlayerId } from '../types.ts';

/** The client's setting: five offers a turn from one computer seat. */
export const MAX_ASKS = 5;

export interface AskLedger {
  asks: { from: PlayerId; to: PlayerId; turn: number }[];
}

export const createAskLedger = (): AskLedger => ({ asks: [] });

/** Records the offers among `events`, made by the action that led to `state`. */
export function noteAsks(ledger: AskLedger, events: GameEvent[], state: GameState): void {
  for (const event of events) {
    if (event.type === 'TRADE_PROPOSED') ledger.asks.push({ from: event.offer.from, to: event.offer.to, turn: state.turn.number });
  }
  const oldest = state.turn.number - state.players.length;
  if (ledger.asks.length > 64) ledger.asks = ledger.asks.filter((ask) => ask.turn > oldest);
}

/** The seats `from` may not ask again this turn: every other seat once it has made `maxAsks` offers. */
export function askedEnough(ledger: AskLedger, state: GameState, from: PlayerId, maxAsks = MAX_ASKS): PlayerId[] {
  const made = ledger.asks.filter((ask) => ask.from === from && ask.turn === state.turn.number).length;
  return made < maxAsks ? [] : state.players.filter((p) => p.id !== from && !p.bankrupt).map((p) => p.id);
}

/** The engine as a seat that may not ask `blocked` again this turn sees it. */
export function withoutAsking(engine: Engine, blocked: readonly PlayerId[]): Engine {
  if (blocked.length === 0) return engine;
  return {
    ...engine,
    legalActions: (state, player) =>
      engine.legalActions(state, player).flatMap((action): LegalAction[] => {
        if (action.type !== 'PROPOSE_TRADE') return [action];
        const partners = action.partners.filter((id) => !blocked.includes(id));
        return partners.length > 0 ? [{ ...action, partners }] : [];
      }),
    validate: (state, action) =>
      action.type === 'PROPOSE_TRADE' && blocked.includes(action.to)
        ? { code: 'INVALID_TRADE', message: `${action.player} has made all its offers for this turn.` }
        : engine.validate(state, action),
  };
}
