import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { HOTEL_LEVEL, threeKingdomsPresentation as look } from '../../../src/index.ts';
import type { PlayerState, PropertySquare, SquareId } from '../../../src/index.ts';
import { chancesNow } from '../game/ahead.ts';
import { factionOf, isProperty } from '../game/assets.ts';
import { describe } from '../game/describe.ts';
import { intentWords } from '../game/intents.ts';
import { useSetting } from '../game/settings.ts';
import type { GameStore, Snapshot } from '../game/store.ts';
import { useTongue } from '../i18n.tsx';
import { Money, vars } from './ui.tsx';
import { Token } from './Token.tsx';

interface Props {
  store: GameStore;
  snap: Snapshot;
  onSelect: (id: SquareId) => void;
}

/** Glides each row to its new place when the table is reseated. Returns a ref setter per row. */
function useReseating(order: string) {
  const rows = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  const seen = useRef(order);

  useLayoutEffect(() => {
    const reseated = seen.current !== order;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    for (const [id, row] of rows.current) {
      next.set(id, row.offsetTop);
      const before = tops.current.get(id);
      if (reseated && !still && before !== undefined && before !== row.offsetTop) {
        row.animate([{ transform: `translateY(${before - row.offsetTop}px)` }, { transform: 'none' }], {
          duration: 800,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        });
      }
    }
    tops.current = next;
    seen.current = order;
  });

  return (id: string) => (row: HTMLElement | null) => {
    if (row) rows.current.set(id, row);
    else rows.current.delete(id);
  };
}

export function Players({ store, snap, onSelect }: Props) {
  const tg = useTongue();
  const { state } = snap;
  const properties = store.engine.board.squares.filter(isProperty);
  const rowRef = useReseating(snap.seating.join(' '));
  const [strip] = useSetting('strip');
  const [intent] = useSetting('intent');
  // The valuation was fitted on full games; the strip is shown in them only, once the order of play is set.
  const showStrip = strip && store.config.mode === 'regular' && state.turn.phase !== 'order' && state.winner === null;
  const chances = useMemo(() => (showStrip ? chancesNow(store.engine, state) : null), [showStrip, store, state]);
  const chanceOf = (id: string) => (chances ? chances[state.players.findIndex((p) => p.id === id)] : 0);

  return (
    <section className="panel roster">
      <h2 className="panel-title">{tg.t('realm')}</h2>
      <div className="roster-list">
        {snap.seating.map((id, place) => {
          const seat = store.seat(id);
          const thrown = snap.orderRolls[id];
          const player = state.players.find((p) => p.id === seat.id) as PlayerState;
          const owned = properties.filter((sq) => state.properties[sq.id].owner === seat.id);
          const classes = ['player', state.turn.player === seat.id ? 'turn' : '', player.bankrupt ? 'out' : ''];
          return (
            <div
              key={seat.id}
              ref={rowRef(seat.id)}
              className={classes.join(' ')}
              style={vars({ '--c': factionOf(seat.id).color })}
            >
              <span className="player-place">{place + 1}</span>
              <Token who={seat.id} />
              <div className="player-main">
                <div className="player-name">
                  <span className="player-side">{tg.who(seat.id)}</span>
                  {seat.ai && <span className="tag">AI</span>}
                  {intent && seat.ai && !player.bankrupt && (() => {
                    const doing = store.intentOf(seat.id);
                    const words = doing ? intentWords(doing.opponent, doing.rules, tg.lang) : '';
                    return words ? <span className="tag tag-intent">{words}</span> : null;
                  })()}
                  {thrown && (
                    <span className="tag tag-gold tag-throw">
                      {thrown[0]} + {thrown[1]} = {thrown[0] + thrown[1]}
                    </span>
                  )}
                  {player.inJail && <span className="tag tag-red">{tg.t('inJail')}</span>}
                  {player.jailCards.length > 0 && (
                    <span className="tag tag-gold">{tg.t('jailCardN', { n: player.jailCards.length })}</span>
                  )}
                  {player.bankrupt && <span className="tag tag-red">{tg.t('out')}</span>}
                </div>
                {!player.bankrupt && (
                  <div className="player-cash">
                    <Money amount={snap.cash[seat.id]} />
                    <span className="player-worth">
                      {tg.t('worth')} {store.engine.netWorth(state, seat.id).toLocaleString('en-US')}
                    </span>
                  </div>
                )}
                {owned.length > 0 && (
                  <div className="chips">
                    {owned.map((sq) => (
                      <Chip key={sq.id} sq={sq} snap={snap} label={tg.square(sq.id)} onSelect={onSelect} />
                    ))}
                  </div>
                )}
              </div>
              <div className="floats" aria-hidden="true">
                {snap.floats
                  .filter((float) => float.player === seat.id)
                  .map((float) => (
                    <span key={float.id} className={`float ${float.amount < 0 ? 'float-loss' : 'float-gain'}`}>
                      <Money amount={float.amount} signed />
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      {chances && (
        <div className="ahead" aria-label={`${tg.t('aheadTitle')}: ${snap.seating.map((id) => `${tg.who(id)} ${chanceOf(id)}%`).join(', ')}`}>
          <span className="ahead-title">{tg.t('aheadTitle')}</span>
          <div className="ahead-bar" aria-hidden="true">
            {snap.seating
              .filter((id) => chanceOf(id) > 0)
              .map((id) => (
                <span
                  key={id}
                  className="ahead-part"
                  style={{ ...vars({ '--c': factionOf(id).color }), flexGrow: chanceOf(id) }}
                  title={`${tg.who(id)} ${chanceOf(id)}%`}
                >
                  {chanceOf(id) >= 9 ? `${tg.who(id)} ${chanceOf(id)}%` : ''}
                </span>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Chip({
  sq,
  snap,
  label,
  onSelect,
}: {
  sq: PropertySquare;
  snap: Snapshot;
  label: string;
  onSelect: (id: SquareId) => void;
}) {
  const holding = snap.state.properties[sq.id];
  const color = sq.kind === 'street' ? look.groups[sq.group].color : sq.kind === 'transit' ? '#6f8196' : '#a9824a';
  const mark = holding.level === HOTEL_LEVEL ? '堡' : holding.level > 0 ? String(holding.level) : '';
  return (
    <button
      type="button"
      className={`chip ${holding.mortgaged ? 'pawned' : ''}`}
      style={vars({ '--group': color })}
      title={label}
      aria-label={label}
      onClick={() => onSelect(sq.id)}
    >
      {mark}
    </button>
  );
}

export function Chronicle({ snap }: { snap: Snapshot }) {
  const tg = useTongue();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [snap.log.length]);

  return (
    <section className="panel chronicle">
      <h2 className="panel-title">{tg.t('chronicle')}</h2>
      <div className="chronicle-list" ref={scroller}>
        {snap.log.map((entry) => {
          const text = describe(entry.event, tg, tg.who);
          if (text === null) return null;
          return (
            <p key={entry.id} className={`line line-${entry.event.type}`}>
              {text}
            </p>
          );
        })}
      </div>
    </section>
  );
}
