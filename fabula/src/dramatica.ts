import type { Beat, CharRole, DramaticaRef, ID, Project, Storyform, StorybeatScope, Throughline } from './model';
import { PALETTE, newBeat, uid } from './model';

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

/** Moment: scéna, jak ji autor v Dramatice rozvrhl. */
export interface Moment {
  id: string;
  title: string;
  synopsis: string;
  /** Místo, čas a pokyny ke scéně. */
  text: string;
  act: number;
  order: number;
  /** Storybeat, který Moment vypráví (klíč „OS/event/3“), pokud je napojený. */
  storybeat: string | null;
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
}
const DRIVERS = ['Initial Story Driver', 'Second Story Driver', 'Midpoint Story Driver', 'Fourth Story Driver', 'Concluding Story Driver'];
const SCENES = 'Scény';

export const THROUGHLINES: { key: Throughline; name: string; color: string }[] = [
  { key: 'OS', name: 'Objective Story', color: '#b45309' },
  { key: 'MC', name: 'Main Character', color: '#1d4ed8' },
  { key: 'IC', name: 'Influence Character', color: '#be185d' },
  { key: 'RS', name: 'Relationship Story', color: '#0f766e' },
];
const TL_ALIASES: Record<string, Throughline> = {
  os: 'OS', objective: 'OS', 'objective story': 'OS', overall: 'OS', 'overall story': 'OS',
  mc: 'MC', main: 'MC', 'main character': 'MC',
  ic: 'IC', oc: 'IC', influence: 'IC', 'influence character': 'IC', obstacle: 'IC', 'obstacle character': 'IC', impact: 'IC', 'impact character': 'IC',
  rs: 'RS', ss: 'RS', relationship: 'RS', 'relationship story': 'RS', subjective: 'RS', 'subjective story': 'RS',
};
const PER_SIGNPOST: Record<StorybeatScope, number> = { signpost: 1, progression: 4, event: 16 };
const MOMENTS = 'Momenty';

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

/** Tentýž storybeat uložený vícekrát (starší verze Signpostů) se sloučí: rozdílné texty zůstanou oba. */
function unique(all: Storybeat[]): Storybeat[] {
  const out = new Map<string, Storybeat>();
  for (const sb of all) {
    const old = out.get(key(sb));
    if (!old) out.set(key(sb), { ...sb });
    else {
      const join = (a: string, b: string, sep: string) => (!a || a === b ? b || a : !b ? a : `${a}${sep}${b}`);
      old.summary = old.summary || sb.summary;
      old.storytelling = join(old.storytelling, sb.storytelling, '\n\n———\n\n');
      old.fn = old.fn || sb.fn;
      old.uuid = old.uuid ?? sb.uuid;
      old.plotOrder = old.plotOrder ?? sb.plotOrder;
      old.moments = [...new Set([...old.moments, ...sb.moments])];
    }
  }
  return [...out.values()];
}

// ---------- Čtení výpisu konektoru ----------

/** Storybeaty z JSON, který vrací konektor Dramatiky (hledají se kdekoli ve struktuře). */
export function storybeatsFromJson(data: unknown): Storybeat[] {
  const out = new Map<string, Storybeat>();
  const walk = (x: any) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (x.kind === 'Storybeat' || (x.scope && x.sequence && x.throughline)) {
      const sb = make({
        uuid: x.uuid,
        throughline: x.throughline,
        scope: x.scope,
        sequence: x.sequence,
        fn: x.narrative_function?.name ?? x.narrative_function ?? x.fn,
        summary: x.summary,
        storytelling: x.storytelling,
        plotOrder: x.plot_order ?? x.plotOrder,
        appreciation: x.appreciation?.name ?? x.appreciation,
        moments: (x.moments ?? []).map((m: any) => m?.title ?? m).join('|'),
      });
      if (sb) out.set(key(sb), sb);
      return;
    }
    Object.values(x).forEach(walk);
  };
  walk(data);
  return unique([...out.values()]);
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
  // Scénou je jen Moment, ke kterému autor něco napsal; předpřipravené prázdné Momenty se vynechají.
  const moments: Moment[] = [];
  const seen = new Set<string>();
  for (const m of project.stories?.flatMap((st: any) => st.moments ?? []) ?? []) {
    const details = [m.setting && `Místo: ${text(m.setting)}`, m.timing && `Čas: ${text(m.timing)}`, text(m.imperatives)].filter(Boolean).join('\n');
    if (!(text(m.synopsis) || details) || seen.has(m.id)) continue;
    seen.add(m.id);
    const linked = (m.storybeats ?? []).map((l: any) => idKey.get(l.storybeat_id)).find(Boolean) ?? null;
    moments.push({ id: m.id, title: text(m.summary) || 'Scéna', synopsis: text(m.synopsis), text: details, act: num(m.act) ?? 1, order: num(m.order) ?? 0, storybeat: linked });
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
    if (point.name && !points.some((y) => JSON.stringify(y) === JSON.stringify(point))) points.push(point);
  }
  const notes = Object.values<any>(form.narrative?.storytelling?.overviews ?? {})
    .map((o) => ({ folder: 'Dramatica', title: text(o.label || o.name), text: [o.summary, o.storytelling].map(text).filter(Boolean).join('\n\n') }))
    .filter((o) => o.title && o.text);
  return { title: text(data.story?.title) || undefined, storybeats: unique(beats), moments, drivers, players, notes, storyform: { points, dynamics } };
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

