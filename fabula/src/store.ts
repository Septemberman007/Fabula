import { useSyncExternalStore } from 'react';
import { produce } from 'immer';
import { Beat, BoardNote, CharRole, ID, NOTE_COLORS, PALETTE, Para, Project, ResearchItem, TagMode, newBeat, uid } from './model';
import { carriedLevel } from './tension';
import { Theme, applyTheme, autoBackup, loadTheme, rebaseWords, recordWords, saveBackup } from './local';
import { totalWords } from './stats';
import { initAutosave, markDirty } from './autosave';
import { dbGet, dbSet } from './db';
import { EMPTY_FILTER, Filter } from './filter';
import { emptyProject, seed } from './seed';
import { normalize } from './io';
import { titleCase, unknownSpeakers } from './text';

export type View = 'board' | 'script' | 'timeline' | 'all' | 'reports' | 'research';
export type Tab = 'detail' | 'cast' | 'issues';
export type ColorBy = 'lane' | 'tag' | 'status';

export interface State {
  project: Project;
  selected: ID | null;
  /** Výběr více beatů najednou (prázdné = jen `selected`). */
  multi: ID[];
  filter: Filter;
  filterOpen: boolean;
  /** Pravý panel s detailem je zobrazený. */
  inspector: boolean;
  /** Podle čeho se barví karty a bloky beatů. */
  colorBy: ColorBy;
  /** Postavy, jejichž repliky jsou ve scénáři zvýrazněné. */
  highlight: ID[];
  theme: Theme;
  /** Sbalené oddíly časové osy (kategorie motivů, skupiny postav). */
  collapsed: string[];
  /** Otevřená položka rešerše. */
  research: ID | null;
  /** Když je nastaveno, další klik na beat vytvoří vazbu linkFrom → beat. */
  linkFrom: ID | null;
  view: View;
  tab: Tab;
  /** Tabule: přiblížení a panel s textem vybraného beatu. */
  zoom: number;
  /** Časová osa: vodorovné přiblížení. */
  tlZoom: number;
  split: boolean;
  /** Časová osa: šířka beatu podle délky textu. */
  byLength: boolean;
  /** Neprázdné, když se projekt nepodařilo uložit do prohlížeče. */
  saveError: string;
  past: Project[];
  future: Project[];
}

const KEY = 'fabula.project.v1';

const DB_KEY = 'project';

/** Dřívější verze ukládaly projekt do localStorage; ten má limit pár megabajtů a velký scénář se do něj nevešel. */
function loadLegacy(): Project | null {
  try {
    const raw = localStorage.getItem(KEY);
    return (raw && normalize(JSON.parse(raw))) || null;
  } catch {
    return null;
  }
}

/**
 * Načte uložený projekt před prvním vykreslením. Volá se jednou z main.tsx.
 * Pořadí: úložiště IndexedDB → starší localStorage → ukázkový příběh.
 */
export async function boot() {
  let project: Project | null = null;
  try {
    project = normalize(await dbGet<Project>(DB_KEY));
  } catch {
    /* úložiště nedostupné (soukromé okno apod.) */
  }
  project ??= loadLegacy();
  if (project) {
    state = { ...state, project };
    rebaseWords(totalWords(project));
  }
}

/** Uloží projekt do prohlížeče; při neúspěchu to dá uživateli vědět ve stavu. */
async function persist() {
  try {
    await dbSet(DB_KEY, state.project);
    localStorage.removeItem(KEY);
    if (state.saveError) emit({ ...state, saveError: '' });
  } catch (e) {
    emit({ ...state, saveError: e instanceof Error ? e.message : String(e) });
  }
}

let state: State = {
  project: seed(),
  saveError: '',
  selected: null,
  multi: [],
  filter: EMPTY_FILTER,
  filterOpen: false,
  inspector: true,
  colorBy: 'lane',
  highlight: [],
  theme: loadTheme(),
  collapsed: [],
  research: null,
  linkFrom: null,
  view: 'board',
  tab: 'detail',
  zoom: 1,
  tlZoom: 1,
  split: false,
  byLength: false,
  past: [],
  future: [],
};

applyTheme(state.theme);
void initAutosave(() => state.project);
rebaseWords(totalWords(state.project));

