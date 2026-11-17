import { HOTEL_LEVEL } from './types.ts';
import type {
  BoardDefinition,
  CardDefinition,
  CardId,
  DeckId,
  GroupId,
  PropertyId,
  PropertySquare,
  RuleConfig,
  SquareId,
  StreetSquare,
  TransitSquare,
  UtilitySquare,
} from './types.ts';

export interface Context {
  readonly board: BoardDefinition;
  readonly rules: RuleConfig;
  readonly size: number;
  readonly squareIndex: ReadonlyMap<SquareId, number>;
  readonly properties: ReadonlyMap<PropertyId, PropertySquare>;
  readonly propertyOrder: readonly PropertySquare[];
  readonly groups: ReadonlyMap<GroupId, readonly StreetSquare[]>;
  readonly transit: readonly TransitSquare[];
  readonly utilities: readonly UtilitySquare[];
  readonly cards: ReadonlyMap<DeckId, ReadonlyMap<CardId, CardDefinition>>;
  readonly jailIndex: number;
}

function isWholeNumber(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

export function buildContext(board: BoardDefinition, rules: RuleConfig): Context {
  const problems: string[] = [];
  const squareIndex = new Map<SquareId, number>();
  const properties = new Map<PropertyId, PropertySquare>();
  const propertyOrder: PropertySquare[] = [];
  const groups = new Map<GroupId, StreetSquare[]>();
  const transit: TransitSquare[] = [];
  const utilities: UtilitySquare[] = [];
  const jailSquares: number[] = [];
  let startSquares = 0;

  board.squares.forEach((square, index) => {
    if (squareIndex.has(square.id)) problems.push(`Duplicate square id "${square.id}".`);
    squareIndex.set(square.id, index);

    if (square.kind === 'start') startSquares += 1;
    if (square.kind === 'jail') jailSquares.push(index);
    if (square.kind === 'tax' && !isWholeNumber(square.amount)) {
      problems.push(`Tax square "${square.id}" needs a whole, non-negative amount.`);
    }
    if (square.kind === 'card' && !(square.deck in board.decks)) {
      problems.push(`Card square "${square.id}" refers to unknown deck "${square.deck}".`);
    }

    if (square.kind === 'street' || square.kind === 'transit' || square.kind === 'utility') {
      properties.set(square.id, square);
      propertyOrder.push(square);
      if (!isWholeNumber(square.price, 1)) problems.push(`"${square.id}" needs a positive price.`);
      if (!isWholeNumber(square.mortgageValue)) {
        problems.push(`"${square.id}" needs a whole mortgage value.`);
      }
    }
    if (square.kind === 'street') {
      const streets = groups.get(square.group) ?? [];
      streets.push(square);
      groups.set(square.group, streets);
      if (!isWholeNumber(square.buildingCost, 1)) {
        problems.push(`"${square.id}" needs a positive building cost.`);
      }
      if (square.rents.length !== HOTEL_LEVEL + 1 || !square.rents.every((r) => isWholeNumber(r))) {
        problems.push(`"${square.id}" needs ${HOTEL_LEVEL + 1} whole rent values.`);
      }
    }
    if (square.kind === 'transit') transit.push(square);
    if (square.kind === 'utility') utilities.push(square);
  });

  if (board.squares.length === 0 || board.squares[0].kind !== 'start') {
    problems.push('Square 0 must be the start square.');
  }
  if (startSquares !== 1) problems.push('A board needs exactly one start square.');
  if (jailSquares.length !== 1) problems.push('A board needs exactly one jail square.');
  if (board.transitRents.length < transit.length) {
    problems.push('transitRents needs one entry per transit square.');
  }
  if (board.utilityMultipliers.length < utilities.length) {
    problems.push('utilityMultipliers needs one entry per utility square.');
  }

  const cards = new Map<DeckId, Map<CardId, CardDefinition>>();
  for (const [deckId, deck] of Object.entries(board.decks)) {
    const byId = new Map<CardId, CardDefinition>();
    for (const card of deck) {
      if (byId.has(card.id)) problems.push(`Duplicate card id "${card.id}" in deck "${deckId}".`);
      byId.set(card.id, card);
      const effect = card.effect;
      if (effect.type === 'moveTo' && !squareIndex.has(effect.square)) {
        problems.push(`Card "${card.id}" moves to unknown square "${effect.square}".`);
      }
      if (effect.type === 'moveToNearest') {
        const count = effect.kind === 'transit' ? transit.length : utilities.length;
        if (count === 0) problems.push(`Card "${card.id}" needs a ${effect.kind} square on the board.`);
      }
    }
    if (!deck.some((card) => card.effect.type !== 'jailFree')) {
      problems.push(`Deck "${deckId}" needs at least one card that returns to the deck.`);
    }
    cards.set(deckId, byId);
  }

  const { economy } = board;
  for (const key of ['startingCash', 'salary', 'bail', 'houses', 'hotels'] as const) {
    if (!isWholeNumber(economy[key])) problems.push(`economy.${key} must be a whole, non-negative number.`);
  }
  if (!isWholeNumber(rules.minPlayers, 2) || !isWholeNumber(rules.maxPlayers, rules.minPlayers)) {
    problems.push('Rules need 2 <= minPlayers <= maxPlayers.');
  }
  if (!isWholeNumber(rules.doublesToJail, 1) || !isWholeNumber(rules.maxJailRolls, 1)) {
    problems.push('doublesToJail and maxJailRolls must be at least 1.');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid board "${board.id}":\n- ${problems.join('\n- ')}`);
  }

  return {
    board,
    rules,
    size: board.squares.length,
    squareIndex,
    properties,
    propertyOrder,
    groups,
    transit,
    utilities,
    cards,
    jailIndex: jailSquares[0],
  };
}
