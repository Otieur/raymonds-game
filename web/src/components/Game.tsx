import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PlayerId, SquareId } from '../../../src/index.ts';
import { factionOf, PORTRAITS } from '../game/assets.ts';
import { useMusic } from '../game/music.ts';
import { useSetting } from '../game/settings.ts';
import type { GameStore, Snapshot } from '../game/store.ts';
import { useTongue } from '../i18n.tsx';
import { Board } from './Board.tsx';
import { CommandPanel } from './CommandPanel.tsx';
import { Chronicle, Players } from './Players.tsx';
import { SquareModal } from './SquareModal.tsx';
import { Token, TokenContext } from './Token.tsx';
import { TradeModal } from './TradeModal.tsx';
import { Btn, CrossFade, vars } from './ui.tsx';

function Finale({ store, snap, onAgain, onReview }: { store: GameStore; snap: Snapshot; onAgain: () => void; onReview: () => void }) {
  const { t, who } = useTongue();
  const { state } = snap;
  if (state.winner === null) return null;
  const ranking = store.engine.standings(state);
  const fallen = store.config.seats.filter((seat) => state.players.find((p) => p.id === seat.id)?.bankrupt);

  return (
    <div className="veil finale">
      <div className="panel finale-card" style={vars({ '--c': factionOf(state.winner).color })}>
        <h2 className="finale-title">{t('victory')}</h2>
        <Token who={state.winner} size="xl" className="finale-token" />
        <p className="finale-winner">{t('wins', { who: who(state.winner) })}</p>
        <p className="hint">{ranking.length > 1 ? t('byLimit') : t('byLast')}</p>
        <ol className="standings">
          {ranking.map((row, i) => (
            <li key={row.player}>
              <span className="rank">{i + 1}</span>
              <Token who={row.player} size="sm" />
              <span className="standing-name">{who(row.player)}</span>
              <span className="standing-worth">
                {t('worth')} {row.netWorth.toLocaleString('en-US')}
              </span>
            </li>
          ))}
          {fallen.map((seat) => (
            <li key={seat.id} className="fallen">
              <span className="rank">—</span>
              <Token who={seat.id} size="sm" />
              <span className="standing-name">{who(seat.id)}</span>
              <span className="standing-worth">{t('out')}</span>
            </li>
          ))}
        </ol>
        <div className="actions">
          <Btn tone="primary" onClick={onAgain}>
            {t('again')}
          </Btn>
          <Btn tone="ghost" onClick={onReview}>
            {t('viewBoard')}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function Game({ store, onQuit }: { store: GameStore; onQuit: () => void }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const tg = useTongue();
  const { t } = tg;
  const [deed, setDeed] = useState<SquareId | null>(null);
  const [trader, setTrader] = useState<PlayerId | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [musicOn, toggleMusic] = useMusic();
  const [strip, toggleStrip] = useSetting('strip');
  const [intent, toggleIntent] = useSetting('intent');
  const over = snap.state.winner !== null;
  const tokens = useMemo(() => Object.fromEntries(store.config.seats.map((seat) => [seat.id, seat.token])), [store]);
  const opening = snap.state.turn.phase === 'order';

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), 3000);
    return () => clearTimeout(timer);
  }, [leaving]);

  const leave = () => {
    if (over || leaving) onQuit();
    else setLeaving(true);
  };

  return (
    <TokenContext.Provider value={tokens}>
      <div className="game">
        <CrossFade src={PORTRAITS[snap.focus]} className="wash" />

        <header className="topbar">
          <div className="topbar-brand">
            <span className="stamp">三国</span>
            <span className="topbar-mode">{t(store.config.mode === 'short' ? 'modeShort' : 'modeRegular')}</span>
            <span className="topbar-turn">{opening ? t('orderPhase') : t('turnNo', { n: snap.state.turn.number })}</span>
          </div>
          <div className="topbar-tools">
            <button type="button" className={`tool ${snap.fast ? 'on' : ''}`} onClick={() => store.toggleFast()}>
              {t('fast')}
            </button>
            <button type="button" className={`tool ${musicOn ? 'on' : ''}`} aria-pressed={musicOn} onClick={toggleMusic}>
              {t('music')}
            </button>
            {store.config.mode === 'regular' && (
              <button type="button" className={`tool tool-option ${strip ? 'on' : ''}`} aria-pressed={strip} title={t('stripHint')} onClick={toggleStrip}>
                {t('stripTool')}
              </button>
            )}
            <button type="button" className={`tool tool-option ${intent ? 'on' : ''}`} aria-pressed={intent} title={t('intentHint')} onClick={toggleIntent}>
              {t('intentTool')}
            </button>
            <button type="button" className="tool" onClick={() => tg.setLang(tg.lang === 'zh' ? 'en' : 'zh')}>
              {tg.lang === 'zh' ? 'EN' : '中文'}
            </button>
            <button type="button" className={`tool ${leaving ? 'warn' : ''}`} onClick={leave}>
              {leaving ? t('confirmQuit') : t('newGame')}
            </button>
          </div>
        </header>

        <main className="table">
          <Board store={store} snap={snap} onSelect={setDeed} />
          <aside className="side">
            <CommandPanel store={store} snap={snap} onTrade={setTrader} onSelect={setDeed} />
            <Players store={store} snap={snap} onSelect={setDeed} />
            <Chronicle snap={snap} />
          </aside>
        </main>

        {deed && <SquareModal store={store} snap={snap} id={deed} onClose={() => setDeed(null)} />}
        {trader && <TradeModal store={store} snap={snap} from={trader} onClose={() => setTrader(null)} />}
        {over && !reviewing && <Finale store={store} snap={snap} onAgain={onQuit} onReview={() => setReviewing(true)} />}
        {snap.error && (
          <button type="button" className="toast" onClick={() => store.clearError()}>
            {tg.problem(snap.error)}
          </button>
        )}
      </div>
    </TokenContext.Provider>
  );
}
