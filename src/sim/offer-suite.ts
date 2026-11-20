/**
 * The offer suite (M9): offers with a measured answer, for scoring how an agent answers trades.
 *
 * A case is a position (a snapshot row), an offer made in it, and the answer that was right for the
 * receiver, measured by playing both versions of the position out (`scripts/make-offer-suite.ts`).
 * An agent is scored by the share of cases it answers as labelled, overall and by template.
 *
 * Templates, each a family of offers that a position may allow; a candidate is kept in the suite only
 * if its measured answer is clear, whatever the template's intent:
 *
 *   complete-cash  the street that completes the proposer's group, for cash at 0.5, 1, 2, 4 and 8 times list;
 *   swap-both      a street for a street, completing a group for each side;
 *   swap-short     the same swap with the receiver also paying enough cash that it cannot build;
 *   useless-sale   a street the proposer has no use for, sold at 1.5 times list;
 *   pass           a pass asked for at 1 and 2 times list, by how many the proposer holds;
 *   free-street    a street given for one coin (nobody should refuse it);
 *   large-sum      three times list for a street of no use to the receiver (nor should this be refused);
 *   blocking       the receiver's only street of a group the proposer otherwise holds, at 1.5 times list,
 *                  split by whether the proposer could then build three buildings on it;
 *   second         a second street of a group of three, at 1, 1.5 and 2 times list, by where the third is;
 *   denial         the street the strongest rival lacks, asked for by another seat, by that seat's rank;
 *   failing        a failing seat's best street, for cash that covers its largest due and for less;
 *   partner-swap   a swap completing a group for each side, between two trailing seats or with the leader;
 *   invitation     a street the receiver needs, at list, from a trailing seat while a third seat leads.
 */
import type { Context } from '../context.ts';
import type { Engine } from '../engine/engine.ts';
import type { GameState, PlayerId, PropertySquare, StreetSquare, TradeOffer } from '../types.ts';
import { distressOf, isFailing } from './deal.ts';
import { wilson } from './intervals.ts';
import { duesInReach, viewOf } from './measures.ts';
import { isOut, stateOf } from './snapshot.ts';
import type { SnapshotRow } from './snapshot.ts';
import type { SeatAgent } from './styles.ts';
import type { Valuation } from './valuation.ts';

export const SUITE_VERSION = 1;

export const TEMPLATES = [
  'complete-cash', 'swap-both', 'swap-short', 'useless-sale', 'pass', 'free-street', 'large-sum',
  'blocking', 'second', 'denial', 'failing', 'partner-swap', 'invitation',
] as const;
export type Template = (typeof TEMPLATES)[number];

export interface Candidate {
  template: Template;
  /** The template and its variant, such as `complete-cash|2`. */
  cell: string;
  deal: TradeOffer;
}

export interface SuiteCase {
  template: Template;
  cell: string;
  row: SnapshotRow;
  deal: TradeOffer;
  label: 'accept' | 'refuse';
  /** Measured changes in win share (0 to 1) for the receiver (with half its 95% interval), the proposer and the best-placed other seat. */
  receiver: number;
  half: number;
  proposer: number;
  other: number;
}

export interface Suite {
  version: typeof SUITE_VERSION;
  size: number;
  rules: 'full' | 'short';
  /** The members that played the playouts, one for each seat. */
  players: string[];
  playouts: number;
  /** The snapshot seeds the positions came from. */
  seeds: [number, number];
  cases: SuiteCase[];
}

const side = (cash: number, properties: string[] = []) => ({ cash, properties, jailCards: 0 });
const offer = (from: PlayerId, to: PlayerId, give: ReturnType<typeof side>, receive: ReturnType<typeof side>): TradeOffer => ({ from, to, give, receive });

