import type { BoardDefinition, CardDefinition, GroupId, StreetSquare } from '../src/index.ts';

function street(id: string, group: GroupId, price: number, buildingCost: number, base: number): StreetSquare {
  return {
    kind: 'street',
    id,
    name: id,
    group,
    price,
    buildingCost,
    rents: [base, base * 5, base * 10, base * 20, base * 30, base * 40],
    mortgageValue: price / 2,
  };
}

const transit = (id: string) => ({ kind: 'transit', id, name: id, price: 100, mortgageValue: 50 }) as const;

const utility = (id: string) => ({ kind: 'utility', id, name: id, price: 80, mortgageValue: 40 }) as const;

const card = (id: string, effect: CardDefinition['effect']): CardDefinition => ({ id, text: '', effect });

export const fixture: BoardDefinition = {
  id: 'fixture',
  name: 'fixture',
  squares: [
    { kind: 'start', id: 'start', name: 'start' },
    street('g1-1', 'g1', 70, 50, 4),
    transit('t1'),
    street('g1-2', 'g1', 80, 50, 6),
    { kind: 'tax', id: 'tax', name: 'tax', amount: 150 },
    { kind: 'card', id: 'card-q', name: 'card-q', deck: 'q' },
    street('g2-1', 'g2', 100, 60, 8),
    street('g2-2', 'g2', 100, 60, 8),
    street('g2-3', 'g2', 120, 60, 10),
    { kind: 'jail', id: 'jail', name: 'jail' },
    street('g3-1', 'g3', 140, 80, 12),
    utility('u1'),
    street('g3-2', 'g3', 140, 80, 12),
    street('g4-1', 'g4', 160, 80, 14),
    { kind: 'card', id: 'card-p', name: 'card-p', deck: 'p' },
    street('g4-2', 'g4', 160, 80, 14),
    { kind: 'rest', id: 'rest', name: 'rest' },
    transit('t2'),
    utility('u2'),
    street('g5-1', 'g5', 200, 100, 20),
    street('g5-2', 'g5', 200, 100, 20),
    { kind: 'goToJail', id: 'go-to-jail', name: 'go-to-jail' },
    street('g5-3', 'g5', 240, 100, 30),
  ],
  transitRents: [25, 50],
  utilityMultipliers: [3, 9],
  decks: {
    p: [
      card('p-start', { type: 'moveTo', square: 'start' }),
      card('p-ahead', { type: 'moveTo', square: 'g5-3' }),
      card('p-behind', { type: 'moveTo', square: 'g3-1' }),
      card('p-transit', { type: 'moveToNearest', kind: 'transit' }),
      card('p-utility', { type: 'moveToNearest', kind: 'utility' }),
      card('p-back', { type: 'moveBack', steps: 3 }),
      card('p-jail', { type: 'goToJail' }),
      card('p-free', { type: 'jailFree' }),
      card('p-collect', { type: 'collect', amount: 50 }),
      card('p-repairs', { type: 'repairs', perHouse: 20, perHotel: 80 }),
      card('p-pay-each', { type: 'payEach', amount: 40 }),
    ],
    q: [
      card('q-collect', { type: 'collect', amount: 100 }),
      card('q-pay', { type: 'pay', amount: 60 }),
      card('q-free', { type: 'jailFree' }),
      card('q-jail', { type: 'goToJail' }),
      card('q-from-each', { type: 'collectFromEach', amount: 20 }),
      card('q-repairs', { type: 'repairs', perHouse: 30, perHotel: 90 }),
    ],
  },
  economy: { startingCash: 1000, salary: 100, bail: 40, houses: 20, hotels: 6 },
};
