/**
 * A style cut into seven parts, so that a new style can take each part from a different school,
 * and two styles can be blended in any proportion.
 */
import { SETS } from './style.ts';
import type { Style } from './style.ts';

export type Part = 'value' | 'buy' | 'bid' | 'build' | 'cash' | 'offer' | 'answer';

export const PARTS: Record<Part, (keyof Style)[]> = {
  value: ['valuation', 'partFactor', 'completeFactor', 'passStep', 'worksStep', 'prefer'],
  buy: ['buy', 'buyKeep', 'mortgageToBuy', 'declinePoor'],
  bid: ['bidCap', 'bidCeiling', 'blockBonus', 'bidKeep', 'bidStep', 'driveUp', 'buildingBid'],
  build: ['buildTarget', 'buildBeyond', 'buildOrder', 'buildSpread', 'buildNear', 'mortgageToBuild', 'holdHouses', 'huntFailing'],
  cash: ['reserve', 'reserveBuilt', 'reserveThreat', 'redeemSpare', 'jailStay', 'jailStayBuilt'],
  offer: ['proposeRate', 'offerLow', 'offerHigh', 'offerFloor', 'swaps', 'sellOffers', 'distressOffers', 'leaveCash', 'giveUpBelow',
    'offerBy', 'completeBy', 'openShare', 'maxShare', 'raiseStep', 'probeGap', 'probeDrop', 'earlyOffers', 'earlyBefore', 'earlyNeed',
    'denyOffers', 'denyThreat', 'denyShare', 'denyRank', 'estateOffers', 'failBelow', 'rescue', 'debtOffers', 'debtSales',
    'courtAllies', 'giftEdge', 'allyAt', 'allyTurns'],
  answer: ['acceptMargin', 'completionPenalty', 'neverSell', 'shunLeader', 'answerBy', 'acceptEdge', 'againstLeader', 'forWeak', 'reciprocity', 'goodwillBound', 'unreturned', 'coldMood', 'coldEdge'],
};

/** Fields about the style as a whole rather than one kind of decision. */
export const META_FIELDS: (keyof Style)[] = ['name', 'moodWindow', 'moodFloor', 'blockMode', 'afterFirstGroup', 'bySize'];

/** A style that takes each named part from the style given for it, and the rest from `base`. */
export function compose(base: Style, parts: Partial<Record<Part, Style>>, name = base.name): Style {
  const out = { ...base, name } as Record<string, unknown>;
  for (const [part, source] of Object.entries(parts) as [Part, Style][]) {
    for (const field of PARTS[part]) out[field] = structuredClone(source[field]);
  }
  return out as unknown as Style;
}

const lerp = (a: number, b: number, t: number) => (a === b ? a : a + (b - a) * t);

/** A style between two: t = 0 is a, t = 1 is b. */
export function blend(a: Style, b: Style, t: number, name = `${a.name}~${b.name}`): Style {
  const nearer = <T>(x: T, y: T): T => (t < 0.5 ? x : y);
  const out: Record<string, unknown> = { name };
  for (const key of Object.keys(a) as (keyof Style)[]) {
    if (key === 'name') continue;
    const x = a[key] as unknown;
    const y = b[key] as unknown;
    if (key === 'buildTarget') out[key] = Math.round(lerp(a.buildTarget, b.buildTarget, t));
    else if (key === 'neverSell') out[key] = t < 0.5 ? [...a.neverSell] : [...new Set([...a.neverSell, ...b.neverSell])];
    else if (key === 'buy' || key === 'bidCap') {
      out[key] = Object.fromEntries(SETS.map((set) => [set, lerp(a[key][set], b[key][set], t)]));
    } else if (key === 'prefer') {
      const keys = new Set([...Object.keys(a.prefer), ...Object.keys(b.prefer)]) as Set<keyof Style['prefer']>;
      out[key] = Object.fromEntries([...keys].map((set) => [set, lerp(a.prefer[set] ?? 1, b.prefer[set] ?? 1, t)]));
    } else if (key === 'bidCeiling') {
      const keys = new Set([...Object.keys(a.bidCeiling), ...Object.keys(b.bidCeiling)]) as Set<keyof Style['bidCeiling']>;
      const entries: [string, number][] = [];
      for (const set of keys) {
        const p = a.bidCeiling[set];
        const q = b.bidCeiling[set];
        if (p !== undefined && q !== undefined) entries.push([set, lerp(p, q, t)]);
        else {
          const kept = nearer(p, q);
          if (kept !== undefined) entries.push([set, kept]);
        }
      }
      out[key] = Object.fromEntries(entries);
    } else if (typeof x === 'number' && typeof y === 'number') out[key] = lerp(x, y, t);
    else out[key] = structuredClone(nearer(x, y));
  }
  return out as unknown as Style;
}
