import { useState } from 'react';
import { DEFAULT_RULES, threeKingdomsPresentation as look } from '../../../src/index.ts';
import { FACTIONS, PORTRAITS, TOKENS } from '../game/assets.ts';
import type { TokenId } from '../game/assets.ts';
import { useMusic } from '../game/music.ts';
import type { GameConfig, SavedGame } from '../game/store.ts';
import { useTongue } from '../i18n.tsx';
import { Btn, vars } from './ui.tsx';
import { Token } from './Token.tsx';

interface Props {
  saved: SavedGame | null;
  onStart: (config: GameConfig) => void;
  onResume: () => void;
}

/** The four paintings that open the game. */
const HERO = ['zhuge-liang', 'jiang-wei', 'zhong-hui', 'sima-zhao'];

/** Who commands a faction: a person at this screen, the computer, or nobody (it sits the game out). */
type Role = 'human' | 'ai' | 'bench';
const ROLES: Role[] = ['human', 'ai', 'bench'];

export function Setup({ saved, onStart, onResume }: Props) {
  const tg = useTongue();
  const { t, lang } = tg;
  const [musicOn, toggleMusic] = useMusic();
  const [mode, setMode] = useState<GameConfig['mode']>('regular');
  const [roles, setRoles] = useState<Record<string, Role>>(() =>
    Object.fromEntries(FACTIONS.map((faction, i) => [faction.id, i === 0 ? 'human' : 'ai'])),
  );

  const [tokens, setTokens] = useState<Record<string, TokenId>>(() =>
    Object.fromEntries(FACTIONS.map((faction) => [faction.id, faction.token])),
  );

  const fielded = FACTIONS.filter((faction) => roles[faction.id] !== 'bench');
  const atMinimum = fielded.length <= DEFAULT_RULES.minPlayers;
  const begin = () =>
    onStart({
      mode,
      seats: fielded.map((faction) => ({ id: faction.id, ai: roles[faction.id] === 'ai', token: tokens[faction.id] })),
    });

  /** Hands the faction the next token; whoever held that one takes the faction's old token. */
  const nextToken = (id: string) => {
    const mine = tokens[id];
    const wanted = TOKENS[(TOKENS.findIndex((token) => token.id === mine) + 1) % TOKENS.length].id;
    const holder = FACTIONS.find((faction) => tokens[faction.id] === wanted);
    setTokens({ ...tokens, ...(holder ? { [holder.id]: mine } : {}), [id]: wanted });
  };

  return (
    <div className="setup">
      <div className="hero" aria-hidden="true">
        {HERO.map((id) => (
          <div key={id} className="hero-slice" style={{ backgroundImage: `url(${PORTRAITS[id]})` }}>
            <span className="hero-name">{look.squares[id].nameZh}</span>
          </div>
        ))}
      </div>

      <div className="setup-side">
        <div className="setup-tools">
          <button type="button" className={`tool ${musicOn ? 'on' : ''}`} aria-pressed={musicOn} onClick={toggleMusic}>
            {t('music')}
          </button>
          <button type="button" className="tool" onClick={() => tg.setLang(lang === 'zh' ? 'en' : 'zh')}>
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
        <header className="setup-head">
          <h1 className="brand brand-xl">三国</h1>
          <p className="brand-sub">
            <span>群雄逐鹿</span>
            <span className="brand-latin">Three Kingdoms</span>
          </p>
          <p className="setup-lead">{t('setupLead')}</p>
        </header>

        <section className="panel setup-form">
          <div className="setup-row">
            <h2 className="panel-title">{t('players')}</h2>
            <span className="fielded">
              {t('fielded', { n: lang === 'zh' ? '〇一二三四'[fielded.length] : fielded.length })}
            </span>
          </div>

          <div className="banners">
            {FACTIONS.map((faction) => {
              const role = roles[faction.id];
              return (
                <div key={faction.id} className={`banner banner-${role}`} style={vars({ '--c': faction.color })}>
                  <span className="banner-mark" aria-hidden="true">
                    {faction.zh}
                  </span>
                  <span className="banner-name">{tg.who(faction.id)}</span>
                  <button
                    type="button"
                    className="banner-token"
                    aria-label={`${t('changeToken')}: ${tg.token(tokens[faction.id])}`}
                    onClick={() => nextToken(faction.id)}
                  >
                    <Token who={faction.id} token={tokens[faction.id]} size="banner" />
                    <span className="banner-swap" aria-hidden="true">
                      ⇄
                    </span>
                  </button>
                  <span className="banner-weapon">{tg.token(tokens[faction.id])}</span>
                  <div className="banner-roles" role="radiogroup" aria-label={tg.who(faction.id)}>
                    {ROLES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={role === option}
                        className={role === option ? 'on' : ''}
                        disabled={option === 'bench' && role !== 'bench' && atMinimum}
                        onClick={() => setRoles({ ...roles, [faction.id]: option })}
                      >
                        {t(option)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="hint banner-hint">{t('tokenHint')}</p>

          <h2 className="panel-title">{t('mode')}</h2>
          <div className="modes">
            <button type="button" className={`mode ${mode === 'regular' ? 'on' : ''}`} onClick={() => setMode('regular')}>
              <strong>{t('modeRegular')}</strong>
              <span>{t('modeRegularHint')}</span>
            </button>
            <button type="button" className={`mode ${mode === 'short' ? 'on' : ''}`} onClick={() => setMode('short')}>
              <strong>{t('modeShort')}</strong>
              <span>{t('modeShortHint')}</span>
            </button>
          </div>

          <div className="actions setup-actions">
            <Btn tone="primary" className="btn-wide" onClick={begin}>
              {t('start')}
            </Btn>
            {saved && saved.state.winner === null && (
              <Btn onClick={onResume}>
                {t('resume')} ·{' '}
                {saved.state.turn.phase === 'order' ? t('orderPhase') : t('turnNo', { n: saved.state.turn.number })}
              </Btn>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
