/**
 * The arithmetic of M9's trade report (`scripts/trade-report.ts`) and of the count of offers a draft
 * cannot express (`scripts/count-offers.ts`), kept apart from the scripts so that it can be tested.
 */
import type { TradeOffer } from '../types.ts';
import { wilson } from './intervals.ts';
import type { SuiteScore } from './offer-suite.ts';

/** Whether an offer has a shape the learner's drafts can make (action version 3), and its shape in words. */
export function expressible(offer: Pick<TradeOffer, 'give' | 'receive'>): { ok: boolean; shape: string } {
  const gives = offer.give.properties.length;
  const asks = offer.receive.properties.length;
  const cards = offer.give.jailCards + offer.receive.jailCards;
  const cashBothWays = offer.give.cash > 0 && offer.receive.cash > 0;
  const shape = `gives ${gives} ${gives === 1 ? 'property' : 'properties'}${offer.give.cash > 0 ? ' and cash' : ''}, asks ${asks}${offer.receive.cash > 0 ? ' and cash' : ''}${cards ? ', with jail cards' : ''}`;
  // An ask: one property asked for, at most one given, cash one way. A sale: one property given for cash.
  const ask = asks === 1 && gives <= 1;
  const sale = asks === 0 && gives === 1 && offer.receive.cash > 0 && offer.give.cash === 0;
  return { ok: (ask || sale) && !cashBothWays && cards === 0, shape };
}

/** A running count, sum and sum of squares, for a mean and its interval. */
export interface Moments {
  n: number;
  sum: number;
  sumsq: number;
}
export const emptyMoments = (): Moments => ({ n: 0, sum: 0, sumsq: 0 });
export function addMoment(m: Moments, value: number): void {
  m.n += 1;
  m.sum += value;
  m.sumsq += value * value;
}
export function addMoments(into: Moments, from: Moments): Moments {
  into.n += from.n;
  into.sum += from.sum;
  into.sumsq += from.sumsq;
  return into;
}
/** The mean and the sample variance of a running count (NaN when too few). */
export function meanOf(m: Moments): { mean: number; variance: number } {
  const mean = m.n ? m.sum / m.n : NaN;
  const variance = m.n > 1 ? Math.max(0, (m.sumsq - m.n * mean * mean) / (m.n - 1)) : NaN;
  return { mean, variance };
}

/** How one-sided an accepted deal was: the larger side's gain by the valuation minus the smaller's, in points of chance. */
export const oneSided = (proposerGain: number, receiverGain: number): number => Math.abs(proposerGain - receiverGain) * 100;

export interface Bar {
  name: string;
  passed: boolean;
  /** What was measured, in words, with the figures. */
  reading: string;
}

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/a');

/** The suite's bar: at most 2% of the cases labelled refuse accepted, at most 10% of those labelled accept refused. */
export function suiteBar(score: SuiteScore): Bar {
  const { accept, refuse } = score.byLabel;
  const wrongAccept = refuse.cases ? (refuse.cases - refuse.right) / refuse.cases : NaN;
  const wrongRefuse = accept.cases ? (accept.cases - accept.right) / accept.cases : NaN;
  return {
    name: 'The suite',
    passed: wrongAccept <= 0.02 && wrongRefuse <= 0.1,
    reading: `${pct(wrongAccept)} of ${refuse.cases} cases labelled refuse were accepted (bar 2%); ${pct(wrongRefuse)} of ${accept.cases} labelled accept were refused (bar 10%).`,
  };
}

/** Dealing between copies: no more one-sided than dealing with others, by more than the interval of the difference. */
export function copiesBar(copies: Moments, others: Moments): Bar {
  const c = meanOf(copies);
  const o = meanOf(others);
  const difference = c.mean - o.mean;
  const half = 1.96 * Math.sqrt(c.variance / copies.n + o.variance / others.n);
  const enough = copies.n > 1 && others.n > 1;
  return {
    name: 'Dealing between copies',
    passed: enough && difference - half <= 0,
    reading: enough
      ? `Deals between copies are ${c.mean.toFixed(2)} points one-sided on average over ${copies.n} deals, deals with others ${o.mean.toFixed(2)} over ${others.n}: a difference of ${difference.toFixed(2)} (${(difference - half).toFixed(2)} to ${(difference + half).toFixed(2)}).`
      : `Too few deals to compare: ${copies.n} between copies, ${others.n} with others.`,
  };
}

/**
 * Trading against ruled trading: the learned trader, as the one among copies of itself trading by a
 * school, wins more than an even share (its interval above it); the ruled copy, as the one among
 * learned copies, does not win more than an even share (its interval reaches down to it).
 */
export function ruledBars(learned: { wins: number; finished: number }, ruled: { wins: number; finished: number }, size: number): Bar[] {
  const even = 1 / size;
  const [lLow, lHigh] = wilson(learned.wins, learned.finished);
  const [rLow, rHigh] = wilson(ruled.wins, ruled.finished);
  return [
    {
      name: 'The learned trader among ruled copies',
      passed: lLow > even,
      reading: `${pct(learned.wins / learned.finished)} (${pct(lLow)} to ${pct(lHigh)}) of ${learned.finished} finished games, against an even share of ${pct(even)}.`,
    },
    {
      name: 'The ruled copy among learned traders',
      passed: rLow <= even,
      reading: `${pct(ruled.wins / ruled.finished)} (${pct(rLow)} to ${pct(rHigh)}) of ${ruled.finished} finished games, against an even share of ${pct(even)}.`,
    },
  ];
}

/** A table of the agent alone finishes at least 98% of its games. */
export function finishBar(finished: number, games: number): Bar {
  return { name: 'A table of the agent alone', passed: games > 0 && finished / games >= 0.98, reading: `${pct(finished / games)} of ${games} games finished (bar 98%).` };
}