/** Every candidate offer of every template that a position allows. `round` is the position's round. */
export function offerCandidates(ctx: Context, state: GameState, round: number, valuation: Valuation): Candidate[] {
  const out: Candidate[] = [];
  const add = (template: Template, variant: string, deal: TradeOffer) => out.push({ template, cell: variant ? `${template}|${variant}` : template, deal });
  const alive = state.players.filter((p) => !p.bankrupt);
  const cashOf = (id: PlayerId) => state.players.find((p) => p.id === id)?.cash ?? 0;
  const owner = (id: string) => state.properties[id].owner;
  const chances = valuation.chances(ctx, state);
  const chanceOf = (id: PlayerId) => chances[state.players.findIndex((p) => p.id === id)];
  const leader = [...alive].sort((a, b) => chanceOf(b.id) - chanceOf(a.id))[0]?.id ?? null;
  const groups = [...ctx.groups.values()];
  const free = (sq: StreetSquare) => !state.properties[sq.id].mortgaged && (ctx.groups.get(sq.group) ?? []).every((mate) => state.properties[mate.id].level === 0);
  const held = (streets: readonly StreetSquare[], id: PlayerId) => streets.filter((sq) => owner(sq.id) === id).length;
  /** The one street of a group a seat lacks, if it holds all the others, with its holder. */
  const lacking = (streets: readonly StreetSquare[], id: PlayerId) => {
    const missing = streets.filter((sq) => owner(sq.id) !== id);
    return missing.length === 1 && streets.length > 1 ? missing[0] : null;
  };
  const buildable = (streets: readonly StreetSquare[], cash: number) => Math.floor(cash / streets[0].buildingCost);

  for (const p of alive) {
    for (const streets of groups) {
      const target = lacking(streets, p.id);
      const holder = target ? owner(target.id) : null;
      if (!target || !holder || holder === p.id || !free(target)) continue;
      const r = holder;
      // The street that completes the proposer's group, for cash.
      for (const m of [0.5, 1, 2, 4, 8]) {
        const cash = Math.round(target.price * m);
        if (cashOf(p.id) >= cash) add('complete-cash', String(m), offer(p.id, r, side(cash), side(0, [target.id])));
      }
      // The receiver's only street of the group, at 1.5 times list, by whether the proposer could then build three.
      if (held(streets, r) === 1) {
        const cash = Math.round(target.price * 1.5);
        if (cashOf(p.id) >= cash) add('blocking', buildable(streets, cashOf(p.id) - cash) >= 3 ? 'cash' : 'nocash', offer(p.id, r, side(cash), side(0, [target.id])));
      }
      // Swaps that complete a group for each side.
      for (const theirs of groups) {
        if (theirs === streets) continue;
        const back = lacking(theirs, r);
        if (!back || owner(back.id) !== p.id || !free(back)) continue;
        const swap = offer(p.id, r, side(0, [back.id]), side(0, [target.id]));
        add('swap-both', '', swap);
        const spare = cashOf(r) - theirs[0].buildingCost + 1;
        if (spare > 0) add('swap-short', '', offer(p.id, r, side(0, [back.id]), side(spare, [target.id])));
        if (alive.length >= 3) add('partner-swap', p.id !== leader && r !== leader ? 'trailing' : 'leader', swap);
      }
    }

    // A street of no use to the proposer, sold at 1.5 times list to the seat that holds most of its group.
    for (const streets of groups) {
      if (held(streets, p.id) !== 1 || streets.length < 2) continue;
      const mine = streets.find((sq) => owner(sq.id) === p.id) as StreetSquare;
      if (!free(mine)) continue;
      const buyer = alive.filter((q) => q.id !== p.id).sort((a, b) => held(streets, b.id) - held(streets, a.id))[0];
      const cash = Math.round(mine.price * 1.5);
      if (buyer && cashOf(buyer.id) >= cash) add('useless-sale', `holds${held(streets, buyer.id)}`, offer(p.id, buyer.id, side(0, [mine.id]), side(cash)));
      // The same street given for one coin; and three times list paid for a rival's street of no use to it.
      if (buyer && cashOf(buyer.id) >= 1) add('free-street', '', offer(p.id, buyer.id, side(0, [mine.id]), side(1)));
    }
    for (const streets of groups) {
      for (const q of alive) {
        if (q.id === p.id || held(streets, q.id) !== 1 || streets.length < 2) continue;
        const theirs = streets.find((sq) => owner(sq.id) === q.id) as StreetSquare;
        const cash = Math.round(theirs.price * 3);
        if (free(theirs) && cashOf(p.id) >= cash && held(streets, p.id) === 0) add('large-sum', '', offer(p.id, q.id, side(cash), side(0, [theirs.id])));
      }
    }

    // A pass, by how many the proposer holds.
    const passes = ctx.propertyOrder.filter((sq: PropertySquare) => sq.kind === 'transit');
    const mine = passes.filter((sq) => owner(sq.id) === p.id).length;
    for (const pass of passes) {
      const r = owner(pass.id);
      if (!r || r === p.id || state.properties[pass.id].mortgaged) continue;
      for (const m of [1, 2]) {
        const cash = Math.round(pass.price * m);
        if (cashOf(p.id) >= cash) add('pass', `${mine}|${m}`, offer(p.id, r, side(cash), side(0, [pass.id])));
      }
    }
  }

  for (const streets of groups) {
    if (streets.length !== 3) continue;
    // A second street: the buyer holds one, the seller another, the third in the bank or with a third seat.
    for (const p of alive) {
      if (held(streets, p.id) !== 1) continue;
      for (const target of streets) {
        const r = owner(target.id);
        if (!r || r === p.id || !free(target)) continue;
        const third = streets.find((sq) => sq.id !== target.id && owner(sq.id) !== p.id) as StreetSquare;
        if (owner(third.id) === r) continue;
        for (const m of [1, 1.5, 2]) {
          const cash = Math.round(target.price * m);
          if (cashOf(p.id) >= cash) add('second', `${round}|${m}|${owner(third.id) === null ? 'bank' : 'third'}`, offer(p.id, r, side(cash), side(0, [target.id])));
        }
      }
    }
    // Denial: a rival holds two, a third seat the last, and another seat asks for it.
    if (alive.length >= 3) {
      for (const rival of alive) {
        if (held(streets, rival.id) !== 2) continue;
        const target = streets.find((sq) => owner(sq.id) !== rival.id) as StreetSquare;
        const r = owner(target.id);
        if (!r || !free(target)) continue;
        const opponents = alive.filter((q) => q.id !== rival.id).sort((a, b) => chanceOf(b.id) - chanceOf(a.id));
        opponents.forEach((p, place) => {
          if (p.id === r) return;
          const rank = place === 0 ? 'nearest' : place === opponents.length - 1 ? 'last' : 'middle';
          const cash = Math.round(target.price * 1.5);
          if (cashOf(p.id) >= cash) add('denial', rank, offer(p.id, r, side(cash), side(0, [target.id])));
        });
      }
    }
  }

  if (alive.length >= 3) {
    const view = viewOf(ctx, state);
    for (const r of alive) {
      // A failing seat's best free street, for cash that covers its largest due and for less.
      if (isFailing(distressOf(ctx, state, r.id, valuation, [], chances), 0.4)) {
        const best = ctx.propertyOrder
          .filter((sq): sq is StreetSquare => sq.kind === 'street' && owner(sq.id) === r.id && free(sq))
          .sort((a, b) => b.price - a.price)[0];
        const due = duesInReach(view, r).largest;
        if (best) {
          for (const p of alive) {
            if (p.id === r.id) continue;
            const covers = Math.max(best.price, due + 1);
            if (cashOf(p.id) >= covers) add('failing', 'covers', offer(p.id, r.id, side(covers), side(0, [best.id])));
            const short = Math.min(best.price, due - 1);
            if (short > 0 && due > 1) add('failing', 'short', offer(p.id, r.id, side(short), side(0, [best.id])));
          }
        }
      }
      // An invitation: a street the receiver needs, at list, from a trailing seat while a third seat leads.
      for (const p of alive) {
        if (p.id === r.id || p.id === leader || r.id === leader) continue;
        for (const streets of groups) {
          const need = lacking(streets, r.id);
          if (need && owner(need.id) === p.id && free(need) && cashOf(r.id) >= need.price) add('invitation', '', offer(p.id, r.id, side(0, [need.id]), side(need.price)));
        }
      }
    }
  }
  return out;
}

