import type { Beat, CharRole, ID, Project, StoryBeat, Storyform, StorybeatScope, Throughline } from './model';
import { PALETTE, newBeat, uid } from './model';
import { THROUGHLINE_COLOR } from './colors';

/**
 * Přenos mezi Dramatikou a Fabulou. Storybeaty (Signposty, Progrese, Události) se čtou z exportu CSV
 * nebo z výpisu konektoru (JSON) a stávají se beaty: každá throughline má svou linii, každý Signpost je
 * předěl a skupina. Beat si pamatuje, ze kterého storybeatu vznikl, takže opakovaný import jen doplní změny.
 */

/** Jeden storybeat nezávisle na tom, odkud přišel. */
export interface Storybeat {
  uuid?: string;
  throughline: Throughline;
  scope: StorybeatScope;
  sequence: number;
  fn: string;
  summary: string;
  storytelling: string;
  /** Pořadí ve vyprávění napříč throughlines, pokud ho Dramatica zná. */
  plotOrder: number | null;
  /** Názvy Momentů, do kterých storybeat patří. */
  moments: string[];
}

/**
 * Moment: úsek vyprávění (jako „Catalyst“ nebo „Midpoint“ ve struktuře Save the Cat), do kterého se
 * splétají storybeaty z různých throughlines. Storybeat patří nejvýš do jednoho Momentu.
 */
export interface Moment {
  id: string;
  title: string;
  synopsis: string;
  /** Místo, čas a pokyny ke scéně. */
  text: string;
  act: number;
  order: number;
  /** Storybeaty Momentu v jeho pořadí (klíče „OS/event/3“). */
  storybeats: string[];
}
/** Story Driver: událost, která příběh překlápí do další části. */
export interface Driver {
  id: string;
  /** 0 Initial, 1 Second, 2 Midpoint, 3 Fourth, 4 Concluding. */
  index: number;
  summary: string;
  storytelling: string;
}
export interface Player {
  name: string;
  role: string;
  text: string;
}
/** Všechno, co se z Dramatiky přenáší. */
export interface Bundle {
  title?: string;
  storybeats: Storybeat[];
  moments: Moment[];
  drivers: Driver[];
  players: Player[];
  /** Podklady do rešerše: přehledy (logline, žánr…). */
  notes: { folder: string; title: string; text: string }[];
  /** Storypointy a dynamika příběhu. */
  storyform?: Pick<Storyform, 'points' | 'dynamics'>;
  /** Identifikátor storyformu v Dramatice. */
  storyformId?: string;
}
const DRIVERS = ['Initial Story Driver', 'Second Story Driver', 'Midpoint Story Driver', 'Fourth Story Driver', 'Concluding Story Driver'];

export const THROUGHLINES: { key: Throughline; name: string; color: string }[] = [
  { key: 'OS', name: 'Objective Story', color: THROUGHLINE_COLOR.OS },
  { key: 'MC', name: 'Main Character', color: THROUGHLINE_COLOR.MC },
  { key: 'IC', name: 'Influence Character', color: THROUGHLINE_COLOR.IC },
  { key: 'RS', name: 'Relationship Story', color: THROUGHLINE_COLOR.RS },
];
const TL_ALIASES: Record<string, Throughline> = {
  os: 'OS', objective: 'OS', 'objective story': 'OS', overall: 'OS', 'overall story': 'OS',
  mc: 'MC', main: 'MC', 'main character': 'MC',
  ic: 'IC', oc: 'IC', influence: 'IC', 'influence character': 'IC', obstacle: 'IC', 'obstacle character': 'IC', impact: 'IC', 'impact character': 'IC',
  rs: 'RS', ss: 'RS', relationship: 'RS', 'relationship story': 'RS', subjective: 'RS', 'subjective story': 'RS',
};
const PER_SIGNPOST: Record<StorybeatScope, number> = { signpost: 1, progression: 4, event: 16 };

