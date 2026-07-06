'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { es, en, type Lang, type Translations } from './translations';
import { api } from '@/lib/api';

const STORAGE_KEY = 'lux-lang';

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const LangContext = createContext<LangContextValue>({
  lang: 'es',
  setLang: () => {},
  t: es,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('es');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Lang;
      if (stored === 'es' || stored === 'en') setLangState(stored);
    } catch {}
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
    api.user.setLang(l).catch(() => {});
  };

  const t = lang === 'en' ? en : es;

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LangContext);
}

export type { Lang, Translations };
