/**
 * The computer seats of one game: each seat's chosen opponent, the events it is fed, and the
 * rule-based agent that takes over when the opponent fails.
 *
 * An opponent fails when making it fails, when it throws, when it answers nothing while the engine
 * awaits its seat, or when the engine refuses its answer. The seat then plays the rule-based agent's
 * choice, and keeps playing it for the rest of the game; the failure is reported once. A game never
 * stops because a model failed.
 *
 * Kept free of the browser so that the tests can run it.
 */
import type { Action, Engine, GameEvent, GameState, PlayerId } from '../../../src/index.ts';
import { memberAgent } from '../../../src/sim/league.ts';
import { DEFAULT_OPPONENT } from '../../../src/sim/opponents.ts';
import type { Opponent, OpponentAgent } from '../../../src/sim/opponents.ts';
import type { SeatAgent } from '../../../src/sim/styles.ts';

interface SeatSlot {
  opponent: Opponent;
  agent: OpponentAgent | null;
  /** While the agent is being made: the events it has missed, in order. */
  making: Promise<OpponentAgent | null> | null;
  missed: [GameEvent[], GameState][];
  rules: SeatAgent;
  fallen: boolean;
}

export type FallbackReport = (seat: PlayerId, opponent: Opponent, reason: unknown) => void;

export class Seats {
  private readonly slots = new Map<PlayerId, SeatSlot>();
  private disposed = false;
  private readonly engine: Engine;
  private readonly report: FallbackReport;

  constructor(engine: Engine, seats: { id: PlayerId; opponent: Opponent }[], report: FallbackReport = () => {}) {
    this.engine = engine;
    this.report = report;
    for (const { id, opponent } of seats) {
      const slot: SeatSlot = { opponent, agent: null, making: null, missed: [], rules: memberAgent('rules'), fallen: false };
      this.slots.set(id, slot);
      try {
        const made = opponent.create();
        if (made instanceof Promise) {
          slot.making = made.then(
            (agent) => {
              slot.making = null;
              if (slot.fallen || this.disposed) {
                agent.dispose?.();
                return null;
              }
              slot.agent = agent;
              for (const [events, state] of slot.missed.splice(0)) this.feed(id, slot, events, state);
              return slot.fallen ? null : agent;
            },
            (reason) => {
              slot.making = null;
              this.fall(id, slot, reason);
              return null;
            },
          );
        } else {
          slot.agent = made;
        }
      } catch (reason) {
        this.fall(id, slot, reason);
      }
    }
  }

  /** Releases every opponent's agent; called once, when the game is left. */
  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots.values()) {
      slot.agent?.dispose?.();
      slot.agent = null;
    }
  }

  /** The seats whose opponent failed and that now play the rule-based agent. */
  fallen(): PlayerId[] {
    return [...this.slots].filter(([, slot]) => slot.fallen).map(([id]) => id);
  }

  /** Passes the events of an applied action, and the state after it, to every seat's opponent. */
  observe(events: GameEvent[], state: GameState): void {
    for (const [id, slot] of this.slots) {
      if (slot.fallen) continue;
      if (slot.agent) this.feed(id, slot, events, state);
      else if (slot.making) slot.missed.push([events, state]);
    }
  }

  /**
   * The seat's action in `state`: its opponent's answer, or the rule-based agent's when the opponent
   * fails. Null only when the seat is not awaited or no agent has an answer.
   */
  async ask(state: GameState, actor: PlayerId, random: () => number): Promise<Action | null> {
    const slot = this.slots.get(actor);
    if (!slot || !this.engine.awaiting(state).includes(actor)) return null;
    if (!slot.fallen) {
      try {
        const agent = slot.agent ?? (await slot.making);
        if (agent && !slot.fallen) {
          const action = await agent.choose(this.engine, state, actor, random);
          // The rule-based agent has no answer for a few rare decisions; that is not a failure.
          if (!action && slot.opponent.id === DEFAULT_OPPONENT) return this.simple(state, actor);
          if (!action) throw new Error('it answered nothing while its seat was awaited');
          const tried = this.engine.apply(state, action);
          if (!tried.ok) throw new Error(`the engine refused ${action.type}: ${tried.error.message}`);
          return action;
        }
      } catch (reason) {
        this.fall(actor, slot, reason);
      }
    }
    return (await slot.rules.choose(this.engine, state, actor, random)) ?? this.simple(state, actor);
  }

  private feed(id: PlayerId, slot: SeatSlot, events: GameEvent[], state: GameState): void {
    try {
      slot.agent?.observe(events, state);
    } catch (reason) {
      this.fall(id, slot, reason);
    }
  }

  private fall(id: PlayerId, slot: SeatSlot, reason: unknown): void {
    if (slot.fallen) return;
    slot.fallen = true;
    try {
      slot.agent?.dispose?.();
    } catch {
      // It is being replaced either way.
    }
    slot.agent = null;
    slot.missed = [];
    this.report(id, slot.opponent, reason);
  }

  /** A safe move for a seat no agent has an answer for. */
  private simple(state: GameState, actor: PlayerId): Action | null {
    const legal = this.engine.legalActions(state, actor);
    const simple = ['END_TURN', 'ROLL', 'PASS', 'DECLINE', 'REJECT_TRADE', 'USE_JAIL_CARD', 'PAY_BAIL'] as const;
    for (const type of simple) {
      if (legal.some((action) => action.type === type)) return { type, player: actor };
    }
    if (legal.some((action) => action.type === 'SETTLE_TRANSFER')) return { type: 'SETTLE_TRANSFER', player: actor, lift: false };
    return null;
  }
}
