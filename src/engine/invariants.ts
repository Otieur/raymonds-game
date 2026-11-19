import type { Context } from '../context.ts';
import { HOTEL_LEVEL } from '../types.ts';
import type { GameState, PlayerId } from '../types.ts';
import { buildingStep, findPlayer, isBuildingLevel, standings, topPending } from './queries.ts';

export function checkInvariants(ctx: Context, s: GameState): string[] {
  const problems: string[] = [];
  const isActive = (id: PlayerId) => {
    const player = findPlayer(s, id);
    return !!player && !player.bankrupt;
  };

  for (const player of s.players) {
    if (!Number.isInteger(player.cash) || player.cash < 0) {
      problems.push(`${player.id} holds an invalid cash amount (${player.cash}).`);
    }
    if (player.position < 0 || player.position >= ctx.size) {
      problems.push(`${player.id} is off the board.`);
    }
    if (player.inJail && player.position !== ctx.jailIndex) {
      problems.push(`${player.id} is jailed away from the jail square.`);
    }
    if (player.bankrupt && (player.cash !== 0 || player.jailCards.length > 0 || player.inJail)) {
      problems.push(`Bankrupt player ${player.id} still holds assets.`);
    }
  }

  let houses = 0;
  let hotels = 0;
  for (const sq of ctx.propertyOrder) {
    const state = s.properties[sq.id];
    if (!state) {
      problems.push(`Property ${sq.id} has no state.`);
      continue;
    }
    if (state.owner !== null && !isActive(state.owner)) {
      problems.push(`${sq.id} is owned by ${state.owner}, who is not in the game.`);
    }
    if (state.mortgaged && state.owner === null) problems.push(`${sq.id} is mortgaged but unowned.`);
    if (!isBuildingLevel(ctx, state.level)) {
      problems.push(`${sq.id} has an invalid building level (${state.level}).`);
    }
    if (sq.kind !== 'street' && state.level !== 0) problems.push(`${sq.id} cannot hold buildings.`);
    if (state.level === HOTEL_LEVEL) hotels += 1;
    else houses += state.level;
  }

  for (const [group, streets] of ctx.groups) {
    const states = streets.map((st) => s.properties[st.id]);
    const levels = states.map((state) => state.level);
    if (levels.every((level) => level === 0)) continue;
    const owner = states[0].owner;
    if (owner === null || states.some((state) => state.owner !== owner)) {
      problems.push(`Group ${group} has buildings without a single owner.`);
    }
    if (states.some((state) => state.mortgaged)) {
      problems.push(`Group ${group} has buildings alongside a mortgage.`);
    }
    const steps = levels.map((level) => buildingStep(ctx, level));
    if (Math.max(...steps) - Math.min(...steps) > 1) {
      problems.push(`Group ${group} is built unevenly (${levels.join(', ')}).`);
    }
  }

  if (s.bank.houses < 0 || s.bank.hotels < 0) problems.push('The bank holds a negative building supply.');
  if (s.bank.houses + houses !== ctx.board.economy.houses) {
    problems.push(`House count is off: ${s.bank.houses} in the bank, ${houses} on the board.`);
  }
  if (s.bank.hotels + hotels !== ctx.board.economy.hotels) {
    problems.push(`Hotel count is off: ${s.bank.hotels} in the bank, ${hotels} on the board.`);
  }

  for (const [deckId, definitions] of ctx.cards) {
    const located = [...(s.decks[deckId] ?? [])];
    for (const player of s.players) {
      for (const held of player.jailCards) {
        if (held.deck !== deckId) continue;
        located.push(held.card);
        if (definitions.get(held.card)?.effect.type !== 'jailFree') {
          problems.push(`${player.id} holds ${held.card}, which is not a card to keep.`);
        }
      }
    }
    const expected = [...definitions.keys()].sort();
    if (located.sort().join('|') !== expected.join('|')) {
      problems.push(`Deck ${deckId} has lost or duplicated cards.`);
    }
  }

  const alive = s.players.filter((p) => !p.bankrupt);
  const limit = ctx.rules.endAfterBankruptcies;
  const limitReached = limit !== null && s.players.length - alive.length >= limit;
  if (s.winner !== null) {
    if (!alive.some((p) => p.id === s.winner)) problems.push('The winner is not still in the game.');
    if (alive.length !== 1 && !limitReached) problems.push('The game ended while it should go on.');
    if (alive.length > 1 && standings(ctx, s)[0].player !== s.winner) {
      problems.push('The winner is not the richest remaining player.');
    }
    if (s.pending.length > 0 || s.auctionQueue.length > 0) problems.push('A finished game has open decisions.');
    return problems;
  }
  if (alive.length < 2) problems.push('The game should be over.');
  if (limitReached) problems.push('The bankruptcy limit was reached but the game goes on.');
  if (!isActive(s.turn.player)) problems.push(`The turn belongs to ${s.turn.player}, who is not in the game.`);

  const opening = s.opening ?? null;
  if ((s.turn.phase === 'order') !== (opening !== null)) {
    problems.push('The opening roll and the turn phase disagree.');
  } else if (opening !== null) {
    const ranked = opening.groups.flat();
    const ids = s.players.map((p) => p.id);
    if (ranked.length !== ids.length || [...ranked].sort().join('|') !== [...ids].sort().join('|')) {
      problems.push('The opening roll does not rank every player exactly once.');
    }
    const tied = new Set(opening.groups.filter((group) => group.length > 1).flat());
    if (tied.size === 0) problems.push('The opening roll is settled but play has not begun.');
    if (opening.groups.some((group) => group.length === 0)) problems.push('The opening roll has an empty group.');
    for (const id of Object.keys(opening.rolls)) {
      if (!tied.has(id)) problems.push(`${id} has an opening throw without being in a tie.`);
    }
    if (!tied.has(s.turn.player) || s.turn.player in opening.rolls) {
      problems.push(`${s.turn.player} is not due an opening throw.`);
    }
    if (s.pending.length > 0 || s.auctionQueue.length > 0) problems.push('The opening roll has open decisions.');
  }
  if (s.turn.doubles >= ctx.rules.doublesToJail) problems.push('The doubles count was not reset.');

  for (const item of s.pending) {
    const involved: PlayerId[] = [];
    switch (item.kind) {
      case 'buy':
      case 'mortgageTransfer':
        involved.push(item.player);
        break;
      case 'jailExit': {
        involved.push(item.player);
        const jailed = findPlayer(s, item.player);
        if (!jailed?.inJail || jailed.jailCards.length === 0) {
          problems.push(`${item.player} has a jail exit to choose but is not jailed with a card.`);
        }
        break;
      }
      case 'debt':
        involved.push(item.debtor);
        if (item.creditor !== null) involved.push(item.creditor);
        if (item.amount <= 0) problems.push('A pending debt has no amount.');
        break;
      case 'trade':
        involved.push(item.offer.from, item.offer.to);
        break;
      case 'auction':
        involved.push(...item.bidders);
        if (s.properties[item.property].owner !== null) problems.push(`${item.property} is being auctioned but is owned.`);
        break;
      case 'buildingAuction':
        involved.push(...item.bidders);
        if (!item.bidders.includes(item.highBidder)) problems.push('The high bidder left a building auction.');
        break;
    }
    for (const id of involved) {
      if (!isActive(id)) problems.push(`An open ${item.kind} decision involves ${id}, who is not in the game.`);
    }
  }

  const top = topPending(s);
  if (top?.kind === 'debt' && (findPlayer(s, top.debtor)?.cash ?? 0) >= top.amount) {
    problems.push('A payable debt was left unsettled.');
  }
  for (const id of s.auctionQueue) {
    if (s.properties[id].owner !== null) problems.push(`${id} is queued for auction but is owned.`);
  }
  return problems;
}
