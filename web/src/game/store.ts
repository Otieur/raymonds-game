import { createEngine, SHORT_GAME_RULES, threeKingdoms } from '../../../src/index.ts';
import type {
  Action,
  CardId,
  DeckId,
  Dice,
  Engine,
  GameEvent,
  GameState,
  PlayerId,
  RuleError,
  SquareId,
} from '../../../src/index.ts';
import { FACTIONS, factionOf, TOKENS } from './assets.ts';
import type { TokenId } from './assets.ts';
import { opponentFor } from './opponents.ts';
import { Seats } from './seats.ts';

/**
 * One side at the table. Its id is a faction id, which also names it; the token is the player's pick.
 * A computer seat plays as its chosen opponent (see `opponents.ts`); none chosen is the default.
 */
export interface Seat {
  id: PlayerId;
  ai: boolean;
  token: TokenId;
  opponent?: string;
}

export interface GameConfig {
  seats: Seat[];
  mode: 'regular' | 'short';
  /** The most offers a computer seat sends one seat in a round; 1 unless set. */
  maxAsks?: number;
}

export interface LogEntry {
  id: number;
  event: GameEvent;
}

export interface Float {
  id: number;
  player: PlayerId;
  amount: number;
}

export interface DrawnCard {
  deck: DeckId;
  card: CardId;
  player: PlayerId;
}

export interface SavedGame {
  config: GameConfig;
  state: GameState;
  log: LogEntry[];
}

/** What the screen shows. `state` is the settled game; the rest animates toward the next one. */
export interface Snapshot {
  state: GameState;
  busy: boolean;
  dice: Dice | null;
  rolling: boolean;
  positions: Record<PlayerId, number>;
  cash: Record<PlayerId, number>;
  /** Players from the top of the table down. The opening roll reseats them in the order of play. */
  seating: PlayerId[];
  /** Each player's latest throw in the opening roll, shown until the first turn begins. */
  orderRolls: Record<PlayerId, Dice>;
  card: DrawnCard | null;
  log: LogEntry[];
  floats: Float[];
  /** The street whose portrait fills the centre of the board. */
  focus: SquareId;
  /** The square being pointed out while something happens on it. */
  spot: SquareId | null;
  error: RuleError | null;
  fast: boolean;
  thinking: PlayerId | null;
  /**
   * At a debt the debtor cannot cover, the seat being asked whether it would make the debtor an
   * offer before the debtor acts: a computer seat weighing it, or a person to answer.
   */
  window: { player: PlayerId; debtor: PlayerId } | null;
}

/**
 * How long things on the table take, in milliseconds at normal speed. The fast switch runs
 * everything at FAST times these. A person's own confirmations are held for BRISK times the
 * figure, since they already know what they did; what an AI player does is held in full.
 */
const PACE = {
  /** An AI player's pause before each action. */
  think: 850,
  /** Dice in the air, then at rest before anything moves. */
  tumble: 800,
  settle: 550,
  /** One square of a walk, and one square of a long journey (more than LONG_WALK squares). */
  step: 240,
  stride: 110,
  /** Standing on the new square before the next thing happens. */
  arrive: 650,
  jailBefore: 600,
  jailAfter: 900,
  jailNews: 700,
  cardAi: 3200,
  cardHuman: 6000,
  paid: 480,
  debt: 700,
  offered: 350,
  acquired: 950,
  auctionOpen: 800,
  bid: 650,
  pass: 380,
  auctionClose: 950,
  built: 850,
  deedChange: 800,
  tradeOffer: 900,
  tradeAnswer: 950,
  bankrupt: 1400,
};
const LONG_WALK = 12;
const FAST = 0.3;
const BRISK = 0.35;

const SAVE_KEY = 'three-kingdoms.save.v3';
/** Saves from earlier formats of the seats and the game state; they cannot be resumed. */
const OLD_SAVE_KEYS = ['three-kingdoms.save.v1', 'three-kingdoms.save.v2'];

