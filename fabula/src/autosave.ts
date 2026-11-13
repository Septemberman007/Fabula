import { useSyncExternalStore } from 'react';
import type { Project } from './model';
import { dbDel, dbGet, dbSet } from './db';

/**
 * Automatické ukládání do složky na disku, kterou si uživatel zvolí (třeba na iCloud Drive).
 * Používá File System Access API, které umí Chrome, Edge a další prohlížeče na Chromiu; Safari a Firefox ne.
 *
 * Ve složce vzniká soubor „<název příběhu>.fabula.json“ a podsložka „zalohy“ s časově označenými kopiemi.
 */

type Dir = any; // FileSystemDirectoryHandle – typy pro oprávnění a výběr složky v TypeScriptu zatím chybí.

export interface SaveState {
  supported: boolean;
  /** Vestavěný náhled (aplikace na Electronu): okno pro výběr složky se otevře, ale výsledek stránce nevrátí. */
  embedded: boolean;
  /** off: nezvoleno · locked: složka je zvolená, ale prohlížeč po znovunačtení čeká na povolení · on: ukládá se */
  status: 'off' | 'locked' | 'on';
  folder: string;
  minutes: number;
  lastSaved: number | null;
  dirty: boolean;
  error: string;
}

const MIN_KEY = 'fabula.autosave.minutes';
const BACKUP_EVERY = 30 * 60 * 1000;
const BACKUPS_KEEP = 12;
const BACKUP_DIR = 'zalohy';

let dir: Dir | null = null;
let getProject: () => Project = () => {
  throw new Error('autosave není inicializované');
};
let lastBackup = 0;
let saving = false;

let state: SaveState = {
  supported: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  embedded: typeof navigator !== 'undefined' && /Electron|Claude\//.test(navigator.userAgent),
  status: 'off',
  folder: '',
  minutes: Number(localStorage.getItem(MIN_KEY)) || 2,
  lastSaved: null,
  dirty: false,
  error: '',
};
const listeners = new Set<() => void>();
const set = (patch: Partial<SaveState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const useSaveState = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

// ---------- Zapamatování složky mezi spuštěními (IndexedDB umí uložit odkaz na složku) ----------

const remember = (handle: Dir | null) => (handle ? dbSet('dir', handle) : dbDel('dir')).catch(() => undefined);

// ---------- Zápis ----------

const safeName = (title: string) => (title.trim() || 'pribeh').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
};

async function writeFile(folder: Dir, name: string, text: string) {
  const file = await folder.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(text);
  await w.close();
}

async function backup(folder: Dir, base: string, text: string) {
  const sub = await folder.getDirectoryHandle(BACKUP_DIR, { create: true });
  await writeFile(sub, `${base} ${stamp()}.fabula.json`, text);
  const names: string[] = [];
  for await (const [name, h] of sub.entries()) if (h.kind === 'file' && name.startsWith(`${base} `) && name.endsWith('.fabula.json')) names.push(name);
  names.sort();
  for (const old of names.slice(0, Math.max(0, names.length - BACKUPS_KEEP))) await sub.removeEntry(old);
}

/** Uloží projekt do zvolené složky. Vrací true, když se zápis povedl. */
export async function saveNow(): Promise<boolean> {
  if (!dir || state.status !== 'on' || saving) return false;
  saving = true;
  try {
    const project = getProject();
    const text = JSON.stringify(project, null, 2);
    const base = safeName(project.title);
    await writeFile(dir, `${base}.fabula.json`, text);
    if (Date.now() - lastBackup >= BACKUP_EVERY && Object.keys(project.beats).length) {
      await backup(dir, base, text);
      lastBackup = Date.now();
    }
    set({ lastSaved: Date.now(), dirty: false, error: '' });
    return true;
  } catch (e) {
    // Typicky odebrané oprávnění nebo odpojený disk.
    set({ error: e instanceof Error ? e.message : String(e), status: (e as any)?.name === 'NotAllowedError' ? 'locked' : state.status });
    return false;
  } finally {
    saving = false;
  }
}

