/**
 * Přiblížení tabule a časové osy. Obě mají vlastní měřítko, protože sloupec beatu je na tabuli širší než na ose;
 * při propojení se drží tak, aby jeden beat zabíral v obou pohledech stejně místa.
 */

/** Šířka sloupce jednoho beatu při 100 % (v pixelech). */
export const BOARD_COL = 208;
export const TIMELINE_COL = 84;

/** Dolní mez je nízko, aby se na obrazovku vešel i dlouhý film (při 3 % má beat na ose 2,5 px). */
export const TIMELINE_ZOOM = { min: 0.03, max: 3 };
/** Tabule jde oddálit tak daleko, aby se na ni vešlo totéž co na nejvíc oddálenou osu. */
export const BOARD_ZOOM = { min: (TIMELINE_ZOOM.min * TIMELINE_COL) / BOARD_COL, max: 1.5 };

/** Kolikrát je sloupec tabule širší než sloupec osy. */
const RATIO = BOARD_COL / TIMELINE_COL;

/** Zaokrouhlujeme dolů na setiny procenta: u malých hodnot by hrubší krok znamenal, že se „celý film“ o pár pixelů nevejde. */
export const clampZoom = (z: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(z * 10000) / 10000));

/**
 * Nové hodnoty obou přiblížení po změně jednoho z nich.
 * Při propojení se druhé dopočítá a obě se drží v rozsahu, který zvládnou oba pohledy.
 */
export function zoomPair(which: 'board' | 'timeline', value: number, linked: boolean, current: { zoom: number; tlZoom: number }) {
  if (!linked) {
    return which === 'board'
      ? { zoom: clampZoom(value, BOARD_ZOOM.min, BOARD_ZOOM.max), tlZoom: current.tlZoom }
      : { zoom: current.zoom, tlZoom: clampZoom(value, TIMELINE_ZOOM.min, TIMELINE_ZOOM.max) };
  }
  const board = clampZoom(which === 'board' ? value : value / RATIO, BOARD_ZOOM.min, Math.min(BOARD_ZOOM.max, TIMELINE_ZOOM.max / RATIO));
  return { zoom: board, tlZoom: clampZoom(board * RATIO, TIMELINE_ZOOM.min, TIMELINE_ZOOM.max) };
}

// ---------- „Celý příběh“: přiblížení, při kterém se vše vejde na šířku ----------

type Which = 'board' | 'timeline';
const fitters = new Map<Which, () => number | null>();

/** Pohled sem hlásí, jak spočítat své přiblížení pro celý příběh; vrací funkci pro odhlášení. */
export function registerFit(which: Which, fn: () => number | null) {
  fitters.set(which, fn);
  return () => void (fitters.get(which) === fn && fitters.delete(which));
}

/**
 * Přiblížení, při kterém se celý příběh vejde do pohledu `which`.
 * Při propojení se bere to menší z obou zobrazených pohledů, aby se vešel do tabule i na osu.
 */
export function fitZoom(which: Which, linked: boolean): { which: Which; value: number } | null {
  const own = fitters.get(which)?.() ?? null;
  if (own === null) return null;
  if (!linked) return { which, value: own };
  const other: Which = which === 'board' ? 'timeline' : 'board';
  const theirs = fitters.get(other)?.() ?? null;
  const asBoard = (w: Which, v: number) => (w === 'board' ? v : v / RATIO);
  return { which: 'board', value: Math.min(asBoard(which, own), theirs === null ? Infinity : asBoard(other, theirs)) };
}
