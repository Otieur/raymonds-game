import type { Engine } from '../engine/engine.ts';
import type { Action, GameState, LegalAction, PlayerId, TradeSide } from '../types.ts';

type Random = () => number;

function pick<T>(items: readonly T[], random: Random): T {
  return items[Math.floor(random() * items.length)];
}

function ofType<T extends LegalAction['type']>(
  legal: LegalAction[],
  type: T,
): Extract<LegalAction, { type: T }>[] {
  return legal.filter((action): action is Extract<LegalAction, { type: T }> => action.type === type);
}

function randomOffer(
  engine: Engine,
  state: GameState,
  actor: PlayerId,
  legal: LegalAction[],
  random: Random,
): Action | null {
  const proposal = ofType(legal, 'PROPOSE_TRADE')[0];
  if (!proposal) return null;
  const partner = pick(proposal.partners, random);

  const side = (owner: PlayerId): TradeSide => {
    const player = state.players.find((p) => p.id === owner);
    const owned = Object.keys(state.properties).filter((id) => state.properties[id].owner === owner);
    const cashOnHand = player?.cash ?? 0;
    return {
      cash: random() < 0.5 ? Math.floor(random() * Math.min(cashOnHand, 200)) : 0,
      properties: owned.length > 0 && random() < 0.7 ? [pick(owned, random)] : [],
      jailCards: (player?.jailCards.length ?? 0) > 0 && random() < 0.3 ? 1 : 0,
    };
  };

  const action: Action = {
    type: 'PROPOSE_TRADE',
    player: actor,
    to: partner,
    give: side(actor),
    receive: side(partner),
  };
  return engine.validate(state, action) === null ? action : null;
}

function freeTurnAction(
  engine: Engine,
  state: GameState,
  actor: PlayerId,
  legal: LegalAction[],
  random: Random,
): Action | null {
  if (random() < 0.08) {
    for (const other of state.players) {
      if (other.id === actor || other.bankrupt) continue;
      const builds = ofType(engine.legalActions(state, other.id), 'BUILD');
      if (builds.length > 0) return pick(builds, random);
    }
  }

  const builds = ofType(legal, 'BUILD');
  if (builds.length > 0 && random() < 0.6) return pick(builds, random);
  const lifts = ofType(legal, 'UNMORTGAGE');
  if (lifts.length > 0 && random() < 0.3) return pick(lifts, random);
  const mortgages = ofType(legal, 'MORTGAGE');
  if (mortgages.length > 0 && random() < 0.02) return pick(mortgages, random);
  const sales = ofType(legal, 'SELL_BUILDING');
  if (sales.length > 0 && random() < 0.02) return pick(sales, random);
  if (random() < 0.03) {
    const offer = randomOffer(engine, state, actor, legal, random);
    if (offer) return offer;
  }

  const jailExits = [...ofType(legal, 'PAY_BAIL'), ...ofType(legal, 'USE_JAIL_CARD')];
  if (jailExits.length > 0 && random() < 0.5) return pick(jailExits, random);
  return ofType(legal, 'ROLL')[0] ?? ofType(legal, 'END_TURN')[0] ?? null;
}

export function chooseRandomAction(engine: Engine, state: GameState, random: Random): Action | null {
  const waiting = engine.awaiting(state);
  if (waiting.length === 0) return null;
  const actor = pick(waiting, random);
  const legal = engine.legalActions(state, actor);
  const top = state.pending[state.pending.length - 1];
  if (!top) return freeTurnAction(engine, state, actor, legal, random);

  switch (top.kind) {
    case 'buy': {
      const buy = ofType(legal, 'BUY')[0];
      return buy && random() < 0.75 ? buy : { type: 'DECLINE', player: actor };
    }
    case 'auction':
    case 'buildingAuction': {
      const bid = ofType(legal, 'BID')[0];
      if (!bid || random() >= 0.5) return { type: 'PASS', player: actor };
      const target = bid.targets ? pick(bid.targets, random) : undefined;
      const floor = target ? target.min : bid.min;
      const amount = Math.min(bid.max, floor + Math.floor(random() * 40));
      return target
        ? { type: 'BID', player: actor, amount, property: target.property }
        : { type: 'BID', player: actor, amount };
    }
    case 'debt': {
      const giveUp = ofType(legal, 'DECLARE_BANKRUPTCY')[0];
      if (giveUp) return giveUp;
      const raise = [
        ...ofType(legal, 'SELL_BUILDING'),
        ...ofType(legal, 'SELL_BUILDINGS'),
        ...ofType(legal, 'MORTGAGE'),
      ];
      return raise.length > 0 ? pick(raise, random) : null;
    }
    case 'mortgageTransfer': {
      const canLift = legal.some((action) => action.type === 'SETTLE_TRANSFER' && action.lift);
      return { type: 'SETTLE_TRANSFER', player: actor, lift: canLift && random() < 0.5 };
    }
    case 'trade': {
      const accept = ofType(legal, 'ACCEPT_TRADE')[0];
      return accept && random() < 0.5 ? accept : { type: 'REJECT_TRADE', player: actor };
    }
    case 'jailExit': {
      const bail = ofType(legal, 'PAY_BAIL')[0];
      return bail && random() < 0.5 ? bail : { type: 'USE_JAIL_CARD', player: actor };
    }
  }
}
