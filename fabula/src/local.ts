import type { Project } from './model';
import { dbGet, dbSet } from './db';

/**
 * Data, která patří k tomuto prohlížeči, ne k projektu:
 * statistika psaní (kolik slov přibylo který den), zálohy projektu a vzhled.
 */

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

// ---------- Statistika psaní ----------

export interface Productivity {
  /** Den (RRRR-MM-DD) → počet přidaných slov. */
  days: Record<string, number>;
  /** Denní cíl ve slovech. */
  goal: number;
}

const PROD_KEY = 'fabula.productivity';
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const loadProductivity = (): Productivity => read<Productivity>(PROD_KEY, { days: {}, goal: 500 });
export const saveGoal = (goal: number) => write(PROD_KEY, { ...loadProductivity(), goal });

let baseline: number | null = null;
/** Zaznamená přírůstek slov oproti poslednímu stavu. Úbytek (mazání, krok zpět) se neodečítá. */
export function recordWords(total: number) {
  if (baseline !== null && total > baseline) {
    const p = loadProductivity();
    p.days[today()] = (p.days[today()] ?? 0) + (total - baseline);
    write(PROD_KEY, p);
  }
  baseline = total;
}
/** Po otevření jiného projektu začínáme počítat od jeho stavu, ne od rozdílu mezi projekty. */
export const rebaseWords = (total: number) => void (baseline = total);

/** Počet po sobě jdoucích dní se splněným cílem, počítáno od dneška (nebo včerejška) zpět. */
export function streak(p: Productivity): number {
  let n = 0;
  const d = new Date();
  if ((p.days[today(d)] ?? 0) < p.goal) d.setDate(d.getDate() - 1);
  while ((p.days[today(d)] ?? 0) >= p.goal && p.goal > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// ---------- Zálohy ----------

export interface Backup {
  time: number;
  reason: string;
  title: string;
  beats: number;
  project: Project;
}

const BACKUP_KEY = 'fabula.backups';
const KEEP = 6;
const EVERY = 5 * 60 * 1000;
export const loadBackups = async (): Promise<Backup[]> => (await dbGet<Backup[]>(BACKUP_KEY).catch(() => undefined)) ?? [];

export async function saveBackup(project: Project, reason: string) {
  if (!Object.keys(project.beats).length) return;
  const list = [{ time: Date.now(), reason, title: project.title, beats: Object.keys(project.beats).length, project }, ...(await loadBackups())].slice(0, KEEP);
  await dbSet(BACKUP_KEY, list).catch(() => undefined);
}

let lastAuto = Date.now();
/** Průběžná záloha: nejvýše jednou za pět minut práce. */
export function autoBackup(project: Project) {
  if (Date.now() - lastAuto < EVERY) return;
  lastAuto = Date.now();
  void saveBackup(project, 'průběžná záloha');
}

// ---------- Vzhled ----------

export type Theme = 'light' | 'dark';
const THEME_KEY = 'fabula.theme';
export const loadTheme = (): Theme => read<Theme | null>(THEME_KEY, null) ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  write(THEME_KEY, theme);
}

// ---------- Přiblížení scénáře ----------

const SCRIPT_ZOOM_KEY = 'fabula.scriptZoom';
export const SCRIPT_ZOOM = { min: 0.6, max: 3 };
export const loadScriptZoom = () => Math.min(SCRIPT_ZOOM.max, Math.max(SCRIPT_ZOOM.min, read<number>(SCRIPT_ZOOM_KEY, 1) || 1));
export const saveScriptZoom = (zoom: number) => write(SCRIPT_ZOOM_KEY, zoom);

// ---------- Co je ve scénáři vidět ----------

/** Doplňky kolem textu scénáře; když jsou všechny vypnuté, zbude čistý scénář. */
export interface ScriptShow {
  titles: boolean;
  synopsis: boolean;
  tags: boolean;
  breaks: boolean;
  pages: boolean;
  /** Storybeaty a storypointy scény z Dramatiky. */
  dramatica: boolean;
}
export const SCRIPT_SHOW_ALL: ScriptShow = { titles: true, synopsis: true, tags: true, breaks: true, pages: true, dramatica: true };
export const SCRIPT_SHOW_NONE: ScriptShow = { titles: false, synopsis: false, tags: false, breaks: false, pages: false, dramatica: false };
const SCRIPT_SHOW_KEY = 'fabula.scriptShow';
export const loadScriptShow = (): ScriptShow => ({ ...SCRIPT_SHOW_ALL, ...read<Partial<ScriptShow>>(SCRIPT_SHOW_KEY, {}) });
export const saveScriptShow = (show: ScriptShow) => write(SCRIPT_SHOW_KEY, show);

// ---------- Rozložení oken ----------

/** Podíly oken, které jdou měnit tažením, a co je schované. */
export interface Panes {
  /** Pohled Vše: podíl scénáře na šířce (na úzkém displeji na výšce). */
  script: number;
  /** Pohled Vše: podíl časové osy na výšce pravé části. */
  timeline: number;
  /** Tabule: podíl panelu s textem scény na výšce. */
  split: number;
  /** Pohled Vše bez scénáře: jen časová osa a tabule. */
  scriptOff: boolean;
}
export const PANES_DEFAULT: Panes = { script: 0.36, timeline: 0.45, split: 0.36, scriptOff: false };
const PANES_KEY = 'fabula.panes';
const share = (v: unknown, fallback: number) => (typeof v === 'number' && v > 0.05 && v < 0.95 ? v : fallback);
export const loadPanes = (): Panes => {
  const raw = read<Partial<Panes>>(PANES_KEY, {});
  return {
    script: share(raw.script, PANES_DEFAULT.script),
    timeline: share(raw.timeline, PANES_DEFAULT.timeline),
    split: share(raw.split, PANES_DEFAULT.split),
    scriptOff: raw.scriptOff === true,
  };
};
export const savePanes = (panes: Panes) => write(PANES_KEY, panes);

// ---------- Počet stran vedle sebe ----------

export const PAGE_COLS_MAX = 6;
const PAGE_COLS_KEY = 'fabula.pageCols';
export const loadPageCols = () => Math.min(PAGE_COLS_MAX, Math.max(1, Math.round(read<number>(PAGE_COLS_KEY, 1)) || 1));
export const savePageCols = (n: number) => write(PAGE_COLS_KEY, n);
