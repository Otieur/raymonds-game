/**
 * The action codec: 188 discrete actions, a mask of the legal ones, and the decoding of an index
 * into an engine action or a step of drafting an offer.
 */
import type { Context } from '../context.ts';
import type { Engine } from '../engine/engine.ts';
import { duesInReach, viewOf } from '../sim/measures.ts';
import type { Action, GameState, LegalAction, PlayerId, PropertySquare, StreetSquare } from '../types.ts';

export const ACTIONS = 188;
export const ACTIONS_VERSION = 2;

export const FIXED = [
  'ROLL',
  'END_TURN',
  'PAY_BAIL',
  'USE_JAIL_CARD',
  'BUY',
  'DECLINE',
  'PASS',
  'ACCEPT_TRADE',
  'REJECT_TRADE',
  'CANCEL_TRADE',
  'DECLARE_BANKRUPTCY',
  'LIFT',
  'KEEP',
] as const;
export const BUILD0 = 13;
export const SELL0 = 35;
export const MORTGAGE0 = 57;
export const UNMORTGAGE0 = 85;
export const BID0 = 113;
export const ASK0 = 121;
export const GIVE0 = 149;
export const GIVE_NOTHING = 177;
export const CASH0 = 178;
export const DROP = 187;

/** Cash from proposer to partner, as a multiple of the list price of the property asked for. The ninth level is all spare cash. */
export const CASH_LEVELS = [-1, -0.5, 0, 0.5, 1, 1.5, 2, 3];

export interface Draft {
  stage: 'none' | 'give' | 'cash';
  partner: PlayerId | null;
  ask: number;
  give: number | null;
}
export const emptyDraft = (): Draft => ({ stage: 'none', partner: null, ask: -1, give: null });

export interface CodecOptions {
  drafting: boolean;
  /** Offers this seat may still send this turn. */
  proposalsLeft: number;
  /** Property indices this seat was refused this turn. */
  refused: Set<number>;
}

export type Decoded = { kind: 'engine'; action: Action } | { kind: 'draft'; draft: Draft };

export interface Codec {
  mask: Uint8Array;
  decode(index: number): Decoded;
  /** The bid amount of each legal bid level, for the observation and for tests. */
  bids: (number | null)[];
}

const streetsOf = (ctx: Context) => ctx.propertyOrder.filter((sq): sq is StreetSquare => sq.kind === 'street');

function rentGain(ctx: Context, state: GameState, sq: StreetSquare): number {
  const level = state.properties[sq.id].level;
  const next = level === ctx.rules.housesBeforeHotel ? 5 : level + 1;
  return (sq.rents[next] - sq.rents[level]) / sq.buildingCost;
}