/** The position of a case with the offer on the table for the receiver to answer, on the proposer's turn after its roll. */
export function caseState(ctx: Context, row: SnapshotRow, deal: TradeOffer): GameState {
  const state = stateOf(ctx, row);
  for (let seat = 0; seat < row.n; seat++) if (isOut(row, seat)) state.players[seat].bankrupt = true;
  state.turn.player = deal.from;
  state.turn.phase = 'postRoll';
  state.pending = [{ kind: 'trade', offer: deal }];
  return state;
}

/** Whether the offer is one the engine would accept from the proposer in the position. */
export function isValidOffer(engine: Engine, ctx: Context, row: SnapshotRow, deal: TradeOffer): boolean {
  const state = caseState(ctx, row, deal);
  state.pending = [];
  return engine.validate(state, { type: 'PROPOSE_TRADE', player: deal.from, to: deal.to, give: deal.give, receive: deal.receive }) === null;
}

/** How an agent answers a case. */
export function answerCase(engine: Engine, ctx: Context, agent: SeatAgent, kase: Pick<SuiteCase, 'row' | 'deal'>, random: () => number = () => 0.5): 'accept' | 'refuse' {
  const action = agent.choose(engine, caseState(ctx, kase.row, kase.deal), kase.deal.to, random);
  return action?.type === 'ACCEPT_TRADE' ? 'accept' : 'refuse';
}