function ref(sb: Storybeat): DramaticaRef {
  return { uuid: sb.uuid, throughline: sb.throughline, scope: sb.scope, sequence: sb.sequence, fn: sb.fn, storytelling: sb.storytelling };
}
const titleOf = (sb: Storybeat) => sb.fn || `${SCOPE_NAME[sb.scope]} ${sb.sequence}`;
/** Název skupiny: „OS 1 · Understanding“ pro Signpost, „OS P13 · Prerequisites“ pro Progresi. */
const groupTitle = (k: Key, fn?: string) => `${k.throughline} ${k.scope === 'progression' ? 'P' : k.scope === 'event' ? 'E' : ''}${k.sequence}${fn ? ` · ${fn}` : ''}`;

export interface MergeResult {
  added: number;
  updated: number;
}

/**
 * Doplní projekt o storybeaty. Beat, který už k storybeatu patří, dostane jen nové znění synopse a Storytellingu
 * (text scénáře, název upravený autorem a pořadí zůstávají); chybějící se přidají na své místo.
 *
 * Kartou je nejpodrobnější úroveň, která v Dramatice existuje: Událost, jinak Progrese, jinak Signpost.
 * Nadřazený storybeat je skupina (Signpost blok, Progrese skupina v něm). Kartou zůstává i tehdy, když má text
 * a pod sebou zatím jen část svých čtyř kroků; jinak se jeho text uloží do rešerše.
 */