export function loadSave(): SavedGame | null {
  try {
    for (const key of OLD_SAVE_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedGame;
    if (saved?.state?.schema !== 1 || saved.state.board !== threeKingdoms.id) return null;
    const sides = new Set(FACTIONS.map((faction) => faction.id));
    const tokens = new Set<string>(TOKENS.map((token) => token.id));
    const seats = saved.config.seats;
    if (!seats.every((seat) => sides.has(seat.id) && tokens.has(seat.token))) return null;
    if (new Set(seats.map((seat) => seat.token)).size !== seats.length) return null;
    const engine = createEngine(threeKingdoms, saved.config.mode === 'short' ? SHORT_GAME_RULES : {});
    return engine.checkInvariants(saved.state).length === 0 ? saved : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage is unavailable; there is nothing to clear.
  }
}

/** Holds one game, plays each action's events out as animation, and moves the AI players. */
export class GameStore {
  readonly engine: Engine;
  readonly config: GameConfig;
  private snap: Snapshot;
  private readonly listeners = new Set<() => void>();
  private readonly seats: Seats;
  private generation = 0;
  private skipCard: (() => void) | null = null;
  private nextId = 1;

  constructor(config: GameConfig, saved?: SavedGame) {
    this.config = config;
    this.engine = createEngine(threeKingdoms, config.mode === 'short' ? SHORT_GAME_RULES : {});
    const size = config.seats.length as 2 | 3 | 4;
    this.seats = new Seats(
      this.engine,
      config.seats.filter((seat) => seat.ai).map((seat) => ({ id: seat.id, opponent: opponentFor(seat.opponent, size, config.mode) })),
      (seat, opponent, reason) =>
        console.warn(`${seat} plays the standard computer player from here on: ${opponent.name.en} failed.`, reason),
      { maxAsks: config.maxAsks },
    );
    const state =
      saved?.state ??
      this.engine.newGame({
        players: config.seats.map(({ id }) => ({ id, name: factionOf(id).en })),
        seed: Date.now() >>> 0,
      });
    const log = saved?.log ?? [];
    this.nextId = log.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
    this.snap = {
      state,
      busy: false,
      dice: state.turn.lastRoll,
      rolling: false,
      card: null,
      log,
      floats: [],
      focus: this.openingFocus(state),
      spot: null,
      error: null,
      fast: false,
      thinking: null,
      window: null,
      orderRolls: { ...(state.opening?.rolls ?? {}) },
      ...this.mirror(state),
    };
  }

  /** The street to show first: the one being decided on, else where the current player stands. */
  private openingFocus(state: GameState): SquareId {
    const squares = this.engine.board.squares;
    const top = state.pending[state.pending.length - 1];
    const turnPlayer = state.players.find((player) => player.id === state.turn.player);
    const candidates = [
      top && 'property' in top ? squares.find((sq) => sq.id === top.property) : undefined,
      turnPlayer ? squares[turnPlayer.position] : undefined,
    ];
    return candidates.find((sq) => sq?.kind === 'street')?.id ?? 'zhuge-liang';
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Snapshot => this.snap;

  seat(id: PlayerId): Seat {
    return this.config.seats.find((seat) => seat.id === id) as Seat;
  }

  /** Begins (or resumes) play: settles the view and lets the AI move if it is its turn. */
  start(): void {
    this.generation += 1;
    this.patch({ busy: false, rolling: false, card: null, spot: null, thinking: null, window: null, ...this.mirror(this.snap.state) });
    this.schedule();
  }

  /** Stops timers and abandons any animation in flight. Play can start again. */
  stop(): void {
    this.generation += 1;
    this.skipCard?.();
  }

  /** Ends this store for good when its game is left: releases the opponents' workers. */
  dispose(): void {
    this.stop();
    this.seats.dispose();
  }

  /** The computer seats whose opponent failed and that now play the standard computer player. */
  fallenBack(): PlayerId[] {
    return this.seats.fallen();
  }

  dispatch(action: Action): boolean {
    if (this.snap.busy) return false;
    const result = this.engine.apply(this.snap.state, action);
    if (!result.ok) {
      this.patch({ error: result.error });
      return false;
    }
    this.seats.observe(result.events, result.state);
    void this.play(result.events, result.state);
    return true;
  }

  setFocus(id: SquareId): void {
    if (id !== this.snap.focus) this.patch({ focus: id });
  }

  toggleFast(): void {
    this.patch({ fast: !this.snap.fast });
  }

  clearError(): void {
    this.patch({ error: null });
  }

  dismissCard(): void {
    this.skipCard?.();
  }

  /** A person asked at a rival's debt makes no offer; the next seat is asked, or the debtor acts. */
  passWindow(): void {
    const window = this.snap.window;
    if (!window || this.snap.busy || this.seat(window.player).ai) return;
    this.patch({ window: null });
    this.schedule();
  }

  private patch(change: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...change };
    for (const listener of this.listeners) listener();
  }

  private mirror(state: GameState): Pick<Snapshot, 'positions' | 'cash' | 'seating'> {
    const positions: Record<PlayerId, number> = {};
    const cash: Record<PlayerId, number> = {};
    for (const player of state.players) {
      positions[player.id] = player.position;
      cash[player.id] = player.cash;
    }
    return { positions, cash, seating: state.players.map((player) => player.id) };
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms * (this.snap.fast ? FAST : 1)));
  }

  private focusOn(square: SquareId | number): void {
    const squares = this.engine.board.squares;
    const sq = typeof square === 'number' ? squares[square] : squares.find((item) => item.id === square);
    if (sq?.kind === 'street') this.setFocus(sq.id);
  }

  private async play(events: GameEvent[], next: GameState): Promise<void> {
    const run = this.generation;
    const alive = () => run === this.generation;
    const squares = this.engine.board.squares;
    const size = squares.length;
    const jail = squares.findIndex((sq) => sq.kind === 'jail');
    this.patch({ busy: true, error: null, thinking: null, window: null });

    /** A pause for what just happened: full length for an AI player's doing, brisk for a person's own. */
    const hold = (ms: number, actor?: PlayerId | null) =>
      this.wait(actor != null && !this.seat(actor).ai ? ms * BRISK : ms);
    /** Points at a square, on the board and in the centre, for as long as the pause lasts. */
    const point = async (square: SquareId, ms: number, actor?: PlayerId | null) => {
      this.focusOn(square);
      this.patch({ spot: square });
      await hold(ms, actor);
      if (alive()) this.patch({ spot: null });
    };

    for (const event of events) {
      if (!alive()) return;
      this.patch({ log: [...this.snap.log, { id: this.nextId++, event }].slice(-250) });
      switch (event.type) {
        case 'DICE_ROLLED':
          this.patch({ dice: event.dice, rolling: true });
          await this.wait(PACE.tumble);
          if (!alive()) return;
          if (event.purpose === 'order') {
            this.patch({ rolling: false, orderRolls: { ...this.snap.orderRolls, [event.player]: event.dice } });
          } else {
            this.patch({ rolling: false, orderRolls: {} });
          }
          await this.wait(PACE.settle);
          break;
        case 'ORDER_TIED': {
          // Let the tie be read, then clear the tied throws for the next round.
          await this.wait(1000);
          if (!alive()) return;
          const rolls = { ...this.snap.orderRolls };
          for (const id of event.players) delete rolls[id];
          this.patch({ orderRolls: rolls });
          break;
        }
        case 'ORDER_DECIDED':
          await this.wait(500);
          if (!alive()) return;
          this.patch({ seating: event.order });
          await this.wait(1200);
          if (!alive()) return;
          // The places now say it all; throws from different rounds would only confuse.
          this.patch({ orderRolls: {} });
          break;
        case 'MOVED': {
          const backward = event.to < event.from && !event.passedStart;
          const steps = backward ? event.from - event.to : (event.to - event.from + size) % size;
          const pace = steps > LONG_WALK ? PACE.stride : PACE.step;
          let at = event.from;
          for (let i = 0; i < steps; i++) {
            at = (at + (backward ? -1 : 1) + size) % size;
            this.patch({ positions: { ...this.snap.positions, [event.player]: at } });
            await this.wait(pace);
            if (!alive()) return;
          }
          await point(squares[event.to].id, PACE.arrive);
          break;
        }
        case 'SENT_TO_JAIL':
          await this.wait(PACE.jailBefore);
          if (!alive()) return;
          this.patch({ positions: { ...this.snap.positions, [event.player]: jail } });
          await point(squares[jail].id, PACE.jailAfter);
          break;
        case 'JAIL_ROLL_FAILED':
        case 'LEFT_JAIL':
          await hold(PACE.jailNews, event.player);
          break;
        case 'CARD_DRAWN': {
          this.patch({ card: { deck: event.deck, card: event.card, player: event.player } });
          const skipped = new Promise<void>((resolve) => {
            this.skipCard = resolve;
          });
          await Promise.race([this.wait(this.seat(event.player).ai ? PACE.cardAi : PACE.cardHuman), skipped]);
          this.skipCard = null;
          if (!alive()) return;
          this.patch({ card: null });
          await this.wait(300);
          break;
        }
        case 'PAID': {
          const cash = { ...this.snap.cash };
          const floats = [...this.snap.floats];
          if (event.from !== null) {
            cash[event.from] -= event.amount;
            floats.push({ id: this.nextId++, player: event.from, amount: -event.amount });
          }
          if (event.to !== null) {
            cash[event.to] += event.amount;
            floats.push({ id: this.nextId++, player: event.to, amount: event.amount });
          }
          this.patch({ cash, floats: floats.slice(-12) });
          // Rent and the like between two players is worth reading; a person's own purchase is not.
          await hold(PACE.paid, event.from !== null && event.to !== null ? null : (event.from ?? event.to));
          break;
        }
        case 'DEBT_INCURRED':
          await hold(PACE.debt, event.debtor);
          break;
        case 'PROPERTY_OFFERED':
          await point(event.property, PACE.offered, event.player);
          break;
        case 'PROPERTY_ACQUIRED':
          await point(event.property, PACE.acquired, event.player);
          break;
        case 'AUCTION_STARTED':
          await point(event.property, PACE.auctionOpen);
          break;
        case 'BUILDING_AUCTION_STARTED':
          await this.wait(PACE.auctionOpen);
          break;
        case 'BID_PLACED':
          await hold(PACE.bid, event.player);
          break;
        case 'AUCTION_PASSED':
          await hold(PACE.pass, event.player);
          break;
        case 'AUCTION_ENDED':
          await point(event.property, PACE.auctionClose);
          break;
        case 'BUILT':
          await point(event.property, PACE.built, event.player);
          break;
        case 'MORTGAGED':
        case 'UNMORTGAGED':
          await point(event.property, PACE.deedChange, event.player);
          break;
        case 'BUILDINGS_SOLD':
          await hold(PACE.deedChange, event.player);
          break;
        case 'TRADE_PROPOSED':
          await hold(PACE.tradeOffer, event.offer.from);
          break;
        case 'TRADE_ACCEPTED':
        case 'TRADE_REJECTED':
          await hold(PACE.tradeAnswer, event.offer.to);
          break;
        case 'TRADE_CANCELLED':
          await hold(PACE.tradeAnswer, event.offer.from);
          break;
        case 'BANKRUPT':
          await this.wait(PACE.bankrupt);
          break;
        default:
          break;
      }
    }

    if (!alive()) return;
    this.patch({ state: next, busy: false, rolling: false, card: null, spot: null, ...this.mirror(next) });
    this.save();
    this.schedule();
  }

  /**
   * If the game is waiting on an AI player, asks its opponent and acts after a short pause. The pause
   * starts when the opponent is asked, so it covers a model's work. An answer to a state that has
   * since moved on (a person acted meanwhile, or play stopped) is dropped.
   */
  private schedule(): void {
    const { state } = this.snap;
    const run = this.generation;
    const current = () => run === this.generation && !this.snap.busy && this.snap.state === state;
    // At a debt the debtor cannot cover, the other seats are asked first, one at a time.
    const asked = this.seats.nextAtDebt(state);
    if (asked !== null) {
      const debtor = (state.pending[state.pending.length - 1] as Extract<GameState['pending'][number], { kind: 'debt' }>).debtor;
      if (!this.seat(asked).ai) {
        this.patch({ window: { player: asked, debtor }, thinking: null });
        return;
      }
      this.patch({ window: { player: asked, debtor }, thinking: asked });
      void this.seats.atDebt(state, asked, Math.random).then(async (offer) => {
        if (!current()) return;
        if (!offer) {
          this.patch({ window: null });
          this.schedule();
          return;
        }
        await this.wait(PACE.think);
        if (current()) this.dispatch(offer);
      });
      return;
    }
    if (this.snap.window !== null) this.patch({ window: null });
    const actor = state.winner === null ? this.engine.awaiting(state).find((id) => this.seat(id).ai) : undefined;
    if (actor === undefined) {
      if (this.snap.thinking !== null) this.patch({ thinking: null });
      return;
    }
    this.patch({ thinking: actor });
    void Promise.all([this.seats.ask(state, actor, Math.random), this.wait(PACE.think)]).then(([action]) => {
      if (action && current()) this.dispatch(action);
    });
  }

  private save(): void {
    try {
      const saved: SavedGame = { config: this.config, state: this.snap.state, log: this.snap.log.slice(-150) };
      localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
    } catch {
      // Storage is unavailable; the game simply cannot be resumed later.
    }
  }
}
