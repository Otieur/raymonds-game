import { useEffect, useMemo, useState } from 'react';
import { Embers } from './components/Embers.tsx';
import { Game } from './components/Game.tsx';
import { Setup } from './components/Setup.tsx';
import { music } from './game/music.ts';
import { clearSave, GameStore, loadSave } from './game/store.ts';
import type { GameConfig, SavedGame } from './game/store.ts';
import { LangContext, tongue } from './i18n.tsx';
import type { Lang } from './i18n.tsx';

const LANG_KEY = 'three-kingdoms.lang';

function savedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

export function App() {
  const [lang, setLang] = useState<Lang>(savedLang);
  const [store, setStore] = useState<GameStore | null>(null);
  const [saved, setSaved] = useState<SavedGame | null>(loadSave);

  const speech = useMemo(
    () => ({
      ...tongue(lang),
      setLang: (next: Lang) => {
        setLang(next);
        try {
          localStorage.setItem(LANG_KEY, next);
        } catch {
          // Storage is unavailable; the choice lasts for this visit only.
        }
      },
    }),
    [lang],
  );

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  }, [lang]);

  useEffect(() => music.arm(), []);

  const begin = (config: GameConfig) => {
    clearSave();
    setStore(new GameStore(config));
  };
  const resume = () => {
    if (saved) setStore(new GameStore(saved.config, saved));
  };
  const quit = () => {
    if (store?.getSnapshot().state.winner !== null) clearSave();
    setStore(null);
    setSaved(loadSave());
  };

  return (
    <LangContext.Provider value={speech}>
      <Embers />
      {store ? <Game store={store} onQuit={quit} /> : <Setup saved={saved} onStart={begin} onResume={resume} />}
    </LangContext.Provider>
  );
}