const listeners = new Set<() => void>();
let saveTimer: number | undefined;

/** Při kroku zpět a znovu se změna počtu slov nepočítá jako psaní. */
let quiet = false;

function emit(next: State) {
  const projectChanged = next.project !== state.project;
  state = next;
  listeners.forEach((l) => l());
  if (projectChanged) {
    if (quiet) rebaseWords(totalWords(state.project));
    else recordWords(totalWords(state.project));
    quiet = false;
    autoBackup(state.project);
    markDirty();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void persist(), 400);
  }
}

export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const getState = () => state;

/** Odběr jedné části stavu: komponenta se překreslí, jen když se změní právě ona (výběr musí vracet stabilní hodnotu). */
export function useSel<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}
export const ui = (patch: Partial<Pick<State, 'selected' | 'multi' | 'filter' | 'filterOpen' | 'inspector' | 'colorBy' | 'highlight' | 'collapsed' | 'research' | 'linkFrom' | 'view' | 'tab' | 'zoom' | 'tlZoom' | 'split' | 'byLength'>>) =>
  emit({ ...state, ...patch });

let lastKey = '';
let lastTime = 0;

/** Změní projekt a zapíše krok do historie. Stejný `key` krátce po sobě (psaní) se slučuje do jednoho kroku. */
function mutate(fn: (p: Project) => void, key?: string) {
  // Immer kopíruje jen to, co se změnilo: nedotčené beaty si drží identitu, takže se nemusí znovu kreslit ani přepočítávat.
  const next = produce(state.project, (draft) => {
    fn(draft);
  });
  const now = Date.now();
  const coalesce = !!key && key === lastKey && now - lastTime < 1200;
  lastKey = key ?? '';
  lastTime = now;
  emit({
    ...state,
    project: next,
    past: coalesce ? state.past : [...state.past.slice(-99), state.project],
    future: [],
  });
}

function keepSelection(p: Project, s: State): Pick<State, 'selected' | 'linkFrom' | 'multi' | 'research'> {
  const exists = (id: ID | null) => (id && (p.beats[id] || p.breaks[id]) ? id : null);
  return {
    selected: exists(s.selected),
    linkFrom: exists(s.linkFrom),
    multi: s.multi.filter((id) => p.beats[id]),
    research: p.research.some((r) => r.id === s.research) ? s.research : null,
  };
}

function replaceProject(next: Project) {
  void saveBackup(state.project, 'před otevřením jiného projektu');
  rebaseWords(totalWords(next));
  mutate((p) => {
    for (const k of Object.keys(p)) delete (p as any)[k];
    Object.assign(p, next);
  });
  ui({ selected: null, linkFrom: null, multi: [], research: null, filter: EMPTY_FILTER });
}