export function mergeDramatica(p: Project, input: Storybeat[] | Bundle): MergeResult {
  const bundle: Bundle = Array.isArray(input) ? { storybeats: input, moments: [], drivers: [], players: [], notes: [] } : input;
  const all = bundle.storybeats;
  const result = { added: 0, updated: 0 };
  const lane = new Map<Throughline, ID>();
  for (const t of THROUGHLINES) {
    let l = p.lanes.find((x) => x.name === t.name);
    if (!l) p.lanes.push((l = { id: uid(), name: t.name, color: t.color }));
    lane.set(t.key, l.id);
  }
  const existing = new Map<string, Beat>();
  for (const b of Object.values(p.beats)) if (b.dramatica) existing.set(key(b.dramatica), b);

  const byKey = new Map(all.map((x) => [key(x), x]));
  const children = new Map<string, number>();
  for (const x of all) {
    const up = parentOf(x);
    if (up) children.set(key(up), (children.get(key(up)) ?? 0) + 1);
  }
  // Momenty napojené na storybeat: jediný splyne s jeho kartou, víc jich storybeat rozdělí na scény.
  const scenes = new Map<string, Moment[]>();
  for (const m of bundle.moments) if (m.storybeat && byKey.has(m.storybeat)) scenes.set(m.storybeat, [...(scenes.get(m.storybeat) ?? []), m]);
  const isCard = (x: Storybeat) => {
    const n = children.get(key(x)) ?? 0;
    if ((scenes.get(key(x))?.length ?? 0) > 1) return false;
    return n === 0 || (n < 4 && !!(x.summary || x.storytelling));
  };
  const sorted = [...all].sort(narrativeOrder);
  const rank = new Map(sorted.map((x, i) => [key(x), i]));

  /** Skupina pro storybeat `k`, do které patří jeho podřízené karty. */
  const group = (k: Key): ID => {
    const fn = byKey.get(key(k))?.fn;
    const title = groupTitle(k, fn);
    const bare = groupTitle(k);
    let g = p.groups.find((x) => x.title === title || x.title === bare || x.title.startsWith(`${bare} ·`));
    if (!g) {
      const up = parentOf(k);
      p.groups.push((g = { id: uid(), title, color: THROUGHLINES[tlIndex(k.throughline)].color, collapsed: false, parentId: up ? group(up) : null }));
    } else if (fn) g.title = title;
    return g.id;
  };
  const groupOf = (sb: Storybeat): ID => {
    const up = parentOf(sb);
    // Signpost bez podřízených je kartou ve vlastním bloku, aby blok existoval i pro pozdější Progrese.
    return group(up ?? sb);
  };
  const breakOf = (sp: number): ID => {
    const title = `Signpost ${sp}`;
    let id = Object.values(p.breaks).find((x) => x.title === title)?.id;
    if (!id) {
      id = uid();
      p.breaks[id] = { id, title };
      // Před první beat pozdějšího Signpostu, jinak na konec.
      const later = p.order.findIndex((x) => (p.beats[x]?.dramatica ? signpostOf(p.beats[x].dramatica!) : signpostNo(p.breaks[x]?.title)) > sp);
      p.order.splice(later < 0 ? p.order.length : later, 0, id);
    }
    return id;
  };
  const momentTag = (name: string): ID => {
    let t = p.tags.find((x) => x.category === MOMENTS && x.name === name);
    if (!t) p.tags.push((t = { id: uid(), name, color: '#6d28d9', mode: 'none', category: MOMENTS }));
    return t.id;
  };

  const signpostNo = (title?: string) => +(/^Signpost (\d)$/.exec(title ?? '')?.[1] ?? 0);
  const full = bundle.moments.length > 0 || bundle.drivers.length > 0;
  for (let sp = 1; sp <= 4; sp++) if (full || sorted.some((x) => signpostOf(x) === sp && isCard(x))) breakOf(sp);
  for (const sb of sorted) {
    const tags = sb.moments.map(momentTag);
    const old = existing.get(key(sb));
    if (old) {
      const changed = (!!sb.summary && !old.source && old.synopsis !== sb.summary) || old.dramatica!.storytelling !== sb.storytelling || old.dramatica!.fn !== sb.fn;
      // Karta, která je zároveň scénou z Momentu, si drží synopsi scény.
      if (sb.summary && !old.source) old.synopsis = sb.summary;
      if (!old.title.trim() || old.title === old.dramatica!.fn) old.title = titleOf(sb);
      old.dramatica = { ...ref(sb), storytelling: sb.storytelling || old.dramatica!.storytelling };
      for (const t of tags) if (!old.tagIds.includes(t)) old.tagIds.push(t);
      if (changed) result.updated++;
      continue;
    }
    if (!isCard(sb)) continue;
    const b = newBeat(lane.get(sb.throughline)!, { title: titleOf(sb), synopsis: sb.summary, groupId: groupOf(sb), tagIds: tags, dramatica: ref(sb) });
    p.beats[b.id] = b;
    // Za poslední beat téhož Signpostu, který ve vyprávění předchází; jinak hned za předěl.
    let at = p.order.indexOf(breakOf(signpostOf(sb))) + 1;
    p.order.forEach((id, i) => {
      const d = p.beats[id]?.dramatica;
      if (d && signpostOf(d) === signpostOf(sb) && (rank.get(key(d)) ?? Infinity) < rank.get(key(sb))!) at = i + 1;
    });
    p.order.splice(at, 0, b.id);
    existing.set(key(sb), b);
    result.added++;
  }

  // ----- Momenty: scény v pořadí, jak jdou za sebou -----
  const bySource = new Map<string, Beat>();
  for (const b of Object.values(p.beats)) if (b.source) bySource.set(b.source.id, b);
  /** Signpost, ve kterém leží místo `i` v pořadí vyprávění. */
  const spAt = (i: number) => {
    for (let k = Math.min(i, p.order.length - 1); k >= 0; k--) if (signpostNo(p.breaks[p.order[k]]?.title)) return signpostNo(p.breaks[p.order[k]].title);
    return 1;
  };
  const acts = Math.max(0, ...bundle.moments.map((m) => m.act));
  const actSignpost = (act: number) => (acts >= 4 ? Math.min(4, Math.max(1, act)) : act <= 1 ? 1 : act === 2 ? 2 : 4);
  let prev: Beat | null = null;
  for (const m of [...bundle.moments].sort((a, b) => a.act - b.act || a.order - b.order)) {
    const sb = m.storybeat ? byKey.get(m.storybeat) : undefined;
    const source = { id: m.id, kind: 'moment' as const, text: m.text };
    let b = bySource.get(m.id);
    if (b) {
      if (m.synopsis) b.synopsis = m.synopsis;
      b.source = { ...source, text: m.text || b.source!.text };
    } else if (sb && isCard(sb) && existing.get(key(sb)) && !existing.get(key(sb))!.source) {
      // Jediný Moment storybeatu: karta storybeatu se stane touto scénou.
      b = existing.get(key(sb))!;
      if (b.title === titleOf(sb)) b.title = m.title;
      if (m.synopsis) b.synopsis = m.synopsis;
      b.source = source;
    } else {
      let laneId = sb ? lane.get(sb.throughline)! : p.lanes.find((x) => x.name === SCENES)?.id;
      if (!laneId) {
        laneId = uid();
        p.lanes.push({ id: laneId, name: SCENES, color: '#475569' });
      }
      b = newBeat(laneId, { title: m.title, synopsis: m.synopsis, groupId: sb ? group(sb) : null, source, storybeat: sb ? key(sb) : undefined });
      p.beats[b.id] = b;
      const target = sb ? signpostOf(sb) : actSignpost(m.act);
      const prevAt = prev ? p.order.indexOf(prev.id) : -1;
      let at: number;
      if (prevAt >= 0 && spAt(prevAt) >= target) at = prevAt + 1;
      else if (sb) {
        at = p.order.indexOf(breakOf(target)) + 1;
        p.order.forEach((id, i) => {
          const d = p.beats[id]?.dramatica;
          if (d && signpostOf(d) === target && (rank.get(key(d)) ?? Infinity) < rank.get(key(sb))!) at = i + 1;
        });
      } else at = p.order.indexOf(breakOf(target)) + 1;
      p.order.splice(at, 0, b.id);
      result.added++;
    }
    bySource.set(m.id, b);
    prev = b;
  }

  // ----- Story Drivery: karty v Objective Story na hranicích Signpostů -----
  for (const d of bundle.drivers) {
    const old = bySource.get(d.id);
    if (old) {
      if (d.summary) old.synopsis = d.summary;
      old.source = { id: d.id, kind: 'driver', text: d.storytelling || old.source!.text };
      continue;
    }
    const b = newBeat(lane.get('OS')!, { title: DRIVERS[d.index], synopsis: d.summary, source: { id: d.id, kind: 'driver', text: d.storytelling } });
    p.beats[b.id] = b;
    // Initial hned za prvním předělem, Concluding na konci, ostatní těsně před předělem dalšího Signpostu.
    const at = d.index === 0 ? p.order.indexOf(breakOf(1)) + 1 : d.index === 4 ? p.order.length : p.order.indexOf(breakOf(d.index + 1));
    p.order.splice(at, 0, b.id);
    result.added++;
  }

  // ----- Postavy -----
  for (const pl of bundle.players) {
    if (!pl.name || p.characters.some((c) => c.name.toLowerCase() === pl.name.toLowerCase())) continue;
    const role: CharRole = /protagon|antagon|\bMC\b|\bIC\b/i.test(pl.role) ? 'main' : pl.role ? 'secondary' : 'small';
    const first = pl.name.split(/\s+/)[0];
    p.characters.push({ id: uid(), name: pl.name, color: PALETTE[p.characters.length % PALETTE.length], aliases: first !== pl.name && !/^(mudr|judr|ing|dr|mgr)\.?$/i.test(first) ? first : '', role });
  }
  const note = (folder: string, title: string, body: string, beatIds: ID[] = []) => {
    const item = p.research.find((x) => x.folder === folder && x.title === title);
    if (item) Object.assign(item, { text: body, beatIds });
    else p.research.push({ id: uid(), title, text: body, folder, url: '', beatIds });
  };
  for (const pl of bundle.players) if (pl.name && (pl.role || pl.text)) note('Postavy', pl.name, [pl.role, pl.text].filter(Boolean).join('\n\n'));
  for (const n of bundle.notes) note(n.folder, n.title, n.text);

  // ----- Storyform: storypointy, dynamika a seznam storybeatů pro přiřazování scén -----
  const known = new Map((p.storyform?.beats ?? []).map((x) => [x.key, x]));
  for (const x of all) known.set(key(x), { key: key(x), uuid: x.uuid, throughline: x.throughline, scope: x.scope, sequence: x.sequence, fn: x.fn, summary: x.summary });
  p.storyform = {
    points: bundle.storyform?.points ?? p.storyform?.points ?? [],
    dynamics: bundle.storyform?.dynamics ?? p.storyform?.dynamics ?? [],
    beats: [...known.values()].sort((a, b) => tlIndex(a.throughline) - tlIndex(b.throughline) || narrativeOrder(a, b)),
  };
  // Dřívější verze ukládaly storypointy do rešerše; teď mají vlastní panel.
  if (bundle.storyform) p.research = p.research.filter((x) => !(x.folder === 'Dramatica' && /^(Storypointy · |Dynamika příběhu$)/.test(x.title)));

  // Text nadřazených storybeatů, které nejsou kartou, patří do rešerše u svých beatů.
  for (const sb of all) {
    if (existing.has(key(sb)) || !(sb.summary || sb.storytelling)) continue;
    const title = `${THROUGHLINES[tlIndex(sb.throughline)].name} · ${SCOPE_NAME[sb.scope]} ${sb.sequence}${sb.fn ? ` · ${sb.fn}` : ''}`;
    const body = [sb.summary, sb.storytelling].filter(Boolean).join('\n\n');
    const under = (d: Key): boolean => {
      const up = parentOf(d);
      return !!up && (key(up) === key(sb) || under(up));
    };
    const beatIds = p.order.filter((id) => !!p.beats[id]?.dramatica && under(p.beats[id].dramatica!));
    const item = p.research.find((x) => x.folder === 'Dramatica' && x.title === title);
    if (item) Object.assign(item, { text: body, beatIds });
    else p.research.push({ id: uid(), title, text: body, folder: 'Dramatica', url: '', beatIds });
  }
  return result;
}

