import { randomInt } from '../rng.ts';
import { HOTEL_LEVEL } from '../types.ts';
import type { CardEffect, DeckId, Dice, PlayerId, PropertySquare, Resume } from '../types.ts';
import { charge, chargeAll, transfer } from './money.ts';
import { mustPlayer, ownedProperties, playersAfter, rentDue } from './queries.ts';
import type { Run } from './run.ts';

export type Arrival = { via: 'dice'; total: number } | { via: 'card'; nearest: boolean };

export function rollDice(run: Run): Dice {
  const queued = run.s.diceQueue.shift();
  if (queued) return queued;
  return [1 + randomInt(run.s, 6), 1 + randomInt(run.s, 6)];
}

function moveForward(run: Run, playerId: PlayerId, steps: number): void {
  const { ctx, s } = run;
  const player = mustPlayer(s, playerId);
  const from = player.position;
  const to = (from + steps) % ctx.size;
  const passedStart = steps > 0 && from + steps >= ctx.size;
  player.position = to;
  run.events.push({ type: 'MOVED', player: playerId, from, to, passedStart });
  if (passedStart) transfer(run, null, playerId, ctx.board.economy.salary, 'salary');
}

function moveBackward(run: Run, playerId: PlayerId, steps: number): void {
  const { ctx, s } = run;
  const player = mustPlayer(s, playerId);
  const from = player.position;
  const to = (((from - steps) % ctx.size) + ctx.size) % ctx.size;
  player.position = to;
  run.events.push({ type: 'MOVED', player: playerId, from, to, passedStart: false });
}

function stepsTo(run: Run, playerId: PlayerId, target: number): number {
  const from = mustPlayer(run.s, playerId).position;
  return (target - from + run.ctx.size) % run.ctx.size;
}

export function sendToJail(run: Run, playerId: PlayerId, reason: 'square' | 'card' | 'doubles'): void {
  const { ctx, s } = run;
  const player = mustPlayer(s, playerId);
  player.position = ctx.jailIndex;
  player.inJail = true;
  player.jailRolls = 0;
  if (s.turn.player === playerId) {
    s.turn.phase = 'postRoll';
    s.turn.doubles = 0;
  }
  run.events.push({ type: 'SENT_TO_JAIL', player: playerId, reason });
}

export function releaseFromJail(
  run: Run,
  playerId: PlayerId,
  how: 'doubles' | 'bail' | 'card' | 'forcedBail',
): void {
  const player = mustPlayer(run.s, playerId);
  player.inJail = false;
  player.jailRolls = 0;
  run.events.push({ type: 'LEFT_JAIL', player: playerId, how });
}

export function advanceBy(run: Run, playerId: PlayerId, dice: Dice): void {
  const total = dice[0] + dice[1];
  moveForward(run, playerId, total);
  resolveLanding(run, playerId, { via: 'dice', total });
}

export function runResume(run: Run, playerId: PlayerId, resume: Resume): void {
  switch (resume.kind) {
    case 'jailMove':
      releaseFromJail(run, playerId, 'forcedBail');
      advanceBy(run, playerId, resume.dice);
      return;
  }
}

export function resolveLanding(run: Run, playerId: PlayerId, arrival: Arrival): void {
  const { ctx, s } = run;
  const square = ctx.board.squares[mustPlayer(s, playerId).position];
  switch (square.kind) {
    case 'start':
    case 'jail':
    case 'rest':
      return;
    case 'goToJail':
      sendToJail(run, playerId, 'square');
      return;
    case 'tax':
      charge(run, playerId, null, square.amount, 'tax');
      return;
    case 'card':
      drawCard(run, playerId, square.deck);
      return;
    case 'street':
    case 'transit':
    case 'utility':
      landOnProperty(run, playerId, square, arrival);
      return;
  }
}

function landOnProperty(run: Run, playerId: PlayerId, sq: PropertySquare, arrival: Arrival): void {
  const { ctx, s } = run;
  const state = s.properties[sq.id];
  if (state.owner === null) {
    s.pending.push({ kind: 'buy', player: playerId, property: sq.id });
    run.events.push({ type: 'PROPERTY_OFFERED', player: playerId, property: sq.id });
    return;
  }
  if (state.owner === playerId || state.mortgaged) return;

  let diceTotal = arrival.via === 'dice' ? arrival.total : 0;
  if (sq.kind === 'utility' && arrival.via === 'card') {
    const dice = rollDice(run);
    run.events.push({ type: 'DICE_ROLLED', player: playerId, dice: [dice[0], dice[1]], purpose: 'utility' });
    diceTotal = dice[0] + dice[1];
  }
  const nearest = arrival.via === 'card' && arrival.nearest;
  charge(run, playerId, state.owner, rentDue(ctx, s, sq, { diceTotal, nearest }), 'rent');
}

function drawCard(run: Run, playerId: PlayerId, deckId: DeckId): void {
  const { ctx, s } = run;
  const deck = s.decks[deckId];
  const cardId = deck.shift();
  if (cardId === undefined) return;
  const card = ctx.cards.get(deckId)?.get(cardId);
  if (!card) throw new Error(`Internal error: card "${cardId}" is not in deck "${deckId}".`);
  run.events.push({ type: 'CARD_DRAWN', player: playerId, deck: deckId, card: cardId });

  if (card.effect.type === 'jailFree') {
    mustPlayer(s, playerId).jailCards.push({ deck: deckId, card: cardId });
    return;
  }
  deck.push(cardId);
  applyCard(run, playerId, card.effect);
}

function applyCard(run: Run, playerId: PlayerId, effect: CardEffect): void {
  const { ctx, s } = run;
  switch (effect.type) {
    case 'collect':
      transfer(run, null, playerId, effect.amount, 'card');
      return;
    case 'pay':
      charge(run, playerId, null, effect.amount, 'card');
      return;
    case 'collectFromEach':
      chargeAll(
        run,
        playersAfter(s, playerId).map((other) => ({
          debtor: other.id,
          creditor: playerId,
          amount: effect.amount,
        })),
        'card',
      );
      return;
    case 'payEach':
      chargeAll(
        run,
        playersAfter(s, playerId).map((other) => ({
          debtor: playerId,
          creditor: other.id,
          amount: effect.amount,
        })),
        'card',
      );
      return;
    case 'moveTo': {
      const target = ctx.squareIndex.get(effect.square);
      if (target === undefined) throw new Error(`Internal error: unknown square "${effect.square}".`);
      moveForward(run, playerId, stepsTo(run, playerId, target));
      resolveLanding(run, playerId, { via: 'card', nearest: false });
      return;
    }
    case 'moveBack':
      moveBackward(run, playerId, effect.steps);
      resolveLanding(run, playerId, { via: 'card', nearest: false });
      return;
    case 'moveToNearest': {
      const from = mustPlayer(s, playerId).position;
      for (let steps = 1; steps < ctx.size; steps++) {
        if (ctx.board.squares[(from + steps) % ctx.size].kind === effect.kind) {
          moveForward(run, playerId, steps);
          resolveLanding(run, playerId, { via: 'card', nearest: true });
          return;
        }
      }
      return;
    }
    case 'goToJail':
      sendToJail(run, playerId, 'card');
      return;
    case 'repairs': {
      let houses = 0;
      let hotels = 0;
      for (const sq of ownedProperties(ctx, s, playerId)) {
        const level = s.properties[sq.id].level;
        if (level === HOTEL_LEVEL) hotels += 1;
        else houses += level;
      }
      charge(run, playerId, null, houses * effect.perHouse + hotels * effect.perHotel, 'card');
      return;
    }
    case 'jailFree':
      return;
  }
}
