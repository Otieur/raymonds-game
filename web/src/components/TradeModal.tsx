import { useState } from 'react';
import { threeKingdomsPresentation as look } from '../../../src/index.ts';
import type { Action, LegalAction, PlayerId, PlayerState, PropertySquare, TradeSide } from '../../../src/index.ts';
import { isProperty } from '../game/assets.ts';
import type { GameStore, Snapshot } from '../game/store.ts';
import { useTongue } from '../i18n.tsx';
import { Btn, Modal, vars } from './ui.tsx';
import { Token } from './Token.tsx';

interface Props {
  store: GameStore;
  snap: Snapshot;
  from: PlayerId;
  onClose: () => void;
}

const nothing = (): TradeSide => ({ cash: 0, properties: [], jailCards: 0 });

function SideEditor({
  store,
  snap,
  owner,
  title,
  side,
  onChange,
}: {
  store: GameStore;
  snap: Snapshot;
  owner: PlayerId;
  title: string;
  side: TradeSide;
  onChange: (side: TradeSide) => void;
}) {
  const tg = useTongue();
  const player = snap.state.players.find((p) => p.id === owner) as PlayerState;
  const owned = store.engine.board.squares.filter(
    (sq): sq is PropertySquare => isProperty(sq) && snap.state.properties[sq.id].owner === owner,
  );
  const toggle = (id: string) =>
    onChange({
      ...side,
      properties: side.properties.includes(id) ? side.properties.filter((item) => item !== id) : [...side.properties, id],
    });
  const setCash = (value: number) => onChange({ ...side, cash: Math.max(0, Math.min(player.cash, Math.floor(value) || 0)) });

  return (
    <div className="trade-side">
      <h4>
        <Token who={owner} size="sm" />
        {title}
      </h4>
      <label className="field">
        <span>{tg.t('cash')}</span>
        <input
          type="range"
          min={0}
          max={player.cash}
          step={10}
          value={side.cash}
          onChange={(event) => setCash(Number(event.target.value))}
        />
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={player.cash}
          value={side.cash}
          onChange={(event) => setCash(Number(event.target.value))}
        />
      </label>
      <div className="deeds">
        {owned.map((sq) => (
          <button
            key={sq.id}
            type="button"
            className={[
              'deed-chip',
              side.properties.includes(sq.id) ? 'picked' : '',
              snap.state.properties[sq.id].mortgaged ? 'pawned' : '',
            ].join(' ')}
            style={vars({ '--group': sq.kind === 'street' ? look.groups[sq.group].color : '#8a7448' })}
            onClick={() => toggle(sq.id)}
          >
            {tg.square(sq.id)}
          </button>
        ))}
      </div>
      {player.jailCards.length > 0 && (
        <label className="field">
          <span>{tg.t('jailCardN', { n: side.jailCards })}</span>
          <input
            type="range"
            min={0}
            max={player.jailCards.length}
            value={side.jailCards}
            onChange={(event) => onChange({ ...side, jailCards: Number(event.target.value) })}
          />
        </label>
      )}
    </div>
  );
}

export function TradeModal({ store, snap, from, onClose }: Props) {
  const tg = useTongue();
  const open = store.engine
    .legalActions(snap.state, from)
    .find((action): action is Extract<LegalAction, { type: 'PROPOSE_TRADE' }> => action.type === 'PROPOSE_TRADE');
  const partners = open?.partners ?? [];
  const [picked, setPicked] = useState<PlayerId | undefined>(partners[0]);
  const [give, setGive] = useState<TradeSide>(nothing);
  const [receive, setReceive] = useState<TradeSide>(nothing);
  const [error, setError] = useState<string | null>(null);
  const to = picked !== undefined && partners.includes(picked) ? picked : partners[0];

  if (to === undefined) {
    return (
      <Modal onClose={onClose} className="modal-trade">
        <p className="hint">{tg.t('nothing')}</p>
      </Modal>
    );
  }

  const propose = () => {
    const action: Action = { type: 'PROPOSE_TRADE', player: from, to, give, receive };
    const problem = store.engine.validate(snap.state, action);
    if (problem) {
      setError(tg.problem(problem));
      return;
    }
    if (store.dispatch(action)) onClose();
  };

  return (
    <Modal onClose={onClose} className="modal-trade">
      <h2 className="panel-title">{tg.t('tradeTitle')}</h2>
      <div className="partners">
        <span>{tg.t('partner')}</span>
        {partners.map((id) => (
          <button
            key={id}
            type="button"
            className={`bidder ${id === to ? 'lead' : ''}`}
            onClick={() => {
              setPicked(id);
              setReceive(nothing());
              setError(null);
            }}
          >
            <Token who={id} size="sm" />
            {tg.who(id)}
          </button>
        ))}
      </div>
      <div className="trade-sides">
        <SideEditor store={store} snap={snap} owner={from} title={tg.t('youGive')} side={give} onChange={setGive} />
        <SideEditor store={store} snap={snap} owner={to} title={tg.t('youGet')} side={receive} onChange={setReceive} />
      </div>
      {error && <p className="problem">{error}</p>}
      <div className="actions">
        <Btn tone="primary" disabled={snap.busy} onClick={propose}>
          {tg.t('propose')}
        </Btn>
      </div>
    </Modal>
  );
}