/** Nový projekt ze storybeatů: čtyři linie throughlines a nic dalšího. */
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

/** Scény a Story Drivery z Dramatiky v pořadí vyprávění: podklad pro zápis zpět. */
export function exportSources(p: Project) {
  return p.order
    .map((id, i) => ({ b: p.beats[id], i }))
    .filter((x) => x.b?.source)
    .map(({ b, i }) => ({ id: b.source!.id, kind: b.source!.kind, order: i + 1, title: b.title, synopsis: b.synopsis, text: b.source!.text, storybeat: b.dramatica?.uuid ?? p.storyform?.beats.find((x) => x.key === b.storybeat)?.uuid }));
}

/** Popisek storybeatu do nabídek: „P1 · Instinct“. */
export const storybeatLabel = (x: { scope: StorybeatScope; sequence: number; fn: string }) =>
  `${x.scope === 'signpost' ? 'Signpost ' : x.scope === 'progression' ? 'P' : 'E'}${x.sequence}${x.fn ? ` · ${x.fn}` : ''}`;

/** Throughline, ke které beat patří: podle storybeatu, přiřazené scény, jinak podle linie. */
export function throughlineOf(p: Project, b: Beat): Throughline | null {
  const direct = b.dramatica?.throughline ?? (b.storybeat?.split('/')[0] as Throughline | undefined);
  if (direct) return direct;
  const lane = p.lanes.find((l) => l.id === b.laneId)?.name;
  return THROUGHLINES.find((t) => t.name === lane)?.key ?? null;
}

