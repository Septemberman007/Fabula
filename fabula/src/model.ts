export type ID = string;

export interface Lane {
  id: ID;
  name: string;
  color: string;
}

export interface Character {
  id: ID;
  name: string;
  color: string;
  /** Další slova, podle kterých se postava pozná v textu (čárkami oddělená). */
  aliases: string;
  role: CharRole;
}

export type CharRole = 'main' | 'secondary' | 'small';

export const ROLE_LABEL: Record<CharRole, string> = {
  main: 'Hlavní postavy',
  secondary: 'Vedlejší postavy',
  small: 'Malé role',
};

/** Motiv, téma nebo rekvizita sledovaná napříč příběhem. */
export interface Tag {
  id: ID;
  name: string;
  color: string;
  /** Jak motiv vytváří napětí: roste s úrovní, vzniká změnou úrovně, nebo se jen sleduje. */
  mode: TagMode;
  /** Kategorie, pod kterou se motiv řadí na časové ose. */
  category: string;
}

/** Přednastavené kategorie motivů a jejich výchozí chování. */
export const TAG_CATEGORIES: [string, TagMode][] = [
  ['Mini-zápletky', 'none'],
  ['Nebezpečí', 'rising'],
  ['Rysy postav', 'change'],
  ['Cíle', 'change'],
  ['Schopnosti', 'change'],
  ['Témata', 'none'],
  ['Obecné', 'change'],
];

/** Kategorie v pořadí zobrazení: přednastavené, pak vlastní. */
export function tagCategories(p: Project): string[] {
  const preset = TAG_CATEGORIES.map(([n]) => n);
  return [...preset, ...new Set(p.tags.map((t) => t.category).filter((c) => !preset.includes(c)))];
}

export type TagMode = 'rising' | 'change' | 'none';

export const TAG_MODE_LABEL: Record<TagMode, string> = {
  rising: 'napětí roste s úrovní',
  change: 'napětí vzniká změnou',
  none: 'jen sledovat',
};

/** Blok nebo skupina beatů. Skupina s `parentId` je vnořená do bloku (blok → skupina → beat). */
export interface Group {
  id: ID;
  title: string;
  color: string;
  /** Sbalený blok či skupina se na tabuli kreslí jako jedna karta. */
  collapsed: boolean;
  parentId: ID | null;
}

/** Blok či skupina, do které beat patří, včetně nadřazeného bloku. */
export function groupChain(p: Project, groupId: ID | null): Group[] {
  const g = p.groups.find((x) => x.id === groupId);
  if (!g) return [];
  const parent = p.groups.find((x) => x.id === g.parentId);
  return parent ? [parent, g] : [g];
}

/** Beaty v bloku či skupině včetně vnořených skupin, v pořadí vyprávění. */
export function groupBeats(p: Project, groupId: ID): ID[] {
  const ids = new Set([groupId, ...p.groups.filter((g) => g.parentId === groupId).map((g) => g.id)]);
  return p.order.filter((id) => p.beats[id]?.groupId && ids.has(p.beats[id].groupId!));
}

export const groupLabel = (p: Project, g: Group) => groupChain(p, g.id).map((x) => x.title || 'Bez názvu').join(' › ');

/** Lepicí poznámka volně položená na tabuli (souřadnice plátna). */
export interface BoardNote {
  id: ID;
  text: string;
  x: number;
  y: number;
  color: string;
}

/** Položka rešerše: podklady, nápady, odložené scény. */
export interface ResearchItem {
  id: ID;
  title: string;
  text: string;
  folder: string;
  url: string;
  beatIds: ID[];
}

export const RESEARCH_FOLDERS = ['Nápady', 'Postavy', 'Lokace', 'Podklady', 'Odložené'];
export const NOTE_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecdd3', '#e9d5ff'];

export type BeatStatus = 'idea' | 'draft' | 'done';

export type ParaType = 'scene' | 'action' | 'character' | 'paren' | 'dialogue' | 'transition';

export interface Para {
  id: ID;
  type: ParaType;
  text: string;
  /** Poznámka ke scénáři připnutá k odstavci; netiskne se. */
  note?: string;
}

/** Sada revizí: od jejího zahájení se změněné odstavce značí hvězdičkou v její barvě. */
export interface Revision {
  id: ID;
  name: string;
  color: string;
  started: number;
  /** Text odstavců v okamžiku zahájení (id odstavce → text). */
  base: Record<ID, string>;
}

/** Obvyklé pořadí barev revizí ve filmové produkci. */
export const REVISION_COLORS: [string, string][] = [
  ['Modrá', '#4a90d9'],
  ['Růžová', '#e0699a'],
  ['Žlutá', '#c9a300'],
  ['Zelená', '#3f9b4b'],
  ['Zlatá', '#b8862b'],
  ['Lososová', '#e0785a'],
  ['Třešňová', '#c0304a'],
];

/** Barva revize, ve které se odstavec naposledy změnil; undefined, pokud se od první revize nezměnil. */
export function revisionMark(p: Project, para: Para): Revision | undefined {
  if (!para.text.trim()) return undefined;
  for (let i = p.revisions.length - 1; i >= 0; i--) if (p.revisions[i].base[para.id] !== para.text) return p.revisions[i];
  return undefined;
}

export interface BeatVersion {
  id: ID;
  name: string;
  paras: Para[];
}