const text = (v: unknown) => (v == null ? '' : String(v).trim());
const num = (v: unknown) => {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

/** „Objective Story Progression 13“ → throughline, úroveň a pořadí. */
function fromLabel(label: string): Partial<Pick<Storybeat, 'throughline' | 'scope' | 'sequence'>> {
  const m = /^(.*?)\s*(signpost|progression|event)\s*#?(\d+)/i.exec(label);
  if (!m) return {};
  return { throughline: TL_ALIASES[m[1].trim().toLowerCase()], scope: m[2].toLowerCase() as StorybeatScope, sequence: +m[3] };
}

function make(raw: Record<string, unknown>): Storybeat | null {
  const label = fromLabel(text(raw.appreciation));
  const throughline = TL_ALIASES[text(raw.throughline).toLowerCase()] ?? label.throughline;
  const scope = (['signpost', 'progression', 'event'] as const).find((x) => text(raw.scope).toLowerCase().startsWith(x)) ?? label.scope;
  // U Signpostu je jeho číslo ve vlastním sloupci; „Sequence“ tam bývá pořadí uložené verze.
  const sequence = (scope === 'signpost' ? num(raw.signpost) : null) ?? num(raw.sequence) ?? label.sequence;
  if (!throughline || !scope || !sequence) return null;
  return {
    uuid: text(raw.uuid) || undefined,
    throughline,
    scope,
    sequence,
    fn: text(raw.fn),
    summary: text(raw.summary),
    storytelling: text(raw.storytelling),
    plotOrder: num(raw.plotOrder),
    moments: text(raw.moments).split(/\s*[|;]\s*/).filter(Boolean),
  };
}

// ---------- Čtení CSV ----------

/** Rozebere CSV (čárka, středník nebo tabulátor; uvozovky smí obsahovat oddělovač i konec řádku). */
export function parseCsv(src: string): string[][] {
  const s = src.replace(/^﻿/, '');
  const head = s.split('\n', 1)[0];
  const sep = [',', ';', '\t'].map((c) => [c, head.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Podle čeho se pozná sloupec: první shoda v názvu vyhrává. */
const COLUMNS: [keyof Storybeat | 'appreciation' | 'signpost', RegExp][] = [
  ['uuid', /^(uuid|id|storybeat.?(uu)?id)$/],
  ['plotOrder', /plot.?order|^order$|^position$|^index$|^#$/],
  ['throughline', /throughline|perspective|^context$/],
  ['scope', /scope|level|^type$|^kind$/],
  ['sequence', /sequence|^number$|^no\.?$/],
  ['signpost', /^signpost$|^act$/],
  ['fn', /narrative.?function|^function$|^method$|^element$|^variation$|^type.?of.?conflict$/],
  ['summary', /summary|synopsis|^title$|^name$/],
  ['storytelling', /storytelling|illustration|description|^text$|^notes?$|^content$/],
  ['moments', /moment|scene/],
  ['appreciation', /appreciation|storybeat|^beat$|^label$/],
];

/** Storybeaty z exportu CSV. Sloupce se poznají podle názvů v prvním řádku. */
export function storybeatsFromCsv(src: string): Storybeat[] {
  const [head, ...rows] = parseCsv(src);
  if (!head) return [];
  const taken = new Set<number>();
  const at = new Map<string, number>();
  for (const [key, re] of COLUMNS) {
    const i = head.findIndex((h, k) => !taken.has(k) && re.test(h.trim().toLowerCase()));
    if (i >= 0) at.set(key, i), taken.add(i);
  }
  return unique(rows.map((r) => make(Object.fromEntries([...at].map(([k, i]) => [k, r[i]])))).filter((x): x is Storybeat => !!x));
}

/** Identifikátor storyformu ze sloupce „Storyform UUID“. */
export function csvStoryformId(src: string): string | undefined {
  const [head, first] = parseCsv(src);
  const i = head?.findIndex((h) => /^storyform.?(uu)?id$/i.test(h.trim())) ?? -1;
  return (i >= 0 && first?.[i]?.trim()) || undefined;
}

/**
 * Tentýž storybeat uložený vícekrát (starší verze Signpostů): platí ta s delším textem. Texty se neslučují,
 * aby se zpět do Dramatiky nezapsalo něco, co tam nikdy nebylo.
 */
function unique(all: Storybeat[]): Storybeat[] {
  const out = new Map<string, Storybeat>();
  const weight = (x: Storybeat) => x.storytelling.length + x.summary.length;
  for (const sb of all) {
    const old = out.get(key(sb));
    if (!old || weight(sb) > weight(old)) out.set(key(sb), { ...sb, plotOrder: sb.plotOrder ?? old?.plotOrder ?? null });
  }
  return [...out.values()];
}

// ---------- Čtení výpisu konektoru ----------

/** Storybeaty z JSON, který vrací konektor Dramatiky (hledají se kdekoli ve struktuře). */
export function storybeatsFromJson(data: unknown): Storybeat[] {
  const out: Storybeat[] = [];
  const walk = (x: any) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (x.kind === 'Storybeat' || (x.scope && x.sequence && x.throughline)) {
      const sb = make({
        uuid: x.uuid,
        throughline: x.throughline,
        scope: x.scope,
        signpost: x.signpost,
        sequence: x.sequence,
        fn: x.narrative_function?.name ?? x.narrative_function ?? x.fn,
        summary: x.summary,
        storytelling: x.storytelling,
        plotOrder: x.plot_order ?? x.plotOrder,
        appreciation: x.appreciation?.name ?? x.appreciation,
        moments: (x.moments ?? []).map((m: any) => m?.title ?? m).join('|'),
      });
      if (sb) out.push(sb);
      return;
    }
    Object.values(x).forEach(walk);
  };
  walk(data);
  return unique(out);
}

// ---------- Čtení souboru NCP (celý storyform) ----------

const words = (v: unknown) =>
  text(v)
    .replace(/^(do|be)_er$/i, '$1-er')
    .replace(/_/g, ' ')
    .replace(/(^|\s)\w/g, (c) => c.toUpperCase());

/** Je to export storyformu ve formátu NCP? */
export const isNcp = (data: any) => !!data?.payloads?.['dramatica-project:']?.storyforms?.length;

/** Rozebere soubor NCP: storybeaty, Momenty, Story Drivery, postavy a podklady do rešerše. */
export function bundleFromNcp(data: any): Bundle {
  const project = data.payloads['dramatica-project:'];
  const form = project.storyforms[0];
  const sub = form.narrative?.subtext ?? {};
  const idKey = new Map<string, string>();
  const beats: Storybeat[] = [];
  for (const x of sub.storybeats ?? []) {
    const sb = make({ uuid: x.id, throughline: x.throughline, scope: x.scope, signpost: x.signpost, sequence: x.sequence, fn: x.narrative_function, summary: x.summary, storytelling: x.storytelling });
    if (!sb) continue;
    beats.push(sb);
    idKey.set(x.id, key(sb));
  }
  // Zdvojené Momenty (stejný akt, pořadí a název) se sloučí; storybeat zůstane v prvním Momentu, který ho má.
  const moments: Moment[] = [];
  const taken = new Set<string>();
  for (const m of project.stories?.flatMap((st: any) => st.moments ?? []) ?? []) {
    const details = [m.setting && `Místo: ${text(m.setting)}`, m.timing && `Čas: ${text(m.timing)}`, text(m.imperatives)].filter(Boolean).join('\n');
    const title = text(m.summary);
    const linked = [...(m.storybeats ?? [])]
      .sort((x: any, y: any) => (num(x.sequence) ?? 0) - (num(y.sequence) ?? 0))
      .map((l: any) => idKey.get(l.storybeat_id))
      .filter((k: string | undefined): k is string => !!k && !taken.has(k));
    // Nepojmenovaný prázdný Moment nic nenese.
    if ((!title || title === 'Untitled') && !text(m.synopsis) && !details && !linked.length) continue;
    const act = num(m.act) ?? 1;
    const order = num(m.order) ?? 0;
    linked.forEach((k) => taken.add(k));
    const same = moments.find((x) => x.act === act && x.order === order && x.title === (title || 'Moment'));
    if (same) {
      same.storybeats.push(...linked.filter((k) => !same.storybeats.includes(k)));
      same.synopsis ||= text(m.synopsis);
      same.text ||= details;
    } else moments.push({ id: m.id, title: title || 'Moment', synopsis: text(m.synopsis), text: details, act, order, storybeats: [...new Set(linked)] });
  }
  const drivers: Driver[] = [];
  const dynamics: Storyform['dynamics'] = [];
  for (const d of sub.dynamics ?? []) {
    const index = ['initial', 'second', 'midpoint', 'fourth', 'concluding'].indexOf(text(d.dynamic).replace(/_story_driver$/, ''));
    if (index >= 0 && /_story_driver$/.test(text(d.dynamic))) {
      if (text(d.summary) || text(d.storytelling)) drivers.push({ id: d.id, index, summary: text(d.summary), storytelling: text(d.storytelling) });
    } else dynamics.push({ name: words(d.dynamic), value: words(d.vector), summary: [d.summary, d.storytelling].map(text).filter(Boolean).join('\n\n') });
  }
  const players: Player[] = (sub.players ?? []).map((x: any) => ({
    name: text(x.name),
    role: text(x.role),
    text: [
      text(x.summary),
      text(x.bio),
      x.visual && `Vzhled: ${text(x.visual)}`,
      x.audio && `Hlas: ${text(x.audio)}`,
      text(x.storytelling),
      ...(x.motivations ?? []).map((m: any) => `${text(m.narrative_function)}: ${[m.illustration, m.storytelling].map(text).filter(Boolean).join(' — ')}`),
    ]
      .filter(Boolean)
      .join('\n\n'),
  }));
  // Storypointy nejsou vázané na čas: patří do panelu Storyform.
  const points: Storyform['points'] = [];
  for (const x of sub.storypoints ?? []) {
    const where = text(x.throughline);
    const point = {
      throughline: TL_ALIASES[where.toLowerCase()] ?? ('' as const),
      name: text(x.appreciation).replace(new RegExp(`^${where}\\s+`), ''),
      fn: text(x.narrative_function),
      summary: text(x.summary),
      text: text(x.storytelling),
    };
    // Story Goal a spol. bývají uloženy dvakrát, jednou bez throughline: stačí jednou.
    if (point.name && !points.some((y) => y.name === point.name && y.fn === point.fn && y.summary === point.summary && y.text === point.text)) points.push(point);
  }
  const notes = Object.values<any>(form.narrative?.storytelling?.overviews ?? {})
    .map((o) => ({ folder: 'Dramatica', title: text(o.label || o.name), text: [o.summary, o.storytelling].map(text).filter(Boolean).join('\n\n') }))
    .filter((o) => o.title && o.text);
  const formId = text(form.id) || text(form.narrative?.id).replace(/^narrative_/, '') || undefined;
  return { title: text(data.story?.title) || undefined, storybeats: unique(beats), moments: splitActs(moments, unique(beats)), drivers, players, notes, storyform: { points, dynamics }, storyformId: formId };
}

/**
 * Dramatica někdy uloží dvě řady Momentů pod stejné číslo dějství (každá čísluje pořadí od nuly). Řady se rozdělí
 * na samostatná dějství a seřadí podle Signpostů svých storybeatů, aby se scény dvou částí nepromíchaly.
 */
function splitActs(moments: Moment[], beats: Storybeat[]): Moment[] {
  const sp = new Map(beats.map((x) => [key(x), signpostOf(x)]));
  const parts: { act: number; chain: number; list: Moment[] }[] = [];
  for (const act of [...new Set(moments.map((m) => m.act))].sort((a, b) => a - b)) {
    const seen = new Map<number, number>();
    for (const m of moments.filter((x) => x.act === act).sort((a, b) => a.order - b.order)) {
      const chain = seen.get(m.order) ?? 0;
      seen.set(m.order, chain + 1);
      let part = parts.find((x) => x.act === act && x.chain === chain);
      if (!part) parts.push((part = { act, chain, list: [] }));
      part.list.push(m);
    }
  }
  const weight = (list: Moment[]) => {
    const all = list.flatMap((m) => m.storybeats.map((k) => sp.get(k) ?? 0)).filter(Boolean);
    return all.length ? all.reduce((a, b) => a + b, 0) / all.length : Infinity;
  };
  parts.sort((a, b) => a.act - b.act || (weight(a.list) === weight(b.list) ? a.chain - b.chain : weight(a.list) - weight(b.list)));
  return parts.flatMap((part, i) => part.list.map((m) => ({ ...m, act: i + 1 })));
}

// ---------- Stavba a doplnění projektu ----------

const key = (x: Pick<Storybeat, 'throughline' | 'scope' | 'sequence'>) => `${x.throughline}/${x.scope}/${x.sequence}`;
/** Signpost (1–4), do kterého storybeat patří. */
export const signpostOf = (x: Pick<Storybeat, 'scope' | 'sequence'>) => Math.min(4, Math.ceil(x.sequence / PER_SIGNPOST[x.scope]));
const tlIndex = (t: Throughline) => THROUGHLINES.findIndex((x) => x.key === t);
type Key = Pick<Storybeat, 'throughline' | 'scope' | 'sequence'>;
/** Nadřazený storybeat: Událost patří Progresi, Progrese Signpostu. */
const parentOf = (x: Key): Key | null =>
  x.scope === 'signpost' ? null : { throughline: x.throughline, scope: x.scope === 'event' ? 'progression' : 'signpost', sequence: Math.ceil(x.sequence / 4) };
const SCOPE_NAME: Record<StorybeatScope, string> = { signpost: 'Signpost', progression: 'Progression', event: 'Event' };
const SCOPE_RANK: Record<StorybeatScope, number> = { signpost: 0, progression: 1, event: 2 };

/** Pořadí vyprávění: po Signpostech; uvnitř podle pořadí z Dramatiky, jinak po krocích napříč throughlines. */
function narrativeOrder(a: Key & { plotOrder?: number | null }, b: Key & { plotOrder?: number | null }): number {
  const step = (x: Key) => ((x.sequence - 1) % PER_SIGNPOST[x.scope]) / PER_SIGNPOST[x.scope];
  return (
    signpostOf(a) - signpostOf(b) ||
    (a.plotOrder ?? Infinity) - (b.plotOrder ?? Infinity) ||
    step(a) - step(b) ||
    tlIndex(a.throughline) - tlIndex(b.throughline) ||
    SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]
  );
}

/** Štítek storybeatu na kartě a v nabídkách: „OS P1“, „MC E3“, „RS S2“. */
export const storybeatTag = (x: Key) => `${x.throughline} ${x.scope === 'signpost' ? 'S' : x.scope === 'progression' ? 'P' : 'E'}${x.sequence}`;
/** Kde storybeat ve své throughline začíná, v jednotkách Událostí (0–63): podle toho se řadí strom storybeatů. */
export const storybeatStart = (x: Key) => (x.sequence - 1) * (16 / PER_SIGNPOST[x.scope]);

/** Dějové linie na tabuli. Throughline je vlastnost storybeatu, ne řádek: do linií si scény rozdělí autor. */
export const STORY_LANES = [
  { name: 'A story', color: '#b45309' },
  { name: 'B story', color: '#0f766e' },
  { name: 'Minizápletky', color: '#6d28d9' },
];
const actTitle = (n: number) => `${n}. dějství`;

export interface MergeResult {
  added: number;
  updated: number;
  /** Storybeaty, které se mezitím změnily ve Fabule i v Dramatice; platí znění z Fabuly. */
  conflicts: number;
}

/** Scéna, která storybeat nese. */
export const sceneOf = (p: Project, storybeat: string): Beat | undefined => Object.values(p.beats).find((b) => b.storybeats?.includes(storybeat));

/** Storybeaty, které nejsou v žádné scéně. */
export function unassigned(p: Project): StoryBeat[] {
  const used = new Set(Object.values(p.beats).flatMap((b) => b.storybeats ?? []));
  return (p.storyform?.beats ?? []).filter((x) => !used.has(x.key));
}

/** Přiřadí storybeaty scéně. Storybeat je nejvýš v jedné scéně, takže z ostatních zmizí. */
export function assignStorybeats(p: Project, sceneId: ID, keys: string[]) {
  const scene = p.beats[sceneId];
  const known = new Set((p.storyform?.beats ?? []).map((x) => x.key));
  const mine = keys.filter((k) => known.has(k));
  if (!scene || !mine.length) return;
  for (const b of Object.values(p.beats)) if (b !== scene && b.storybeats?.some((k) => mine.includes(k))) b.storybeats = b.storybeats.filter((k) => !mine.includes(k));
  scene.storybeats = [...new Set([...(scene.storybeats ?? []), ...mine])];
}

/** Vyjme storybeat ze scény; vrátí se mezi nepřiřazené. */
export function unassignStorybeat(p: Project, storybeat: string) {
  for (const b of Object.values(p.beats)) if (b.storybeats?.includes(storybeat)) b.storybeats = b.storybeats.filter((k) => k !== storybeat);
}

/** Nová scéna ze storybeatů: název a synopsi převezme z prvního, zařadí se za `after` (jinak na konec). */
export function sceneFromStorybeats(p: Project, keys: string[], after: ID | null): ID | null {
  const first = p.storyform?.beats.find((x) => x.key === keys[0]);
  if (!first) return null;
  const laneId = (after && p.beats[after]?.laneId) || p.lanes[0].id;
  const b = newBeat(laneId, { title: (/^.*?[.!?](?=\s|$)/.exec(first.summary)?.[0] ?? first.summary).slice(0, 80) || first.fn, synopsis: first.summary });
  p.beats[b.id] = b;
  const at = after ? p.order.indexOf(after) : -1;
  p.order.splice(at < 0 ? p.order.length : at + 1, 0, b.id);
  assignStorybeats(p, b.id, keys);
  return b.id;
}

/**
 * Doplní projekt o podklady z Dramatiky.
 *
 * Storybeaty nejsou karty: žijí ve storyformu a scéna je nese jako štítky. Scénou je Moment (nebo scéna, kterou
 * autor založí sám) a Story Driver. Co v projektu už je, se nepřesouvá ani nepřejmenovává; text storybeatu se
 * vezme z Dramatiky jen tehdy, když ho autor ve Fabule mezitím neupravil.
 */
export function mergeDramatica(p: Project, input: Storybeat[] | Bundle): MergeResult {
  const bundle: Bundle = Array.isArray(input) ? { storybeats: input, moments: [], drivers: [], players: [], notes: [] } : input;
  const result: MergeResult = { added: 0, updated: 0, conflicts: 0 };
  for (const x of STORY_LANES) if (!p.lanes.some((y) => y.name === x.name) && !p.storyform) p.lanes.push({ id: uid(), ...x });
  if (!p.lanes.length) p.lanes.push({ id: uid(), ...STORY_LANES[0] });
  const lane = p.lanes[0].id;
  const sf: Storyform = (p.storyform ??= { points: [], dynamics: [], beats: [], acts: {}, signpostAct: [] });
  sf.acts ??= {};
  sf.id = bundle.storyformId ?? sf.id;
  if (bundle.storyform) Object.assign(sf, bundle.storyform);

  // ----- Storybeaty -----
  const known = new Map(sf.beats.map((x) => [x.key, x]));
  const fresh = new Set<string>();
  for (const sb of bundle.storybeats) {
    const old = known.get(key(sb));
    if (!old) {
      known.set(key(sb), { key: key(sb), uuid: sb.uuid, throughline: sb.throughline, scope: sb.scope, sequence: sb.sequence, fn: sb.fn, summary: sb.summary, storytelling: sb.storytelling, base: sb.storytelling });
      fresh.add(key(sb));
      result.added++;
      continue;
    }
    const edited = old.storytelling !== old.base;
    const moved = sb.storytelling !== old.base;
    if (edited && moved && sb.storytelling !== old.storytelling) result.conflicts++;
    else if (moved || old.summary !== sb.summary || old.fn !== sb.fn) result.updated++;
    // Znění z Dramatiky platí, dokud ho autor ve Fabule nepřepsal.
    if (!edited) old.storytelling = sb.storytelling;
    Object.assign(old, { uuid: sb.uuid ?? old.uuid, fn: sb.fn, summary: sb.summary, base: sb.storytelling });
  }
  sf.beats = [...known.values()].sort((a, b) => tlIndex(a.throughline) - tlIndex(b.throughline) || storybeatStart(a) - storybeatStart(b) || SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]);
  const byKey = new Map(sf.beats.map((x) => [x.key, x]));

  // ----- Dějství -----
  const bySource = new Map<string, Beat>();
  for (const b of Object.values(p.beats)) if (b.source) bySource.set(b.source.id, b);
  const moments = bundle.moments.map((m, i) => ({ m, i })).sort((a, b) => a.m.act - b.m.act || a.m.order - b.m.order || a.i - b.i);
  // Bez Momentů se příběh dělí na čtyři části podle Signpostů.
  const actNumbers = moments.length ? [...new Set(moments.map((x) => x.m.act))].sort((a, b) => a - b) : Object.keys(sf.acts).length ? [] : [1, 2, 3, 4];
  /** Předěl dějství; chybějící (i smazaný) se založí znovu na správném místě. */
  const actBreak = (n: number): ID => {
    let id = sf.acts[n];
    if (!id || !p.breaks[id] || !p.order.includes(id)) {
      id = uid();
      p.breaks[id] = { id, title: actTitle(n) };
      const later = Object.entries(sf.acts)
        .filter(([k, v]) => +k > n && p.order.includes(v))
        .map(([, v]) => p.order.indexOf(v));
      p.order.splice(later.length ? Math.min(...later) : p.order.length, 0, id);
      sf.acts[n] = id;
    }
    return id;
  };
  /** Konec oddílu, který začíná daným předělem. */
  const endOf = (breakId: ID) => {
    const from = p.order.indexOf(breakId);
    const next = p.order.findIndex((x, i) => i > from && p.breaks[x]);
    return next < 0 ? p.order.length : next;
  };
  for (const n of actNumbers) actBreak(n);

  // ----- Momenty: scény v pořadí; storybeaty Momentu jsou jejich štítky -----
  const used = new Set(Object.values(p.beats).flatMap((b) => b.storybeats ?? []));
  for (const { m } of moments) {
    let scene = bySource.get(m.id);
    if (scene) {
      if (m.synopsis && !scene.synopsis) scene.synopsis = m.synopsis;
      scene.source = { id: m.id, kind: 'moment', text: scene.source!.text || m.text };
    } else {
      scene = newBeat(lane, { title: m.title, synopsis: m.synopsis, source: { id: m.id, kind: 'moment', text: m.text } });
      p.beats[scene.id] = scene;
      p.order.splice(endOf(actBreak(m.act)), 0, scene.id);
      bySource.set(m.id, scene);
      result.added++;
    }
    // Složení z Dramatiky se použije jen pro storybeaty, které autor ve Fabule ještě nikam nezařadil.
    const mine = m.storybeats.filter((k) => byKey.has(k) && !used.has(k));
    if (mine.length) scene.storybeats = [...(scene.storybeats ?? []), ...mine];
    mine.forEach((k) => used.add(k));
  }

  // ----- Které dějství patří kterému Signpostu: podle toho, kde storybeaty Signpostu skutečně leží -----
  const acts = Object.keys(sf.acts).map(Number).sort((a, b) => a - b);
  const actAt = (id: ID) => {
    const at = p.order.indexOf(id);
    return [...acts].reverse().find((n) => p.order.indexOf(sf.acts[n]) < at) ?? acts[0];
  };
  const seen: number[][] = [[], [], [], []];
  for (const id of p.order) for (const k of p.beats[id]?.storybeats ?? []) if (byKey.has(k)) seen[signpostOf(byKey.get(k)!) - 1].push(actAt(id));
  const n = acts.length;
  const fallback = (sp: number) => acts[n >= 4 ? Math.min(n, sp) - 1 : n === 3 ? [0, 1, 1, 2][sp - 1] : n === 2 ? (sp <= 2 ? 0 : 1) : 0];
  const mode = (list: number[]) => [...new Set(list)].sort((a, b) => list.filter((x) => x === b).length - list.filter((x) => x === a).length || a - b)[0];
  sf.signpostAct = [1, 2, 3, 4].map((sp) => (seen[sp - 1].length ? mode(seen[sp - 1]) : fallback(sp)));
  // Signposty jdou po sobě, takže ani jejich dějství se nesmí vracet.
  for (let i = 1; i < 4; i++) sf.signpostAct[i] = Math.max(sf.signpostAct[i], sf.signpostAct[i - 1]);

  // ----- Jen storybeaty (CSV bez Momentů): scénou je nejpodrobnější úroveň, aby tabule nezůstala prázdná.
  // Scéna vznikne jen pro storybeat, který právě přibyl: co autor ze scény vyjmul, se samo nevrací. -----
  if (!bundle.moments.length && ![...bySource.values()].some((b) => b.source!.kind === 'moment')) {
    const children = new Map<string, number>();
    for (const x of sf.beats) {
      const up = parentOf(x);
      if (up) children.set(key(up), (children.get(key(up)) ?? 0) + 1);
    }
    const leaves = sf.beats.filter((x) => fresh.has(x.key) && !used.has(x.key) && !(children.get(x.key) ?? 0)).sort(narrativeOrder);
    for (const sb of leaves) {
      const scene = newBeat(lane, { title: sb.fn || storybeatTag(sb), synopsis: sb.summary, storybeats: [sb.key] });
      p.beats[scene.id] = scene;
      p.order.splice(endOf(actBreak(sf.signpostAct[signpostOf(sb) - 1])), 0, scene.id);
      used.add(sb.key);
      result.added++;
    }
  }

  // ----- Story Drivery: scény na zlomech mezi Signposty -----
  /** Místo, kde končí Signpost `sp`: konec jeho dějství, nebo polovina, když dějství pokračuje dalším Signpostem. */
  const turnAfter = (sp: number) => {
    const id = sf.acts[sf.signpostAct[sp - 1]];
    const from = p.order.indexOf(id) + 1;
    if (sp < 4 && sf.signpostAct[sp] === sf.signpostAct[sp - 1]) return from + Math.ceil((endOf(id) - from) / 2);
    return endOf(id);
  };
  for (const d of bundle.drivers) {
    const old = bySource.get(d.id);
    if (old) {
      if (d.summary && !old.synopsis) old.synopsis = d.summary;
      old.source = { id: d.id, kind: 'driver', text: old.source!.text || d.storytelling };
      continue;
    }
    const b = newBeat(lane, { title: DRIVERS[d.index], synopsis: d.summary, source: { id: d.id, kind: 'driver', text: d.storytelling } });
    p.beats[b.id] = b;
    // Initial otevírá první Signpost; každý další Driver uzavírá ten svůj.
    const at = !acts.length ? p.order.length : d.index === 0 ? p.order.indexOf(sf.acts[sf.signpostAct[0]]) + 1 : turnAfter(d.index);
    p.order.splice(at, 0, b.id);
    bySource.set(d.id, b);
    result.added++;
  }

  // ----- Postavy a podklady -----
  for (const pl of bundle.players) {
    if (!pl.name || p.characters.some((c) => c.name.toLowerCase() === pl.name.toLowerCase())) continue;
    const role: CharRole = /protagon|antagon|\bMC\b|\bIC\b/i.test(pl.role) ? 'main' : pl.role ? 'secondary' : 'small';
    const first = pl.name.split(/\s+/)[0];
    p.characters.push({ id: uid(), name: pl.name, color: PALETTE[p.characters.length % PALETTE.length], aliases: first !== pl.name && !/^(mudr|judr|ing|dr|mgr)\.?$/i.test(first) ? first : '', role });
  }
  const note = (folder: string, title: string, body: string) => {
    const item = p.research.find((x) => x.folder === folder && x.title === title);
    if (item) item.text = body;
    else p.research.push({ id: uid(), title, text: body, folder, url: '', beatIds: [] });
  };
  for (const pl of bundle.players) if (pl.name && (pl.role || pl.text)) note('Postavy', pl.name, [pl.role, pl.text].filter(Boolean).join('\n\n'));
  for (const x of bundle.notes) note(x.folder, x.title, x.text);
  return result;
}

/** Nový projekt z podkladů Dramatiky. */
export function importDramatica(all: Storybeat[] | Bundle, title: string): Project {
  const p: Project = {
    format: 2,
    id: uid(),
    title,
    lanes: [],
    characters: [],
    tags: [],
    groups: [],
    beats: {},
    breaks: {},
    order: [],
    links: [],
    notes: [],
    research: [],
    titlePage: { author: '', basedOn: '', draft: '', contact: '' },
    revisions: [],
    targetPages: 110,
    paper: 'a4',
  };
  mergeDramatica(p, all);
  return p;
}

/**
 * Pořadí uvnitř throughline je jediné, které Dramatica předepisuje. Vrátí dvojice scén, kde pozdější storybeat
 * téže throughline a úrovně stojí ve vyprávění dřív než ten, který mu předchází.
 */
export function orderBreaks(p: Project): { first: ID; second: ID; earlier: StoryBeat; later: StoryBeat }[] {
  const byKey = new Map((p.storyform?.beats ?? []).map((x) => [x.key, x]));
  const last = new Map<string, { id: ID; sb: StoryBeat }>();
  const out: ReturnType<typeof orderBreaks> = [];
  for (const id of p.order) {
    const b = p.beats[id];
    if (!b || b.off) continue;
    for (const sb of (b.storybeats ?? []).map((k) => byKey.get(k)).filter((x): x is StoryBeat => !!x)) {
      const track = `${sb.throughline}/${sb.scope}`;
      const prev = last.get(track);
      if (prev && prev.sb.sequence > sb.sequence && prev.id !== id) out.push({ first: prev.id, second: id, earlier: sb, later: prev.sb });
      if (!prev || sb.sequence >= prev.sb.sequence) last.set(track, { id, sb });
    }
  }
  return out;
}

/** Throughlines, které scéna nese. */
export const throughlinesOf = (p: Project, b: Beat): Throughline[] => [...new Set((b.storybeats ?? []).map((k) => k.split('/')[0] as Throughline))];

/** Momenty a Story Drivery v pořadí vyprávění; u Momentu i jeho storybeaty. Podklad pro zápis zpět. */
export function exportSources(p: Project) {
  const uuid = new Map((p.storyform?.beats ?? []).map((x) => [x.key, x.uuid ?? x.key]));
  return p.order
    .map((id, i) => ({ b: p.beats[id], i }))
    .filter((x) => x.b?.source)
    .map(({ b, i }) => ({ id: b.source!.id, kind: b.source!.kind, order: i + 1, title: b.title, synopsis: b.synopsis, text: b.source!.text, storybeats: (b.storybeats ?? []).map((k) => uuid.get(k) ?? k) }));
}

/**
 * Storybeaty jako podklad pro zápis zpět do Dramatiky. `changed` říká, že autor Storytelling ve Fabule upravil;
 * pořadí mají jen storybeaty zařazené do scény.
 */
export function exportDramatica(p: Project) {
  const at = new Map<string, number>();
  let n = 0;
  for (const id of p.order) for (const k of p.beats[id]?.storybeats ?? []) at.set(k, ++n);
  return (p.storyform?.beats ?? []).map((x) => ({
    storyform: p.storyform?.id,
    uuid: x.uuid,
    throughline: x.throughline,
    scope: x.scope,
    sequence: x.sequence,
    fn: x.fn,
    summary: x.summary,
    storytelling: x.storytelling,
    changed: x.storytelling !== x.base,
    plotOrder: at.get(x.key) ?? null,
    scene: sceneOf(p, x.key)?.title ?? null,
  }));
}