/**
 * Přiřadí scénu ke storybeatu, který vypráví: scéna se přesune do linie jeho throughline a do skupiny,
 * kam patří jeho karta. Prázdný klíč přiřazení zruší (scéna zůstane, kde je).
 */
export function linkScene(p: Project, beatId: ID, storybeat: string | null) {
  const b = p.beats[beatId];
  const target = p.storyform?.beats.find((x) => x.key === storybeat);
  if (!b) return;
  if (!target) return void delete b.storybeat;
  b.storybeat = target.key;
  const lane = p.lanes.find((l) => l.name === THROUGHLINES[tlIndex(target.throughline)].name);
  if (lane) b.laneId = lane.id;
  const own = groupTitle(target);
  const card = Object.values(p.beats).find((x) => x.dramatica && key(x.dramatica) === target.key);
  const group = p.groups.find((g) => g.title === own || g.title.startsWith(`${own} ·`))?.id ?? card?.groupId;
  if (group) b.groupId = group;
}

/** Beaty, které mají protějšek v Dramatice, jako storybeaty: podklad pro zápis zpět. */
export function exportDramatica(p: Project): Storybeat[] {
  return p.order
    .map((id) => p.beats[id])
    .filter((b) => b?.dramatica)
    .map((b, i) => ({
      uuid: b.dramatica!.uuid,
      throughline: b.dramatica!.throughline,
      scope: b.dramatica!.scope,
      sequence: b.dramatica!.sequence,
      fn: b.dramatica!.fn,
      summary: b.synopsis,
      storytelling: b.dramatica!.storytelling,
      plotOrder: i + 1,
      moments: b.tagIds.map((t) => p.tags.find((x) => x.id === t)).filter((t) => t?.category === MOMENTS).map((t) => t!.name),
    }));
}
