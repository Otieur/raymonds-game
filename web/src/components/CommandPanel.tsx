import { useState } from 'react';
import type { ReactNode } from 'react';
import { threeKingdomsPresentation as look } from '../../../src/index.ts';
import type {
  Action,
  LegalAction,
  Pending,
  PlayerId,
  PlayerState,
  PropertySquare,
  SquareId,
  TradeOffer,
  TradeSide,
} from '../../../src/index.ts';
import { factionOf, glyphOf, isProperty, PORTRAITS } from '../game/assets.ts';
import type { GameStore, Snapshot } from '../game/store.ts';
import { useTongue } from '../i18n.tsx';
import { Btn, Money, vars } from './ui.tsx';
import { Token } from './Token.tsx';

interface Props {
  store: GameStore;
  snap: Snapshot;
  onTrade: (from: PlayerId) => void;
  onSelect: (id: SquareId) => void;
}

type PanelProps = Props & { player: PlayerId };
type BidAction = Extract<LegalAction, { type: 'BID' }>;
type Auction = Extract<Pending, { kind: 'auction' | 'buildingAuction' }>;

function playerOf(snap: Snapshot, id: PlayerId): PlayerState {
  return snap.state.players.find((p) => p.id === id) as PlayerState;
}

function property(store: GameStore, id: SquareId): PropertySquare {
  return store.engine.board.squares.find((sq) => sq.id === id) as PropertySquare;
}

function useLegal({ store, snap, player }: PanelProps) {
  const legal = store.engine.legalActions(snap.state, player);
  return { legal, can: (type: LegalAction['type']) => legal.some((action) => action.type === type) };
}

/** A small picture, name and price for a property; opens its deed when clicked. */
function Brief({ store, id, onSelect }: { store: GameStore; id: SquareId; onSelect: (id: SquareId) => void }) {
  const tg = useTongue();
  const sq = property(store, id);
  const kind =
    sq.kind === 'street' ? tg.group(sq.group) : tg.t(sq.kind === 'transit' ? 'kindTransit' : 'kindUtility');
  return (
    <button
      type="button"
      className="brief"
      style={vars({ '--group': sq.kind === 'street' ? look.groups[sq.group].color : '#8a7448' })}
      onClick={() => onSelect(id)}
    >
      {sq.kind === 'street' ? (
        <span className="brief-art" style={{ backgroundImage: `url(${PORTRAITS[id]})` }} />
      ) : (
        <span className="brief-art brief-glyph">{glyphOf(sq)}</span>
      )}
      <span className="brief-text">
        <span className="brief-name">{tg.square(id)}</span>
        <span className="brief-kind">{kind}</span>
      </span>
      <Money amount={sq.price} />
    </button>
  );
}

function FreeTurn(props: PanelProps) {
  const { store, snap, player, onTrade } = props;
  const { t } = useTongue();
  const { can } = useLegal(props);
  const me = playerOf(snap, player);
  const act = (type: 'ROLL' | 'END_TURN' | 'PAY_BAIL' | 'USE_JAIL_CARD') => store.dispatch({ type, player });
  const rollLabel = me.inJail
    ? t('rollDoubles', { n: me.jailRolls + 1, max: store.engine.rules.maxJailRolls })
    : snap.state.turn.doubles > 0
      ? t('rollAgain')
      : t('roll');

  return (
    <>
      <div className="actions">
        {can('ROLL') && (
          <Btn tone="primary" onClick={() => act('ROLL')}>
            {rollLabel}
          </Btn>
        )}
        {can('END_TURN') && (
          <Btn tone="primary" onClick={() => act('END_TURN')}>
            {t('endTurn')}
          </Btn>
        )}
        {can('PAY_BAIL') && (
          <Btn onClick={() => act('PAY_BAIL')}>
            {t('payBail')} <Money amount={store.engine.board.economy.bail} />
          </Btn>
        )}
        {can('USE_JAIL_CARD') && <Btn onClick={() => act('USE_JAIL_CARD')}>{t('useCard')}</Btn>}
        {can('PROPOSE_TRADE') && (
          <Btn tone="ghost" onClick={() => onTrade(player)}>
            {t('trade')}
          </Btn>
        )}
      </div>
      <p className="hint">{t('manageHint')}</p>
    </>
  );
}

