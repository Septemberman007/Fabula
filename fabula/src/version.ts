import { useEffect, useState } from 'react';

/** Soubor aplikace, na který odkazuje úvodní stránka; jeho název obsahuje otisk verze. */
export const appScript = (html: string) => /assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null;

const CHECK_EVERY = 15 * 60 * 1000;

/**
 * Hlídá, jestli na serveru není novější verze, než která právě běží: po spuštění, po návratu do okna
 * a pak každou čtvrthodinu. Dotaz nese parametr `fresh`, aby ho neobsloužila uložená kopie ani mezipaměť serveru.
 */
export function useNewVersion(): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const mine = appScript(import.meta.url);
    if (!import.meta.env.PROD || !mine) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`./?fresh=${Date.now()}`, { cache: 'no-store' });
        const theirs = res.ok ? appScript(await res.text()) : null;
        if (theirs && theirs !== mine) setFresh(true);
      } catch {
        /* bez připojení se nic neděje */
      }
    };
    const first = setTimeout(check, 5000);
    const timer = setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return fresh;
}

/** Načte novou verzi. Adresa s parametrem obejde mezipaměť serveru, která starou stránku drží ještě pár minut. */
export const loadNewVersion = () => location.replace(`./?v=${Date.now()}`);