/** The legal actions of `actor` as indices, and how to decode each. */
export function codecFor(ctx: Context, engine: Engine, state: GameState, actor: PlayerId, draft: Draft, options: CodecOptions): Codec {
  const mask = new Uint8Array(ACTIONS);
  const decoders = new Map<number, () => Decoded>();
  const allow = (index: number, decode: () => Decoded) => {
    mask[index] = 1;
    decoders.set(index, decode);
  };
  const engineAction = (action: Action) => (): Decoded => ({ kind: 'engine', action });
  const bids: (number | null)[] = new Array(8).fill(null);
  const streets = streetsOf(ctx);
  const props = ctx.propertyOrder;

  if (draft.stage === 'none') {
    const legal = engine.legalActions(state, actor);
    const has = (type: LegalAction['type']) => legal.some((a) => a.type === type);
    const simple: [number, LegalAction['type'], Action][] = [
      [0, 'ROLL', { type: 'ROLL', player: actor }],
      [1, 'END_TURN', { type: 'END_TURN', player: actor }],
      [2, 'PAY_BAIL', { type: 'PAY_BAIL', player: actor }],
      [3, 'USE_JAIL_CARD', { type: 'USE_JAIL_CARD', player: actor }],
      [4, 'BUY', { type: 'BUY', player: actor }],
      [5, 'DECLINE', { type: 'DECLINE', player: actor }],
      [6, 'PASS', { type: 'PASS', player: actor }],
      [7, 'ACCEPT_TRADE', { type: 'ACCEPT_TRADE', player: actor }],
      [8, 'REJECT_TRADE', { type: 'REJECT_TRADE', player: actor }],
      [9, 'CANCEL_TRADE', { type: 'CANCEL_TRADE', player: actor }],
      [10, 'DECLARE_BANKRUPTCY', { type: 'DECLARE_BANKRUPTCY', player: actor }],
    ];
    for (const [index, type, action] of simple) if (has(type)) allow(index, engineAction(action));
    for (const a of legal) {
      if (a.type === 'SETTLE_TRANSFER') allow(a.lift ? 11 : 12, engineAction(a));
      if (a.type === 'BUILD') allow(BUILD0 + streets.findIndex((sq) => sq.id === a.property), engineAction(a));
      if (a.type === 'SELL_BUILDING') allow(SELL0 + streets.findIndex((sq) => sq.id === a.property), engineAction(a));
      if (a.type === 'MORTGAGE') allow(MORTGAGE0 + props.findIndex((sq) => sq.id === a.property), engineAction(a));
      if (a.type === 'UNMORTGAGE') allow(UNMORTGAGE0 + props.findIndex((sq) => sq.id === a.property), engineAction(a));
    }

    const bid = legal.find((a): a is Extract<LegalAction, { type: 'BID' }> => a.type === 'BID');
    const top = state.pending[state.pending.length - 1];
    if (bid && top && (top.kind === 'auction' || top.kind === 'buildingAuction')) {
      let price: number;
      let property: string | undefined;
      let min = bid.min;
      if (top.kind === 'auction') price = (ctx.properties.get(top.property) as PropertySquare).price;
      else {
        const target = [...(bid.targets ?? [])].sort(
          (a, b) => rentGain(ctx, state, ctx.properties.get(b.property) as StreetSquare) - rentGain(ctx, state, ctx.properties.get(a.property) as StreetSquare),
        )[0];
        property = target?.property;
        min = target?.min ?? bid.min;
        price = (ctx.properties.get(property ?? '') as StreetSquare | undefined)?.buildingCost ?? 0;
      }
      if (top.kind === 'auction' || property) {
        const levels = [min, min + 10, 0.5 * price, 0.75 * price, price, 1.25 * price, 1.5 * price, bid.max].map(Math.round);
        const seen = new Set<number>();
        levels.forEach((amount, level) => {
          if (amount < min || amount > bid.max || seen.has(amount)) return;
          seen.add(amount);
          bids[level] = amount;
          const action: Action = property ? { type: 'BID', player: actor, amount, property } : { type: 'BID', player: actor, amount };
          allow(BID0 + level, engineAction(action));
        });
      }
    }

    // Drafting starts only on the seat's own free turn.
    const offer = legal.find((a): a is Extract<LegalAction, { type: 'PROPOSE_TRADE' }> => a.type === 'PROPOSE_TRADE');
    if (options.drafting && offer && !top && state.turn.player === actor && options.proposalsLeft > 0) {
      props.forEach((sq, k) => {
        const owner = state.properties[sq.id].owner;
        if (!owner || owner === actor || !offer.partners.includes(owner) || options.refused.has(k)) return;
        if (sq.kind === 'street' && groupHasBuildings(ctx, state, sq.group)) return;
        allow(ASK0 + k, () => ({ kind: 'draft', draft: { stage: 'give', partner: owner, ask: k, give: null } }));
      });
    }
  } else if (draft.stage === 'give') {
    props.forEach((sq, k) => {
      if (state.properties[sq.id].owner !== actor) return;
      if (sq.kind === 'street' && groupHasBuildings(ctx, state, sq.group)) return;
      allow(GIVE0 + k, () => ({ kind: 'draft', draft: { ...draft, stage: 'cash', give: k } }));
    });
    allow(GIVE_NOTHING, () => ({ kind: 'draft', draft: { ...draft, stage: 'cash', give: null } }));
    allow(DROP, () => ({ kind: 'draft', draft: emptyDraft() }));
  } else {
    const me = state.players.find((p) => p.id === actor);
    const asked = props[draft.ask];
    if (me && asked && draft.partner) {
      const spare = Math.max(0, me.cash - duesInReach(viewOf(ctx, state), me).largest);
      const amounts = [...CASH_LEVELS.map((m) => Math.round(m * asked.price)), spare];
      amounts.forEach((cash, level) => {
        const action: Action = {
          type: 'PROPOSE_TRADE',
          player: actor,
          to: draft.partner as PlayerId,
          give: { cash: Math.max(0, cash), properties: draft.give === null ? [] : [props[draft.give].id], jailCards: 0 },
          receive: { cash: Math.max(0, -cash), properties: [asked.id], jailCards: 0 },
        };
        if (engine.validate(state, action) === null) allow(CASH0 + level, engineAction(action));
      });
    }
    allow(DROP, () => ({ kind: 'draft', draft: emptyDraft() }));
  }

  return {
    mask,
    bids,
    decode(index: number): Decoded {
      const decoder = decoders.get(index);
      if (!decoder) throw new Error(`Action ${index} is not legal here.`);
      return decoder();
    },
  };
}

function groupHasBuildings(ctx: Context, state: GameState, group: string): boolean {
  return (ctx.groups.get(group) ?? []).some((sq) => state.properties[sq.id].level > 0);
}

export const legalIndices = (mask: Uint8Array): number[] => {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
  return out;
};