/** The opening roll: one throw each, and again for those who tie. */
function OrderPanel({ store, player }: PanelProps) {
  const { t } = useTongue();
  return (
    <>
      <div className="actions">
        <Btn tone="primary" onClick={() => store.dispatch({ type: 'ROLL', player })}>
          {t('roll')}
        </Btn>
      </div>
      <p className="hint">{t('orderHint')}</p>
    </>
  );
}

function BuyPanel(props: PanelProps & { id: SquareId }) {
  const { store, player, id, onSelect } = props;
  const { t } = useTongue();
  const { can } = useLegal(props);
  return (
    <>
      <Brief store={store} id={id} onSelect={onSelect} />
      <div className="actions">
        <Btn tone="primary" disabled={!can('BUY')} onClick={() => store.dispatch({ type: 'BUY', player })}>
          {t('buy')} <Money amount={property(store, id).price} />
        </Btn>
        <Btn onClick={() => store.dispatch({ type: 'DECLINE', player })}>{t('toAuction')}</Btn>
      </div>
      {!can('BUY') && <p className="hint">{t('cannotAfford')}</p>}
    </>
  );
}

function BidRow(props: PanelProps) {
  const { store, snap, player } = props;
  const tg = useTongue();
  const { legal } = useLegal(props);
  const bid = legal.find((action): action is BidAction => action.type === 'BID');
  const [target, setTarget] = useState<SquareId | undefined>(bid?.targets?.[0]?.property);
  const [amount, setAmount] = useState(0);

  const chosen = bid?.targets?.find((item) => item.property === target) ?? bid?.targets?.[0];
  const floor = chosen?.min ?? bid?.min ?? 0;
  const offer = bid ? Math.min(bid.max, Math.max(amount, floor)) : 0;
  const place = (): Action => ({
    type: 'BID',
    player,
    amount: offer,
    ...(chosen ? { property: chosen.property } : {}),
  });

  return (
    <div className="bid-row">
      <div className="bid-who">
        <Token who={player} size="sm" />
        <span>{tg.who(player)}</span>
        <Money amount={snap.cash[player]} />
      </div>
      {bid ? (
        <>
          {bid.targets && (
            <label className="field">
              <span>{tg.t('placeOn')}</span>
              <select value={chosen?.property} onChange={(event) => setTarget(event.target.value)}>
                {bid.targets.map((item) => (
                  <option key={item.property} value={item.property}>
                    {tg.square(item.property)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="stepper">
            <button type="button" onClick={() => setAmount(floor)}>
              {tg.t('lowest')}
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={offer}
              min={floor}
              max={bid.max}
              onChange={(event) => setAmount(Math.floor(Number(event.target.value) || 0))}
            />
            <button type="button" onClick={() => setAmount(offer + 10)}>
              +10
            </button>
            <button type="button" onClick={() => setAmount(offer + 50)}>
              +50
            </button>
          </div>
          <div className="actions">
            <Btn tone="primary" onClick={() => store.dispatch(place())}>
              {tg.t('bid')} <Money amount={offer} />
            </Btn>
            <Btn tone="ghost" onClick={() => store.dispatch({ type: 'PASS', player })}>
              {tg.t('pass')}
            </Btn>
          </div>
        </>
      ) : (
        <div className="actions">
          <span className="hint">{tg.t('cannotBid')}</span>
          <Btn tone="ghost" onClick={() => store.dispatch({ type: 'PASS', player })}>
            {tg.t('pass')}
          </Btn>
        </div>
      )}
    </div>
  );
}

function AuctionPanel({ top, humans, ...props }: Props & { top: Auction; humans: PlayerId[] }) {
  const { store, onSelect } = props;
  const tg = useTongue();
  return (
    <>
      {top.kind === 'auction' ? (
        <Brief store={store} id={top.property} onSelect={onSelect} />
      ) : (
        <p className="hint">{tg.t('buildingAuction', { kind: tg.building(top.building === 'hotel') })}</p>
      )}
      <div className="bid-status">
        <span>{tg.t('highBid')}</span>
        {top.highBidder === null ? (
          <em>{tg.t('noBids')}</em>
        ) : (
          <strong>
            <Money amount={top.highBid} /> · {tg.who(top.highBidder)}
          </strong>
        )}
      </div>
      <div className="bidders">
        {top.bidders.map((id) => (
          <span key={id} className={`bidder ${id === top.highBidder ? 'lead' : ''}`}>
            <Token who={id} size="sm" />
            {tg.who(id)}
          </span>
        ))}
      </div>
      {humans.map((id) => (
        <BidRow key={id} {...props} player={id} />
      ))}
    </>
  );
}

function DebtPanel(props: PanelProps & { top: Extract<Pending, { kind: 'debt' }> }) {
  const { store, snap, player, top, onTrade, onSelect } = props;
  const tg = useTongue();
  const { can } = useLegal(props);
  const creditor = top.creditor === null ? tg.t('bank') : tg.who(top.creditor);
  const owned = store.engine.board.squares.filter(
    (sq): sq is PropertySquare => isProperty(sq) && snap.state.properties[sq.id].owner === player,
  );
  return (
    <>
      <div className="debt">
        <span>
          {tg.t('owes', { who: creditor })} <Money amount={top.amount} />
        </span>
        <span>
          {tg.t('cashInHand')} <Money amount={snap.cash[player]} />
        </span>
      </div>
      <p className="hint">{tg.t('debtHint')}</p>
      <div className="deeds">
        {owned.map((sq) => (
          <button
            key={sq.id}
            type="button"
            className={`deed-chip ${snap.state.properties[sq.id].mortgaged ? 'pawned' : ''}`}
            style={vars({ '--group': sq.kind === 'street' ? look.groups[sq.group].color : '#8a7448' })}
            onClick={() => onSelect(sq.id)}
          >
            {tg.square(sq.id)}
          </button>
        ))}
      </div>
      <div className="actions">
        {can('PROPOSE_TRADE') && (
          <Btn tone="ghost" onClick={() => onTrade(player)}>
            {tg.t('trade')}
          </Btn>
        )}
        {can('DECLARE_BANKRUPTCY') && (
          <Btn tone="danger" onClick={() => store.dispatch({ type: 'DECLARE_BANKRUPTCY', player })}>
            {tg.t('bankrupt')}
          </Btn>
        )}
      </div>
    </>
  );
}

function TransferPanel(props: PanelProps & { id: SquareId }) {
  const { store, player, id, onSelect } = props;
  const { t } = useTongue();
  const { legal } = useLegal(props);
  const canLift = legal.some((action) => action.type === 'SETTLE_TRANSFER' && action.lift);
  const settle = (lift: boolean) => store.dispatch({ type: 'SETTLE_TRANSFER', player, lift });
  return (
    <>
      <Brief store={store} id={id} onSelect={onSelect} />
      <p className="hint">{t('transferHint')}</p>
      <div className="actions">
        <Btn tone="primary" disabled={!canLift} onClick={() => settle(true)}>
          {t('lift')} <Money amount={property(store, id).mortgageValue} />
        </Btn>
        <Btn onClick={() => settle(false)}>{t('keep')}</Btn>
      </div>
    </>
  );
}

function ExitPanel(props: PanelProps) {
  const { store, player } = props;
  const { t } = useTongue();
  const { can } = useLegal(props);
  return (
    <>
      <p className="hint">{t('exitHint')}</p>
      <div className="actions">
        <Btn tone="primary" onClick={() => store.dispatch({ type: 'USE_JAIL_CARD', player })}>
          {t('useCard')}
        </Btn>
        <Btn disabled={!can('PAY_BAIL')} onClick={() => store.dispatch({ type: 'PAY_BAIL', player })}>
          {t('payBail')} <Money amount={store.engine.board.economy.bail} />
        </Btn>
      </div>
    </>
  );
}

function Terms({ side }: { side: TradeSide }) {
  const tg = useTongue();
  const empty = side.cash === 0 && side.properties.length === 0 && side.jailCards === 0;
  return (
    <ul className="terms">
      {side.cash > 0 && (
        <li>
          <Money amount={side.cash} />
        </li>
      )}
      {side.properties.map((id) => (
        <li key={id}>{tg.square(id)}</li>
      ))}
      {side.jailCards > 0 && <li>{tg.t('jailCardN', { n: side.jailCards })}</li>}
      {empty && <li className="hint">{tg.t('nothing')}</li>}
    </ul>
  );
}

export function OfferTerms({ offer }: { offer: TradeOffer }) {
  const { t, who } = useTongue();
  return (
    <div className="offer">
      <div>
        <h4>{t('gives', { who: who(offer.from) })}</h4>
        <Terms side={offer.give} />
      </div>
      <div>
        <h4>{t('gives', { who: who(offer.to) })}</h4>
        <Terms side={offer.receive} />
      </div>
    </div>
  );
}

function TradePanel({ store, offer }: { store: GameStore; offer: TradeOffer }) {
  const { t } = useTongue();
  const answers = !store.seat(offer.to).ai;
  return (
    <>
      <OfferTerms offer={offer} />
      <div className="actions">
        {answers && (
          <>
            <Btn tone="primary" onClick={() => store.dispatch({ type: 'ACCEPT_TRADE', player: offer.to })}>
              {t('accept')}
            </Btn>
            <Btn onClick={() => store.dispatch({ type: 'REJECT_TRADE', player: offer.to })}>{t('reject')}</Btn>
          </>
        )}
        {!store.seat(offer.from).ai && (
          <Btn tone="ghost" onClick={() => store.dispatch({ type: 'CANCEL_TRADE', player: offer.from })}>
            {t('withdraw')}
          </Btn>
        )}
      </div>
    </>
  );
}

export function CommandPanel(props: Props) {
  const { store, snap } = props;
  const tg = useTongue();
  const { t } = tg;
  const { state } = snap;
  const top = state.pending.at(-1);
  const waiting = store.engine.awaiting(state);
  const humans = waiting.filter((id) => !store.seat(id).ai);
  const lead = humans[0] ?? snap.thinking ?? waiting[0] ?? state.turn.player;
  const seat = store.seat(lead);
  const me = playerOf(snap, lead);
  const panel: PanelProps = { ...props, player: lead };

  const opening = state.turn.phase === 'order';
  let headline = opening ? t('headOrder') : t('headWait');
  let body: ReactNode;
  const humanInTrade = top?.kind === 'trade' && (!store.seat(top.offer.from).ai || !store.seat(top.offer.to).ai);
  if (snap.busy || (humans.length === 0 && !humanInTrade)) {
    body = (
      <p className="waiting">
        {snap.busy ? t('unfolding') : t('thinking', { who: tg.who(seat.id) })}
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </p>
    );
  } else if (opening) {
    body = <OrderPanel {...panel} />;
  } else if (!top) {
    headline = state.turn.phase === 'postRoll' ? t('headEnd') : me.inJail ? t('headJail') : t('headRoll');
    body = <FreeTurn {...panel} />;
  } else if (top.kind === 'buy') {
    headline = t('headBuy');
    body = <BuyPanel {...panel} id={top.property} />;
  } else if (top.kind === 'auction' || top.kind === 'buildingAuction') {
    headline = t(top.kind === 'auction' ? 'headAuction' : 'headBuilding');
    body = <AuctionPanel {...props} top={top} humans={humans} />;
  } else if (top.kind === 'debt') {
    headline = t('headDebt');
    body = <DebtPanel {...panel} top={top} />;
  } else if (top.kind === 'mortgageTransfer') {
    headline = t('headTransfer');
    body = <TransferPanel {...panel} id={top.property} />;
  } else if (top.kind === 'jailExit') {
    headline = t('headExit');
    body = <ExitPanel {...panel} />;
  } else {
    headline = t('headTrade');
    body = <TradePanel store={store} offer={top.offer} />;
  }

  return (
    <section className="panel command">
      <header className="command-head" style={vars({ '--c': factionOf(seat.id).color })}>
        <Token who={seat.id} size="lg" />
        <div className="command-title">
          <span className="command-who">{tg.who(seat.id)}</span>
          <span className="command-what">{headline}</span>
        </div>
        <span className="command-turn">{opening ? t('orderPhase') : t('turnNo', { n: state.turn.number })}</span>
      </header>
      <div className="command-body">{body}</div>
    </section>
  );
}