export interface SuiteScore {
  cases: number;
  right: number;
  share: number;
  low: number;
  high: number;
  byTemplate: Record<string, { cases: number; right: number }>;
  /** By label: cases labelled accept and how many were accepted; labelled refuse and how many were refused. */
  byLabel: { accept: { cases: number; right: number }; refuse: { cases: number; right: number } };
}

/** The share of a suite's cases an agent answers as labelled; `agentFor` gives a fresh agent for each case. */
export function scoreSuite(engine: Engine, ctx: Context, suite: Pick<Suite, 'cases'>, agentFor: () => SeatAgent): SuiteScore {
  const byTemplate: SuiteScore['byTemplate'] = {};
  const byLabel: SuiteScore['byLabel'] = { accept: { cases: 0, right: 0 }, refuse: { cases: 0, right: 0 } };
  let right = 0;
  for (const kase of suite.cases) {
    const ok = answerCase(engine, ctx, agentFor(), kase) === kase.label;
    if (ok) right += 1;
    for (const tally of [(byTemplate[kase.template] ??= { cases: 0, right: 0 }), byLabel[kase.label]]) {
      tally.cases += 1;
      if (ok) tally.right += 1;
    }
  }
  const [low, high] = wilson(right, suite.cases.length);
  return { cases: suite.cases.length, right, share: suite.cases.length ? right / suite.cases.length : NaN, low, high, byTemplate, byLabel };
}

/** One line for a suite's score, as the checks log it. */
export function describeScore(name: string, score: SuiteScore): string {
  const pct = (v: number) => (v * 100).toFixed(1);
  const parts = Object.entries(score.byTemplate).map(([t, s]) => `${t} ${s.right}/${s.cases}`).join(', ');
  return `suite ${name}: ${pct(score.share)}% (${pct(score.low)} to ${pct(score.high)}) of ${score.cases} cases answered as measured; ${parts}`;
}
