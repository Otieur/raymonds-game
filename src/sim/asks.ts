/**
 * How often a computer seat may ask the same seat (M10's `maxAsks`): at most `maxAsks` offers to one
 * seat within a round, a round being as many turns as there are players still in the game. A repeat
 * of a refused ask counts, and so does an invitation or an offer at a debt; every offer does.
 *
 * The limit works through what a seat is shown rather than by overruling its answer: the engine view
 * it is given leaves the seats it has asked enough out of its trade partners and refuses an offer to
 * them. Every kind of agent takes its partners from `legalActions` and checks its offers with
 * `validate`, so each chooses something else of its own accord.
 */
import type { Engine } from '../engine/engine.ts';
import type { GameEvent, GameState, LegalAction, PlayerId } from '../types.ts';

/** The client's setting: one offer to a seat in a round. */
export const MAX_ASKS = 1;

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

/** The seats `from` has already asked `maxAsks` times in the round up to and including this turn. */
export function askedEnough(ledger: AskLedger, state: GameState, from: PlayerId, maxAsks = MAX_ASKS): PlayerId[] {
  const round = state.players.filter((p) => !p.bankrupt).length;
  const counts = new Map<PlayerId, number>();
  for (const ask of ledger.asks) {
    if (ask.from === from && ask.turn > state.turn.number - round) counts.set(ask.to, (counts.get(ask.to) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n >= maxAsks).map(([to]) => to);
}

/** The engine as a seat that may not ask `blocked` again this round sees it. */
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
        ? { code: 'INVALID_TRADE', message: `${action.player} has already asked ${action.to} this round.` }
        : engine.validate(state, action),
  };
}