export const actions = {
  undo() {
    const prev = state.past.at(-1);
    if (!prev) return;
    lastKey = '';
    quiet = true;
    emit({ ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future], ...keepSelection(prev, state) });
  },
  redo() {
    const next = state.future[0];
    if (!next) return;
    lastKey = '';
    quiet = true;
    emit({ ...state, project: next, past: [...state.past, state.project], future: state.future.slice(1), ...keepSelection(next, state) });
  },

  setTheme(theme: Theme) {
    applyTheme(theme);
    emit({ ...state, theme });
  },
  setTargetPages(n: number) {
    mutate((p) => void (p.targetPages = Math.max(1, Math.round(n) || 1)), 'target');
  },
  /** Zahájí novou sadu revizí: zapamatuje si současný text všech odstavců jako výchozí stav. */
  startRevision(name: string, color: string) {
    mutate((p) => {
      const base: Record<ID, string> = {};
      for (const b of Object.values(p.beats)) for (const x of b.paras) base[x.id] = x.text;
      p.revisions.push({ id: uid(), name, color, started: Date.now(), base });
    });
  },
  deleteRevision(id: ID) {
    mutate((p) => void (p.revisions = p.revisions.filter((r) => r.id !== id)));
  },
  setTitlePage(patch: Partial<Project['titlePage']>) {
    mutate((p) => void Object.assign(p.titlePage, patch), 'titlepage');
  },
  /** Odloží současný text beatu jako pojmenovanou verzi; psát se pokračuje v jeho kopii. */
  saveVersion(beatId: ID, name: string) {
    mutate((p) => {
      const b = p.beats[beatId];
      b.versions.push({ id: uid(), name: b.versionName || 'Původní verze', paras: b.paras.map((x) => ({ ...x })) });
      b.paras = b.paras.map((x) => ({ ...x, id: uid() }));
      b.versionName = name;
    });
  },
  /** Vymění současný text beatu za odloženou verzi. */
  switchVersion(beatId: ID, versionId: ID) {
    mutate((p) => {
      const b = p.beats[beatId];
      const v = b.versions.find((x) => x.id === versionId)!;
      [b.paras, v.paras] = [v.paras, b.paras];
      [b.versionName, v.name] = [v.name, b.versionName || 'Původní verze'];
    });
    // Přepnutí verze není psaní: do statistiky slov se nepočítá.
    rebaseWords(totalWords(state.project));
  },
  deleteVersion(beatId: ID, versionId: ID) {
    mutate((p) => void (p.beats[beatId].versions = p.beats[beatId].versions.filter((x) => x.id !== versionId)));
  },

  setTitle(title: string) {
    mutate((p) => void (p.title = title), 'title');
  },

  addBeat(laneId?: ID, index?: number): ID {
    const beat = newBeat(laneId ?? state.project.lanes[0].id);
    mutate((p) => {
      p.beats[beat.id] = beat;
      p.order.splice(index ?? p.order.length, 0, beat.id);
    });
    ui({ selected: beat.id, multi: [], tab: 'detail' });
    return beat.id;
  },
  updateBeat(id: ID, patch: Partial<Beat>, key?: string) {
    mutate((p) => void Object.assign(p.beats[id], patch), key ? `${key}:${id}` : undefined);
  },
  /** Úprava odstavců scénáře jednoho beatu. */
  editParas(beatId: ID, fn: (paras: Para[]) => void, key?: string) {
    mutate((p) => fn(p.beats[beatId].paras), key ? `${key}:${beatId}` : undefined);
  },
  toggleCharacter(beatId: ID, charId: ID) {
    mutate((p) => {
      const b = p.beats[beatId];
      b.characterIds = b.characterIds.includes(charId) ? b.characterIds.filter((c) => c !== charId) : [...b.characterIds, charId];
    });
  },
  toggleTag(beatId: ID, tagId: ID) {
    mutate((p) => {
      const b = p.beats[beatId];
      if (b.tagIds.includes(tagId)) {
        b.tagIds = b.tagIds.filter((c) => c !== tagId);
        delete b.tagLevels[tagId];
      } else {
        // Nový výskyt naváže na úroveň, kterou měl motiv naposledy.
        b.tagLevels[tagId] = carriedLevel(p, tagId, beatId);
        b.tagIds.push(tagId);
      }
    });
  },
  setTagLevel(beatId: ID, tagId: ID, level: number, key?: string) {
    mutate((p) => void (p.beats[beatId].tagLevels[tagId] = Math.max(0, Math.min(10, Math.round(level)))), key ? `${key}:${beatId}:${tagId}` : undefined);
  },

  addBreak(index?: number): ID {
    const id = uid();
    mutate((p) => {
      p.breaks[id] = { id, title: 'Nový předěl' };
      p.order.splice(index ?? p.order.length, 0, id);
    });
    ui({ selected: id, tab: 'detail' });
    return id;
  },
  updateBreak(id: ID, title: string) {
    mutate((p) => void (p.breaks[id].title = title), `break:${id}`);
  },

  /** Smaže beat nebo předěl včetně navázaných vazeb. */
  deleteItem(id: ID) {
    mutate((p) => {
      delete p.beats[id];
      delete p.breaks[id];
      p.order = p.order.filter((x) => x !== id);
      p.links = p.links.filter((l) => l.from !== id && l.to !== id);
      for (const r of p.research) r.beatIds = r.beatIds.filter((b) => b !== id);
    });
    emit({ ...state, ...keepSelection(state.project, state) });
  },
  /** `index` je pozice v pořadí po vyjmutí přesouvané položky. */
  moveItem(id: ID, index: number, laneId?: ID, concurrent = false) {
    mutate((p) => {
      // Beat, který byl souběžný s přesouvaným, by se jinak přilepil k cizímu sousedovi.
      const after = p.beats[p.order[p.order.indexOf(id) + 1]];
      if (p.beats[id] && after?.concurrent && !p.beats[id].concurrent) after.concurrent = false;
      p.order = p.order.filter((x) => x !== id);
      p.order.splice(Math.max(0, Math.min(index, p.order.length)), 0, id);
      if (p.beats[id]) {
        if (laneId) p.beats[id].laneId = laneId;
        p.beats[id].concurrent = concurrent;
      }
    });
  },
  /** Založí blok a vnoří do něj skupinu. */
  addBlockFor(groupId: ID) {
    mutate((p) => {
      const blk = { id: uid(), title: 'Nový blok', color: PALETTE[(p.groups.length + 4) % PALETTE.length], collapsed: false, parentId: null };
      p.groups.push(blk);
      p.groups.find((g) => g.id === groupId)!.parentId = blk.id;
    });
  },

  /** Přesune několik beatů najednou; zachová jejich vzájemné pořadí. `index` je pozice po vyjmutí všech přesouvaných. */
  moveItems(ids: ID[], index: number, laneId?: ID) {
    mutate((p) => {
      const moving = p.order.filter((x) => ids.includes(x));
      p.order = p.order.filter((x) => !ids.includes(x));
      p.order.splice(Math.max(0, Math.min(index, p.order.length)), 0, ...moving);
      if (laneId) for (const id of moving) if (p.beats[id]) p.beats[id].laneId = laneId;
    });
  },
  /** Hromadná úprava vybraných beatů. */
  updateBeats(ids: ID[], patch: Partial<Beat>) {
    mutate((p) => {
      for (const id of ids) if (p.beats[id]) Object.assign(p.beats[id], patch);
    });
  },
  setTagOnBeats(ids: ID[], tagId: ID, on: boolean) {
    mutate((p) => {
      for (const id of ids) {
        const b = p.beats[id];
        if (!b) continue;
        b.tagIds = b.tagIds.filter((t) => t !== tagId);
        if (on) b.tagIds.push(tagId);
      }
    });
  },
  /** Založí sekvenci z vybraných beatů. */
  groupBeats(ids: ID[]) {
    mutate((p) => {
      const g = { id: uid(), title: 'Nová skupina', color: PALETTE[(p.groups.length + 2) % PALETTE.length], collapsed: false, parentId: null };
      p.groups.push(g);
      for (const id of ids) if (p.beats[id]) p.beats[id].groupId = g.id;
    });
  },
  deleteItems(ids: ID[]) {
    mutate((p) => {
      for (const id of ids) {
        delete p.beats[id];
        delete p.breaks[id];
      }
      p.order = p.order.filter((x) => !ids.includes(x));
      p.links = p.links.filter((l) => !ids.includes(l.from) && !ids.includes(l.to));
      for (const r of p.research) r.beatIds = r.beatIds.filter((b) => !ids.includes(b));
    });
    emit({ ...state, ...keepSelection(state.project, state) });
  },

  addNote(x: number, y: number): ID {
    const id = uid();
    mutate((p) => void p.notes.push({ id, text: '', x, y, color: NOTE_COLORS[p.notes.length % NOTE_COLORS.length] }));
    return id;
  },
  updateNote(id: ID, patch: Partial<BoardNote>, key?: string) {
    mutate((p) => void Object.assign(p.notes.find((n) => n.id === id)!, patch), key ? `${key}:${id}` : undefined);
  },
  deleteNote(id: ID) {
    mutate((p) => void (p.notes = p.notes.filter((n) => n.id !== id)));
  },

  addResearch(folder: string, patch: Partial<ResearchItem> = {}): ID {
    const id = uid();
    mutate((p) => void p.research.push({ id, title: '', text: '', folder, url: '', beatIds: [], ...patch }));
    ui({ research: id });
    return id;
  },
  updateResearch(id: ID, patch: Partial<ResearchItem>, key?: string) {
    mutate((p) => void Object.assign(p.research.find((r) => r.id === id)!, patch), key ? `${key}:${id}` : undefined);
  },
  deleteResearch(id: ID) {
    mutate((p) => void (p.research = p.research.filter((r) => r.id !== id)));
    emit({ ...state, ...keepSelection(state.project, state) });
  },

  addLink(from: ID, to: ID): boolean {
    const p = state.project;
    if (from === to || !p.beats[from] || !p.beats[to]) return false;
    if (p.links.some((l) => l.from === from && l.to === to)) return false;
    mutate((d) => void d.links.push({ id: uid(), from, to, note: '' }));
    return true;
  },
  updateLink(id: ID, note: string) {
    mutate((p) => void (p.links.find((l) => l.id === id)!.note = note), `link:${id}`);
  },
  removeLink(id: ID) {
    mutate((p) => void (p.links = p.links.filter((l) => l.id !== id)));
  },

  addLane() {
    mutate((p) => void p.lanes.push({ id: uid(), name: 'Nová linie', color: PALETTE[p.lanes.length % PALETTE.length] }));
  },
  updateLane(id: ID, patch: { name?: string; color?: string }) {
    mutate((p) => void Object.assign(p.lanes.find((l) => l.id === id)!, patch), `lane:${id}`);
  },
  /** Beaty ze smazané linie se přesunou do první zbývající. */
  deleteLane(id: ID) {
    if (state.project.lanes.length < 2) return;
    mutate((p) => {
      p.lanes = p.lanes.filter((l) => l.id !== id);
      for (const b of Object.values(p.beats)) if (b.laneId === id) b.laneId = p.lanes[0].id;
    });
  },

  addCharacter() {
    mutate((p) => void p.characters.push({ id: uid(), name: '', color: PALETTE[(p.characters.length + 2) % PALETTE.length], aliases: '', role: 'main' }));
  },
  /** Založí postavy pro všechny mluvčí ze scénáře, kteří v seznamu chybí. */
  addUnknownSpeakers() {
    const names = unknownSpeakers(state.project);
    if (!names.length) return;
    mutate((p) => {
      for (const n of names) p.characters.push({ id: uid(), name: titleCase(n), color: PALETTE[(p.characters.length + 2) % PALETTE.length], aliases: '', role: 'small' });
    });
  },
  updateCharacter(id: ID, patch: { name?: string; color?: string; aliases?: string; role?: CharRole }) {
    mutate((p) => void Object.assign(p.characters.find((c) => c.id === id)!, patch), `char:${id}`);
  },
  deleteCharacter(id: ID) {
    mutate((p) => {
      p.characters = p.characters.filter((c) => c.id !== id);
      for (const b of Object.values(p.beats)) b.characterIds = b.characterIds.filter((c) => c !== id);
    });
  },

  addTag(category = 'Obecné', mode: TagMode = 'change') {
    mutate((p) => void p.tags.push({ id: uid(), name: '', color: PALETTE[(p.tags.length + 5) % PALETTE.length], mode, category }));
  },
  updateTag(id: ID, patch: { name?: string; color?: string; mode?: TagMode; category?: string }) {
    mutate((p) => void Object.assign(p.tags.find((c) => c.id === id)!, patch), `tag:${id}`);
  },
  deleteTag(id: ID) {
    mutate((p) => {
      p.tags = p.tags.filter((c) => c.id !== id);
      for (const b of Object.values(p.beats)) b.tagIds = b.tagIds.filter((c) => c !== id);
    });
  },

  /** Založí novou sekvenci a zařadí do ní beat. */
  addGroup(beatId: ID) {
    mutate((p) => {
      const g = { id: uid(), title: 'Nová skupina', color: PALETTE[(p.groups.length + 2) % PALETTE.length], collapsed: false, parentId: null };
      p.groups.push(g);
      p.beats[beatId].groupId = g.id;
    });
  },
  updateGroup(id: ID, patch: { title?: string; color?: string; collapsed?: boolean; parentId?: ID | null }) {
    mutate((p) => void Object.assign(p.groups.find((c) => c.id === id)!, patch), `group:${id}`);
  },
  deleteGroup(id: ID) {
    mutate((p) => {
      p.groups = p.groups.filter((c) => c.id !== id);
      for (const b of Object.values(p.beats)) if (b.groupId === id) b.groupId = null;
      for (const g of p.groups) if (g.parentId === id) g.parentId = null;
    });
  },

  newProject() {
    replaceProject(emptyProject());
  },
  loadProject(p: Project) {
    replaceProject(p);
  },
};