/** Store hlásí každou změnu projektu; o zápis se postará časovač. */
export const markDirty = () => state.status !== 'off' && !state.dirty && set({ dirty: true });

export function setMinutes(minutes: number) {
  localStorage.setItem(MIN_KEY, String(minutes));
  set({ minutes });
}

/** Zapne ukládání do dané složky (odkaz na složku se zapamatuje). */
export async function setFolder(handle: Dir) {
  dir = handle;
  lastBackup = 0;
  await remember(handle);
  set({ status: 'on', folder: handle.name, error: '' });
  await saveNow();
}

/** Otevře systémový výběr složky. Musí se volat z kliknutí. */
export async function chooseFolder() {
  set({ error: '' });
  let handle: Dir;
  try {
    handle = await (window as any).showDirectoryPicker({ id: 'fabula', mode: 'readwrite' });
  } catch (e) {
    // AbortError přijde při zrušení okna, ale i když prostředí výběr složky vůbec nepovolí.
    const name = (e as any)?.name ?? '';
    console.warn('[fabula] výběr složky selhal:', name, e);
    return set({
      error:
        name === 'AbortError'
          ? 'Výběr složky skončil bez výsledku. Pokud jsi okno nezavřel sám, toto prostředí přístup ke složkám nepovoluje – otevři aplikaci v Chromu.'
          : `Složku se nepodařilo zvolit (${name || 'chyba'}): ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  try {
    await setFolder(handle);
  } catch (e) {
    console.warn('[fabula] zapnutí ukládání selhalo:', e);
    set({ error: `Složka je zvolená, ale zápis do ní selhal: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/** Po znovunačtení stránky prohlížeč chce oprávnění potvrdit kliknutím. */
export async function unlock() {
  if (!dir) return;
  try {
    if ((await dir.requestPermission({ mode: 'readwrite' })) === 'granted') {
      set({ status: 'on', error: '' });
      await saveNow();
    }
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
}

export async function turnOff() {
  dir = null;
  await remember(null);
  set({ status: 'off', folder: '', dirty: false, error: '', lastSaved: null });
}

/** Projekty a zálohy uložené ve zvolené složce, nejnovější první. */
export async function listSaved(): Promise<{ name: string; backup: boolean; modified: number; read: () => Promise<string> }[]> {
  if (!dir || state.status !== 'on') return [];
  const out: { name: string; backup: boolean; modified: number; read: () => Promise<string> }[] = [];
  const scan = async (folder: Dir, isBackup: boolean) => {
    for await (const [name, h] of folder.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.fabula.json')) continue;
      const file = await h.getFile();
      out.push({ name, backup: isBackup, modified: file.lastModified, read: async () => (await h.getFile()).text() });
    }
  };
  await scan(dir, false);
  try {
    await scan(await dir.getDirectoryHandle(BACKUP_DIR), true);
  } catch {
    /* složka se zálohami ještě neexistuje */
  }
  return out.sort((a, b) => b.modified - a.modified);
}

export async function initAutosave(project: () => Project) {
  getProject = project;
  if (!state.supported) return;
  try {
    const handle = await dbGet<Dir>('dir');
    if (handle) {
      dir = handle;
      const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
      set({ status: granted ? 'on' : 'locked', folder: handle.name });
    }
  } catch {
    /* IndexedDB nedostupná – ukládání zůstane vypnuté */
  }
  // Časovač: ukládá, když je co uložit a uplynul zvolený interval.
  setInterval(() => {
    if (state.status === 'on' && state.dirty && Date.now() - (state.lastSaved ?? 0) >= state.minutes * 60000) void saveNow();
  }, 15000);
  // Při odchodu ze stránky nebo přepnutí jinam se pokusíme uložit hned.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && state.dirty && void saveNow());
}
