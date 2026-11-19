import { useEffect, useState } from 'react';
import { threeKingdomsPresentation as look } from '../../../src/index.ts';
import type { DeckId } from '../../../src/index.ts';
import { PORTRAITS } from '../game/assets.ts';
import { describe } from '../game/describe.ts';
import type { GameStore, Snapshot } from '../game/store.ts';
import { useTongue } from '../i18n.tsx';
import { CrossFade, vars } from './ui.tsx';
import { Token } from './Token.tsx';

/** Which of the nine cells of a die face carry a pip. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, rolling }: { value: number; rolling: boolean }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!rolling) {
      setShown(value);
      return;
    }
    const timer = setInterval(() => setShown(1 + Math.floor(Math.random() * 6)), 70);
    return () => clearInterval(timer);
  }, [rolling, value]);

  // As on Chinese dice, the one and the four are red.
  const red = shown === 1 || shown === 4;
  return (
    <span className={`die ${rolling ? 'rolling' : ''}`}>
      {Array.from({ length: 9 }, (_, cell) => (
        <i key={cell} className={PIPS[shown].includes(cell) ? `pip ${red ? 'pip-red' : ''}` : ''} />
      ))}
    </span>
  );
}

export function Center({ store, snap }: { store: GameStore; snap: Snapshot }) {
  const tg = useTongue();
  const name = tg.who;
  const focus = store.engine.board.squares.find((sq) => sq.id === snap.focus);
  const group = focus?.kind === 'street' ? look.groups[focus.group] : null;
  const dice = snap.dice ?? [1, 4];

  let herald = '';
  for (let i = snap.log.length - 1; i >= 0 && herald === ''; i--) {
    herald = describe(snap.log[i].event, tg, name) ?? '';
  }

  const pile = (deck: DeckId) => (
    <div className={`pile pile-${deck}`}>
      <span className="pile-card" />
      <span className="pile-card" />
      <span className="pile-card pile-top">{look.decks[deck].nameZh}</span>
      <span className="pile-count">{tg.t('remaining', { n: snap.state.decks[deck].length })}</span>
    </div>
  );

  return (
    <section className="center">
      <CrossFade src={PORTRAITS[snap.focus]} className="center-art" />
      {focus && group && (
        <div className="center-name" style={vars({ '--group': group.color })}>
          <span className="center-name-zh">{look.squares[focus.id].nameZh}</span>
          <span className="stamp">{group.nameZh}</span>
          <span className="center-name-en">{focus.name}</span>
        </div>
      )}

      <header className="center-head">
        <h1 className="brand">三国</h1>
        <p className="brand-sub">
          <span>群雄逐鹿</span>
          <span className="brand-latin">Three Kingdoms</span>
        </p>
      </header>

      <div className="center-stage">
        <div className="dice">
          <Die value={dice[0]} rolling={snap.rolling} />
          <Die value={dice[1]} rolling={snap.rolling} />
        </div>
        {snap.dice && !snap.rolling && <span className="dice-sum">{dice[0] + dice[1]}</span>}
      </div>

      <p className="herald" key={herald}>
        {herald}
      </p>

      <div className="piles">
        {pile('pouch')}
        {pile('edict')}
      </div>

      {snap.card && (
        <button type="button" className="reveal" onClick={() => store.dismissCard()}>
          <span className={`fate fate-${snap.card.deck}`}>
            <span className="fate-deck">{look.decks[snap.card.deck].nameZh}</span>
            <span className="fate-rule" />
            <span className="fate-text">{tg.card(snap.card.card)}</span>
            <span className="fate-who">
              <Token who={snap.card.player} size="sm" />
              {name(snap.card.player)}
            </span>
            <span className="fate-hint">{tg.t('tapToContinue')}</span>
          </span>
        </button>
      )}
    </section>
  );
}
