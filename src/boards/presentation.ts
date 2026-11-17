import type { CardId, DeckId, GroupId, SquareId } from '../types.ts';

/** A name shown to players, in English and Chinese. */
export interface Label {
  name: string;
  nameZh: string;
}

export interface GroupStyle extends Label {
  /** Color of the group band, as a CSS hex value. */
  color: string;
}

export interface SquareStyle {
  nameZh: string;
  /** Path to the square's portrait, relative to the repository root. */
  portrait?: string;
}

/**
 * Everything a client needs to draw a board that the engine itself ignores:
 * names in both languages, group colors, card wording in Chinese and art.
 */
export interface BoardPresentation {
  board: string;
  currency: Label & { unitZh: string };
  buildings: { house: Label; hotel: Label };
  decks: Readonly<Record<DeckId, Label>>;
  groups: Readonly<Record<GroupId, GroupStyle>>;
  squares: Readonly<Record<SquareId, SquareStyle>>;
  cards: Readonly<Record<CardId, { textZh: string }>>;
  portraitSize: { width: number; height: number };
}
