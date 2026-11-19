import { HOTEL_LEVEL, threeKingdomsPresentation as look } from '../../../src/index.ts';
import type { PropertySquare, Square, SquareId } from '../../../src/index.ts';
import { glyphOf, inkOn, isProperty, PORTRAITS } from '../game/assets.ts';
import type { GameStore, Snapshot } from '../game/store.ts';
import { useTongue } from '../i18n.tsx';
import { Btn, Modal, Money, vars } from './ui.tsx';
import { Token } from './Token.tsx';

interface Props {
  store: GameStore;
  snap: Snapshot;
  id: SquareId;
  onClose: () => void;
}

type Manage = 'BUILD' | 'SELL_BUILDING' | 'MORTGAGE' | 'UNMORTGAGE';

function Row({ label, amount, current = false }: { label: string; amount: number; current?: boolean }) {
  return (
    <div className={`deed-row ${current ? 'current' : ''}`}>
      <span>{label}</span>
      <i />
      <Money amount={amount} />
    </div>
  );
}

function Deed({ store, snap, sq }: { store: GameStore; snap: Snapshot; sq: PropertySquare }) {
  const tg = useTongue();
  const { t } = tg;
  const { state } = snap;
  const { board, rules } = store.engine;
  const holding = state.properties[sq.id];
  const owner = holding.owner;
  const color = sq.kind === 'street' ? look.groups[sq.group].color : '#8a7448';
  const kindLabel =
    sq.kind === 'street' ? tg.group(sq.group) : t(sq.kind === 'transit' ? 'kindTransit' : 'kindUtility');
  const redeem = sq.mortgageValue + Math.ceil((sq.mortgageValue * rules.mortgageInterestPercent) / 100);

  const legal = owner !== null && !store.seat(owner).ai ? store.engine.legalActions(state, owner) : [];
  const can = (type: Manage) =>
    legal.some((action) => action.type === type && 'property' in action && action.property === sq.id);
  const act = (type: Manage) => owner !== null && store.dispatch({ type, player: owner, property: sq.id });
  const manageable = (['BUILD', 'SELL_BUILDING', 'MORTGAGE', 'UNMORTGAGE'] as const).some(can);

  const sameKind = board.squares.filter((other): other is PropertySquare => isProperty(other) && other.kind === sq.kind);
  const held = owner === null ? 0 : sameKind.filter((other) => state.properties[other.id].owner === owner).length;
  const wholeSet =
    sq.kind === 'street' &&
    owner !== null &&
    sameKind.every((other) => other.kind !== 'street' || other.group !== sq.group || state.properties[other.id].owner === owner);

  return (
    <div className="deed" style={vars({ '--group': color, '--on-group': inkOn(color) })}>
      {sq.kind === 'street' ? (
        <div className="deed-art" style={{ backgroundImage: `url(${PORTRAITS[sq.id]})` }} />
      ) : (
        <div className="deed-art deed-glyph">{glyphOf(sq)}</div>
      )}
      <div className="deed-ribbon">
        <span className="deed-kind">{kindLabel}</span>
        <h3>{tg.square(sq.id)}</h3>
        <span className="deed-alt">{tg.squareAlt(sq.id)}</span>
      </div>

      <div className="deed-body">
        <div className="deed-owner">
          <span>{t('owner')}</span>
          {owner === null ? (
            <em>{t('unowned')}</em>
          ) : (
            <strong>
              <Token who={owner} size="sm" />
              {tg.who(owner)}
            </strong>
          )}
          {holding.mortgaged && <span className="tag tag-red">{t('mortgaged')}</span>}
        </div>

        <Row label={t('price')} amount={sq.price} />
        {sq.kind === 'street' && (
          <>
            <Row label={t('rentBase')} amount={sq.rents[0]} current={owner !== null && holding.level === 0 && !wholeSet} />
            <Row
              label={t('rentSet')}
              amount={sq.rents[0] * rules.groupRentMultiplier}
              current={holding.level === 0 && wholeSet}
            />
            {Array.from({ length: rules.housesBeforeHotel }, (_, i) => (
              <Row
                key={i}
                label={t('rentHouse', { n: i + 1 })}
                amount={sq.rents[i + 1]}
                current={holding.level === i + 1}
              />
            ))}
            <Row label={t('rentHotel')} amount={sq.rents[HOTEL_LEVEL]} current={holding.level === HOTEL_LEVEL} />
            <Row label={t('buildCost')} amount={sq.buildingCost} />
          </>
        )}
        {sq.kind === 'transit' &&
          sameKind.map((_, i) => (
            <Row key={i} label={t('tollN', { n: i + 1 })} amount={board.transitRents[i]} current={held === i + 1} />
          ))}
        {sq.kind === 'utility' && (
          <>
            <p className={`deed-rule ${held === 1 ? 'current' : ''}`}>{t('utilOne', { n: board.utilityMultipliers[0] })}</p>
            <p className={`deed-rule ${held === 2 ? 'current' : ''}`}>{t('utilBoth', { n: board.utilityMultipliers[1] })}</p>
          </>
        )}
        <Row label={t('mortgageValue')} amount={sq.mortgageValue} />
        <Row label={t('redeemCost')} amount={redeem} />

        {manageable && (
          <div className="actions deed-actions">
            {can('BUILD') && sq.kind === 'street' && (
              <Btn tone="primary" disabled={snap.busy} onClick={() => act('BUILD')}>
                {t('build')} <Money amount={sq.buildingCost} />
              </Btn>
            )}
            {can('SELL_BUILDING') && sq.kind === 'street' && (
              <Btn disabled={snap.busy} onClick={() => act('SELL_BUILDING')}>
                {t('sell')}{' '}
                <Money amount={Math.floor((sq.buildingCost * rules.buildingResalePercent) / 100)} signed />
              </Btn>
            )}
            {can('MORTGAGE') && (
              <Btn disabled={snap.busy} onClick={() => act('MORTGAGE')}>
                {t('mortgage')} <Money amount={sq.mortgageValue} signed />
              </Btn>
            )}
            {can('UNMORTGAGE') && (
              <Btn disabled={snap.busy} onClick={() => act('UNMORTGAGE')}>
                {t('redeem')} <Money amount={redeem} />
              </Btn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Note({ store, sq }: { store: GameStore; sq: Square }) {
  const tg = useTongue();
  const { economy } = store.engine.board;
  const rule = (() => {
    switch (sq.kind) {
      case 'tax':
        return tg.t('squareTax', { n: sq.amount });
      case 'card':
        return tg.t('squareCard', { deck: tg.deck(sq.deck) });
      case 'start':
        return tg.t('squareStart', { n: economy.salary });
      case 'jail':
        return tg.t('squareJail', { n: economy.bail });
      case 'rest':
        return tg.t('squareRest');
      case 'goToJail':
        return tg.t('squareGoToJail');
      default:
        return '';
    }
  })();
  return (
    <div className="note">
      <span className="note-glyph">{glyphOf(sq) || look.squares[sq.id].nameZh.slice(0, 1)}</span>
      <h3>{tg.square(sq.id)}</h3>
      <span className="deed-alt">{tg.squareAlt(sq.id)}</span>
      <p>{rule}</p>
    </div>
  );
}

export function SquareModal({ store, snap, id, onClose }: Props) {
  const sq = store.engine.board.squares.find((item) => item.id === id);
  if (!sq) return null;
  return (
    <Modal onClose={onClose} className={isProperty(sq) ? 'modal-deed' : 'modal-note'}>
      {isProperty(sq) ? <Deed store={store} snap={snap} sq={sq} /> : <Note store={store} sq={sq} />}
    </Modal>
  );
}
