import { HOTEL_LEVEL, threeKingdomsPresentation as look } from '../../../src/index.ts';
import type { Square, SquareId } from '../../../src/index.ts';
import { factionOf, glyphOf, isProperty, PORTRAITS } from '../game/assets.ts';
import type { GameStore, Snapshot } from '../game/store.ts';
import { useTongue } from '../i18n.tsx';
import { Center } from './Center.tsx';
import { vars } from './ui.tsx';
import { Token } from './Token.tsx';

type Side = 'bottom' | 'left' | 'top' | 'right';

/** Where square `index` sits on the 11 by 11 grid: start at the bottom right, then clockwise. */
function place(index: number): { row: number; col: number; side: Side } {
  if (index <= 10) return { row: 11, col: 11 - index, side: 'bottom' };
  if (index < 20) return { row: 21 - index, col: 1, side: 'left' };
  if (index <= 30) return { row: 1, col: index - 19, side: 'top' };
  return { row: index - 29, col: 11, side: 'right' };
}

interface Props {
  store: GameStore;
  snap: Snapshot;
  onSelect: (id: SquareId) => void;
}

function Cell({ sq, index, store, snap, onSelect }: Props & { sq: Square; index: number }) {
  const tg = useTongue();
  const { state } = snap;
  const { row, col, side } = place(index);
  const holding = isProperty(sq) ? state.properties[sq.id] : null;
  const owner = holding?.owner ?? null;
  const corner = !isProperty(sq) && sq.kind !== 'tax' && sq.kind !== 'card';
  const here = snap.seating
    .map((id) => store.seat(id))
    .filter((seat) => snap.positions[seat.id] === index && !state.players.find((p) => p.id === seat.id)?.bankrupt);
  const classes = [
    'cell',
    `cell-${side}`,
    `kind-${sq.kind}`,
    corner ? `corner corner-${sq.id}` : '',
    sq.kind === 'card' ? `deck-${sq.deck}` : '',
    owner ? 'owned' : '',
    holding?.mortgaged ? 'mortgaged' : '',
    snap.positions[state.turn.player] === index ? 'here' : '',
    snap.spot === sq.id ? 'spot' : '',
  ];
  const style = {
    gridRow: row,
    gridColumn: col,
    ...vars({
      '--group': sq.kind === 'street' ? look.groups[sq.group].color : 'transparent',
      '--owner': owner ? factionOf(owner).color : 'transparent',
    }),
  };

  const note = {
    start: tg.t('salaryNote', { n: store.engine.board.economy.salary }),
    jail: tg.t('visitNote'),
    rest: tg.t('restNote'),
    goToJail: tg.t('marchNote'),
  };

  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(' ')}
      style={style}
      aria-label={tg.square(sq.id)}
      onClick={() => onSelect(sq.id)}
      onMouseEnter={() => sq.kind === 'street' && store.setFocus(sq.id)}
    >
      {sq.kind === 'street' && <span className="cell-art" style={{ backgroundImage: `url(${PORTRAITS[sq.id]})` }} />}
      {sq.kind === 'street' && <span className="cell-band" />}
      {corner ? (
        <>
          <span className="corner-zh">{look.squares[sq.id].nameZh}</span>
          <span className="corner-py">{sq.name}</span>
          <span className="corner-note">{note[sq.kind as keyof typeof note]}</span>
        </>
      ) : (
        <>
          {sq.kind !== 'street' && <span className="cell-glyph">{glyphOf(sq)}</span>}
          <span className="cell-label">
            <span className="cell-name">{tg.square(sq.id)}</span>
            {isProperty(sq) && <span className="cell-price">{sq.price}</span>}
            {sq.kind === 'tax' && <span className="cell-price">−{sq.amount}</span>}
          </span>
        </>
      )}
      {holding && holding.level > 0 && (
        <span className="cell-buildings">
          {holding.level === HOTEL_LEVEL ? (
            <i className="pip-fort" />
          ) : (
            Array.from({ length: holding.level }, (_, i) => <i key={i} className="pip-house" />)
          )}
        </span>
      )}
      {owner && <span className="cell-flag" />}
      {holding?.mortgaged && <span className="cell-seal">押</span>}
      {here.length > 0 && (
        <span className="cell-tokens" data-count={here.length}>
          {here.map((seat) => (
            <Token
              key={seat.id}
              who={seat.id}
              size="board"
              className={[
                seat.id === state.turn.player ? 'token-turn' : '',
                state.players.find((p) => p.id === seat.id)?.inJail ? 'token-jailed' : '',
              ].join(' ')}
            />
          ))}
        </span>
      )}
    </button>
  );
}

export function Board({ store, snap, onSelect }: Props) {
  return (
    <div className="board">
      {store.engine.board.squares.map((sq, index) => (
        <Cell key={sq.id} sq={sq} index={index} store={store} snap={snap} onSelect={onSelect} />
      ))}
      <Center store={store} snap={snap} />
    </div>
  );
}
