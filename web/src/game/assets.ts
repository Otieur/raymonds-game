import type { PropertySquare, Square } from '../../../src/index.ts';

const files = import.meta.glob<string>('../../../assets/three-kingdoms/portraits/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** Portrait URL for each street, keyed by square id. */
export const PORTRAITS: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  PORTRAITS[path.slice(path.lastIndexOf('/') + 1, -'.jpg'.length)] = url;
}

const tokenFiles = import.meta.glob<string>('../../../assets/three-kingdoms/tokens/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export type TokenId = 'sword' | 'crossbow' | 'axe' | 'halberd';

/** The playing pieces a player can choose from: the ink drawing of each weapon, by token id. */
export const TOKEN_ART = {} as Record<TokenId, string>;
for (const [path, url] of Object.entries(tokenFiles)) {
  TOKEN_ART[path.slice(path.lastIndexOf('/') + 1, -'.webp'.length) as TokenId] = url;
}

export const TOKENS: readonly { id: TokenId; zh: string; en: string }[] = [
  { id: 'sword', zh: '青釭剑', en: 'Sword' },
  { id: 'crossbow', zh: '诸葛连弩', en: 'Crossbow' },
  { id: 'axe', zh: '贯石斧', en: 'Axe' },
  { id: 'halberd', zh: '方天画戟', en: 'Halberd' },
];

export interface Faction {
  id: string;
  zh: string;
  en: string;
  color: string;
  /** The token the faction holds until its player picks another. */
  token: TokenId;
}

/** The four sides a player can take, in seat order. */
export const FACTIONS: readonly Faction[] = [
  { id: 'wei', zh: '魏', en: 'Wei', color: '#3f78d8', token: 'sword' },
  { id: 'shu', zh: '蜀', en: 'Shu', color: '#d23a2e', token: 'crossbow' },
  { id: 'wu', zh: '吴', en: 'Wu', color: '#33a65a', token: 'axe' },
  { id: 'qun', zh: '群', en: 'Qun', color: '#a9adba', token: 'halberd' },
];

/** The faction a player id stands for. Player ids are faction ids. */
export function factionOf(id: string): Faction {
  return FACTIONS.find((faction) => faction.id === id) ?? FACTIONS[0];
}

/** The single character painted on a square that has no portrait. */
export function glyphOf(sq: Square): string {
  switch (sq.kind) {
    case 'transit':
      return '关';
    case 'utility':
      return sq.id === 'salt-works' ? '盐' : '铁';
    case 'tax':
      return '赋';
    case 'card':
      return sq.deck === 'pouch' ? '囊' : '诏';
    default:
      return '';
  }
}

export function isProperty(sq: Square): sq is PropertySquare {
  return sq.kind === 'street' || sq.kind === 'transit' || sq.kind === 'utility';
}

/** Ink or paper, whichever reads on the given background color. */
export function inkOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance = (0.299 * (value >> 16) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return luminance > 0.6 ? '#1a140c' : '#fff6e0';
}