export interface TitlePage {
  author: string;
  basedOn: string;
  draft: string;
  contact: string;
}

export const EMPTY_TITLE_PAGE: TitlePage = { author: '', basedOn: '', draft: '', contact: '' };

export interface Beat {
  id: ID;
  title: string;
  synopsis: string;
  paras: Para[];
  laneId: ID;
  /** Ručně přiřazené postavy; další se rozpoznají z textu. */
  characterIds: ID[];
  tagIds: ID[];
  /** Úroveň motivu v tomto beatu (0–10); chybí-li, platí 5. */
  tagLevels: Record<ID, number>;
  groupId: ID | null;
  /** Děje se současně s předchozím beatem: na tabuli sdílí jeho sloupec. */
  concurrent: boolean;
  /** Vyřazený beat zůstává na tabuli, ale nepočítá se do scénáře, exportů ani statistik. */
  off: boolean;
  /** Název právě používané verze textu a odložené alternativní verze. */
  versionName: string;
  versions: BeatVersion[];
  /** 0–10 */
  tension: number;
  status: BeatStatus;
  /** Storybeat z Dramatiky, ze kterého beat vznikl. */
  dramatica?: DramaticaRef;
  /** Moment nebo Story Driver z Dramatiky, ze kterého beat vznikl. */
  source?: DramaticaSource;
  /** Storybeat, který tato scéna vypráví (klíč „OS/event/3“); u karty storybeatu samotné se nevyplňuje. */
  storybeat?: string;
}

/** Storyform z Dramatiky: to, co se v čase nemění, a seznam storybeatů, ke kterým jde přiřadit scénu. */
export interface Storyform {
  points: { throughline: Throughline | ''; name: string; fn: string; summary: string; text: string }[];
  dynamics: { name: string; value: string; summary: string }[];
  beats: { key: string; uuid?: string; throughline: Throughline; scope: StorybeatScope; sequence: number; fn: string; summary: string }[];
}

export interface DramaticaSource {
  id: string;
  kind: 'moment' | 'driver';
  /** Moment: místo, čas a pokyny ke scéně. Story Driver: jeho Storytelling. */
  text: string;
}

export type Throughline = 'OS' | 'MC' | 'IC' | 'RS';
export type StorybeatScope = 'signpost' | 'progression' | 'event';

/** Odkaz na storybeat v Dramatice: podle něj se beat při dalším importu pozná a jde poslat zpět. */
export interface DramaticaRef {
  uuid?: string;
  throughline: Throughline;
  scope: StorybeatScope;
  /** Pořadí v rámci throughline (Signpost 1–4, Progression 1–16, Event 1–64). */
  sequence: number;
  /** Narrative Function, např. „Instinct“. */
  fn: string;
  /** Storytelling: delší popis, jak se storybeat v příběhu odehraje. */
  storytelling: string;
}

/** Předěl ve struktuře (dějství, kapitola…). */
export interface Break {
  id: ID;
  title: string;
}

/** Kauzální vazba: `from` způsobuje `to`. */
export interface Link {
  id: ID;
  from: ID;
  to: ID;
  /** Slovní zdůvodnění: „protože…“ */
  note: string;
}

export interface Project {
  format: 2;
  id: ID;
  title: string;
  lanes: Lane[];
  characters: Character[];
  tags: Tag[];
  groups: Group[];
  beats: Record<ID, Beat>;
  breaks: Record<ID, Break>;
  /** Pořadí vyprávění: id beatů a předělů. */
  order: ID[];
  links: Link[];
  notes: BoardNote[];
  research: ResearchItem[];
  titlePage: TitlePage;
  revisions: Revision[];
  /** Cílová délka scénáře ve stranách (pro mapu příběhu). */
  targetPages: number;
  /** Formát papíru pro stránkování a tisk. */
  paper: Paper;
  storyform?: Storyform;
}

export type Paper = 'a4' | 'letter';

export const uid = (): ID => crypto.randomUUID();

export const PALETTE = ['#c2410c', '#0f766e', '#6d28d9', '#b45309', '#1d4ed8', '#be185d', '#4d7c0f', '#475569'];

export const STATUS_LABEL: Record<BeatStatus, string> = {
  idea: 'Nápad',
  draft: 'Rozepsáno',
  done: 'Hotovo',
};

export const PARA_LABEL: Record<ParaType, string> = {
  scene: 'Scéna',
  action: 'Akce',
  character: 'Postava',
  paren: 'Poznámka',
  dialogue: 'Dialog',
  transition: 'Přechod',
};

export const newPara = (type: ParaType = 'action', text = ''): Para => ({ id: uid(), type, text });

export function newBeat(laneId: ID, patch: Partial<Beat> = {}): Beat {
  return {
    id: uid(),
    title: '',
    synopsis: '',
    paras: [newPara()],
    laneId,
    characterIds: [],
    tagIds: [],
    tagLevels: {},
    groupId: null,
    concurrent: false,
    off: false,
    versionName: '',
    versions: [],
    tension: 5,
    status: 'idea',
    ...patch,
  };
}

export function beatNumber(p: Project, id: ID): number {
  let n = 0;
  for (const x of p.order) {
    if (p.beats[x]) n++;
    if (x === id) return n;
  }
  return 0;
}

export const beatName = (p: Project, id: ID) => p.beats[id]?.title.trim() || 'Bez názvu';
