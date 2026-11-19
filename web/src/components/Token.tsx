import { createContext, useContext } from 'react';
import type { PlayerId } from '../../../src/index.ts';
import { factionOf, TOKEN_ART } from '../game/assets.ts';
import type { TokenId } from '../game/assets.ts';
import { vars } from './ui.tsx';

/** Which token each player chose, by player id. */
export const TokenContext = createContext<Record<PlayerId, TokenId>>({});

type Size = 'sm' | 'md' | 'lg' | 'xl' | 'board' | 'banner';

interface Props {
  who: PlayerId;
  /** Shows this token instead of the one the player chose. */
  token?: TokenId;
  size?: Size;
  className?: string;
}

/** A player's piece: the weapon's ink drawing on a disc of card paper, ringed in the faction's color. */
export function Token({ who, token, size = 'md', className = '' }: Props) {
  const chosen = useContext(TokenContext);
  const faction = factionOf(who);
  return (
    <span className={`token token-${size} ${className}`} style={vars({ '--c': faction.color })}>
      <img src={TOKEN_ART[token ?? chosen[who] ?? faction.token]} alt="" draggable={false} />
    </span>
  );
}
