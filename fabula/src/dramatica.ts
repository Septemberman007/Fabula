import type { Beat, CharRole, DramaticaRef, ID, Project, Storyform, StorybeatScope, Throughline } from './model';
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
/** Štítek storybeatu na kartě a v nabídkách: „OS P1“, „MC E3“, „RS S2“. */
export const storybeatTag = (x: Key) => `${x.throughline} ${x.scope === 'signpost' ? 'S' : x.scope === 'progression' ? 'P' : 'E'}${x.sequence}`;

/** Dějové linie na tabuli. Throughline je vlastnost karty, ne řádek. */
export const STORY_LANES = [
  { name: 'A story', color: '#b45309' },
  { name: 'B story', color: '#0f766e' },
  { name: 'Minizápletky', color: '#6d28d9' },
];
/** Kam storybeat po importu spadne: vnější děj a hlavní postava do A story, vztah a vlivová postava do B story. */
const laneIndex = (t: Throughline) => (t === 'OS' || t === 'MC' ? 0 : 1);
const actTitle = (n: number) => `${n}. dějství`;
const MOMENT_COLOR = '#64748b';

export interface MergeResult {
  added: number;
  updated: number;
}

/**
 * Doplní projekt o podklady z Dramatiky. Co už v projektu je, dostane jen nové znění textů
 * (scénář, názvy upravené autorem, pořadí a přiřazení zůstávají); chybějící se přidá.
 *
 * S Momenty: dějství jsou předěly, Moment je karta a k ní blok se storybeaty v pořadí. Storybeaty, které
 * v žádném Momentu nejsou, leží vyřazené tam, kam v čase patří, a dají se do Momentu přiřadit.
 * Bez Momentů (jen CSV se storybeaty): karty jdou po Signpostech v pořadí vyprávění.
 */
export function mergeDramatica(p: Project, input: Storybeat[] | Bundle): MergeResult {
  const bundle: Bundle = Array.isArray(input) ? { storybeats: input, moments: [], drivers: [], players: [], notes: [] } : input;
  const all = bundle.storybeats;
  const result = { added: 0, updated: 0 };
  const lanes = STORY_LANES.map((x) => {
    let l = p.lanes.find((y) => y.name === x.name);
    if (!l) p.lanes.push((l = { id: uid(), ...x }));
    return l.id;
  });
  const existing = new Map<string, Beat>();
  const bySource = new Map<string, Beat>();
  for (const b of Object.values(p.beats)) {
    if (b.dramatica) existing.set(key(b.dramatica), b);
    if (b.source) bySource.set(b.source.id, b);
  }
  const byKey = new Map(all.map((x) => [key(x), x]));
  const sorted = [...all].sort(narrativeOrder);
  const withMoments = bundle.moments.length > 0 || [...bySource.values()].some((b) => b.source!.kind === 'moment');

  /** Předěl daného názvu; nový se zařadí na konec. */
  const breakOf = (title: string): ID => {
    let id = Object.values(p.breaks).find((x) => x.title === title)?.id;
    if (!id) {
      id = uid();
      p.breaks[id] = { id, title };
      p.order.push(id);
    }
    return id;
  };
  /** Konec oddílu, který začíná daným předělem. */
  const endOf = (breakId: ID) => {
    const from = p.order.indexOf(breakId);
    const next = p.order.findIndex((x, i) => i > from && p.breaks[x]);
    return next < 0 ? p.order.length : next;
  };
  const card = (sb: Storybeat, patch: Partial<Beat>, at: number) => {
    const b = newBeat(lanes[laneIndex(sb.throughline)], { title: titleOf(sb), synopsis: sb.summary, dramatica: ref(sb), ...patch });
    p.beats[b.id] = b;
    p.order.splice(at, 0, b.id);
    existing.set(key(sb), b);
    result.added++;
    return b;
  };
  const refresh = (old: Beat, sb: Storybeat) => {
    const d = old.dramatica!;
    if ((!!sb.summary && old.synopsis !== sb.summary) || d.storytelling !== sb.storytelling || d.fn !== sb.fn) result.updated++;
    if (sb.summary) old.synopsis = sb.summary;
    if (!old.title.trim() || old.title === d.fn) old.title = titleOf(sb);
    old.dramatica = { ...ref(sb), storytelling: sb.storytelling || d.storytelling };
  };

  if (withMoments) {
    const moments = bundle.moments.map((m, i) => ({ m, i })).sort((a, b) => a.m.act - b.m.act || a.m.order - b.m.order || a.i - b.i);
    for (const act of [...new Set(moments.map((x) => x.m.act))].sort((a, b) => a - b)) breakOf(actTitle(act));
    const placed = new Set<string>();
    for (const { m } of moments) {
      const mine = m.storybeats.map((k) => byKey.get(k)).filter((x): x is Storybeat => !!x && !placed.has(key(x)));
      let head = bySource.get(m.id);
      if (head) {
        if (m.synopsis) head.synopsis = m.synopsis;
        head.source = { id: m.id, kind: 'moment', text: m.text || head.source!.text };
      } else {
        // Moment, jehož storybeaty patří jen vztahu a vlivové postavě, začíná v B story.
        const lane = mine.length && mine.every((x) => laneIndex(x.throughline) === 1) ? 1 : 0;
        head = newBeat(lanes[lane], { title: m.title, synopsis: m.synopsis, source: { id: m.id, kind: 'moment', text: m.text } });
        p.beats[head.id] = head;
        p.order.splice(endOf(breakOf(actTitle(m.act))), 0, head.id);
        bySource.set(m.id, head);
        result.added++;
      }
      for (const sb of mine) {
        placed.add(key(sb));
        const old = existing.get(key(sb));
        if (old) refresh(old, sb);
        else {
          const groupId = momentGroup(p, head);
          const last = p.order.reduce((at, id, i) => (p.beats[id]?.groupId === groupId ? i : at), p.order.indexOf(head.id));
          card(sb, { groupId }, last + 1);
        }
      }
    }
    // Ostatní storybeaty zůstávají vyřazené, ale leží tam, kam v čase patří: ve svém dějství, v pořadí vyprávění,
    // tak daleko od jeho začátku, jak daleko je storybeat ve svých Signpostech.
    const actIds = p.order.filter((id) => /^\d+\. dějství$/.test(p.breaks[id]?.title ?? ''));
    const n = actIds.length;
    /** Dějství (pořadí od nuly), do kterého Signpost spadá. */
    const actOf = (sp: number) => (n >= 4 ? Math.min(n, sp) - 1 : n === 3 ? [0, 1, 1, 2][sp - 1] : n === 2 ? (sp <= 2 ? 0 : 1) : 0);
    const rank = new Map(sorted.map((x, i) => [key(x), i]));
    const original = actIds.map((id) => p.order.slice(p.order.indexOf(id) + 1, endOf(id)));
    for (const sb of sorted) {
      if (placed.has(key(sb))) continue;
      const old = existing.get(key(sb));
      if (old) {
        refresh(old, sb);
        continue;
      }
      const sp = signpostOf(sb);
      const act = actOf(sp);
      const inAct = [1, 2, 3, 4].filter((x) => actOf(x) === act);
      const share = (inAct.indexOf(sp) + ((sb.sequence - 1) % PER_SIGNPOST[sb.scope]) / PER_SIGNPOST[sb.scope]) / inAct.length;
      const from = p.order.indexOf(actIds[act]) + 1;
      const end = endOf(actIds[act]);
      // Cíl podle podílu mezi položkami, které v dějství byly před doplňováním.
      const before = original[act][Math.round(share * original[act].length)];
      let at = before ? p.order.indexOf(before) : end;
      // Nikdy před storybeat, který ve vyprávění předchází.
      for (let i = from; i < end; i++) {
        const d = p.beats[p.order[i]]?.dramatica;
        if (d && (rank.get(key(d)) ?? Infinity) < rank.get(key(sb))! && i + 1 > at) at = i + 1;
      }
      // A ne doprostřed bloku Momentu.
      while (at < end && at > from && p.beats[p.order[at]]?.groupId && p.beats[p.order[at]].groupId === p.beats[p.order[at - 1]]?.groupId) at++;
      card(sb, { off: true }, at);
    }
  } else {
    // Jen storybeaty: kartou je nejpodrobnější úroveň (Událost, jinak Progrese, jinak Signpost), řazeno po Signpostech.
    const children = new Map<string, number>();
    for (const x of all) {
      const up = parentOf(x);
      if (up) children.set(key(up), (children.get(key(up)) ?? 0) + 1);
    }
    const isCard = (x: Storybeat) => {
      const n = children.get(key(x)) ?? 0;
      return n === 0 || (n < 4 && !!(x.summary || x.storytelling));
    };
    const rank = new Map(sorted.map((x, i) => [key(x), i]));
    for (let sp = 1; sp <= 4; sp++) if (sorted.some((x) => signpostOf(x) === sp && isCard(x))) breakOf(`Signpost ${sp}`);
    for (const sb of sorted) {
      const old = existing.get(key(sb));
      if (old) refresh(old, sb);
      else if (isCard(sb)) {
        // Za poslední kartu téhož Signpostu, která ve vyprávění předchází; jinak hned za předěl.
        let at = p.order.indexOf(breakOf(`Signpost ${signpostOf(sb)}`)) + 1;
        p.order.forEach((id, i) => {
          const d = p.beats[id]?.dramatica;
          if (d && signpostOf(d) === signpostOf(sb) && (rank.get(key(d)) ?? Infinity) < rank.get(key(sb))!) at = i + 1;
        });
        card(sb, {}, at);
      }
    }
    // Text nadřazených storybeatů, které kartou nejsou, patří do rešerše.
    for (const sb of all) {
      if (existing.has(key(sb)) || !(sb.summary || sb.storytelling)) continue;
      const title = `${THROUGHLINES[tlIndex(sb.throughline)].name} · ${SCOPE_NAME[sb.scope]} ${sb.sequence}${sb.fn ? ` · ${sb.fn}` : ''}`;
      const body = [sb.summary, sb.storytelling].filter(Boolean).join('\n\n');
      const item = p.research.find((x) => x.folder === 'Dramatica' && x.title === title);
      if (item) item.text = body;
      else p.research.push({ id: uid(), title, text: body, folder: 'Dramatica', url: '', beatIds: [] });
    }
  }

  // ----- Story Drivery: karty v A story na zlomech příběhu -----
  /** Oddíly, do kterých se příběh dělí (dějství nebo Signposty), v pořadí. */
  const parts = p.order.filter((id) => p.breaks[id]);
  const basementAt = () => p.order.length;
  /** Místo uvnitř oddílu, které neroztrhne blok Momentu. */
  const middleOf = (breakId: ID) => {
    const from = p.order.indexOf(breakId) + 1;
    let at = from + Math.ceil((endOf(breakId) - from) / 2);
    while (at < endOf(breakId) && at > from && p.beats[p.order[at]]?.groupId && p.beats[p.order[at]].groupId === p.beats[p.order[at - 1]]?.groupId) at++;
    return at;
  };
  for (const d of bundle.drivers) {
    const old = bySource.get(d.id);
    if (old) {
      if (d.summary) old.synopsis = d.summary;
      old.source = { id: d.id, kind: 'driver', text: d.storytelling || old.source!.text };
      continue;
    }
    const b = newBeat(lanes[0], { title: DRIVERS[d.index], synopsis: d.summary, source: { id: d.id, kind: 'driver', text: d.storytelling } });
    p.beats[b.id] = b;
    // Initial na začátku, Concluding na konci; ostatní na konci první čtvrtiny, v polovině a na konci třetí čtvrtiny.
    const n = parts.length;
    const at =
      d.index === 0 || !n
        ? d.index === 0 && n
          ? p.order.indexOf(parts[0]) + 1
          : basementAt()
        : d.index === 4
          ? basementAt()
          : n >= 4
            ? endOf(parts[d.index - 1])
            : n === 3
              ? d.index === 2
                ? middleOf(parts[1])
                : endOf(parts[d.index === 1 ? 0 : 1])
              : d.index === 2
                ? middleOf(parts[n - 1])
                : endOf(parts[d.index === 1 ? 0 : n - 1]);
    p.order.splice(at, 0, b.id);
    bySource.set(d.id, b);
    result.added++;
  }

  // ----- Postavy -----
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
  for (const n of bundle.notes) note(n.folder, n.title, n.text);

  // ----- Storyform: storypointy, dynamika a přehled storybeatů -----
  const known = new Map((p.storyform?.beats ?? []).map((x) => [x.key, x]));
  for (const x of all) known.set(key(x), { key: key(x), uuid: x.uuid, throughline: x.throughline, scope: x.scope, sequence: x.sequence, fn: x.fn, summary: x.summary });
  p.storyform = {
    points: bundle.storyform?.points ?? p.storyform?.points ?? [],
    dynamics: bundle.storyform?.dynamics ?? p.storyform?.dynamics ?? [],
    beats: [...known.values()].sort((a, b) => tlIndex(a.throughline) - tlIndex(b.throughline) || narrativeOrder(a, b)),
  };
  return result;
}

/** Blok Momentu: vznikne, až když do Momentu přijde první storybeat; karta Momentu je jeho první položkou. */
function momentGroup(p: Project, head: Beat): ID {
  if (head.groupId && p.groups.some((g) => g.id === head.groupId)) return head.groupId;
  const g = { id: uid(), title: head.title, color: MOMENT_COLOR, collapsed: false, parentId: null };
  p.groups.push(g);
  head.groupId = g.id;
  return g.id;
}

/** Karty Momentů v pořadí vyprávění. */
export const momentCards = (p: Project): Beat[] => p.order.map((id) => p.beats[id]).filter((b) => b?.source?.kind === 'moment');

/** Karta Momentu, do kterého beat patří. */
export const momentOf = (p: Project, b: Beat): Beat | null =>
  b.source?.kind === 'moment' || !b.groupId ? null : (momentCards(p).find((m) => m.groupId === b.groupId) ?? null);

/**
 * Přiřadí beat do Momentu: zařadí ho na konec jeho bloku a vrátí do příběhu. Bez Momentu ho z bloku
 * vyjme a vyřadí ze scénáře; na tabuli zůstane na svém místě.
 */
export function assignMoment(p: Project, beatId: ID, momentId: ID | null) {
  const b = p.beats[beatId];
  const head = momentId ? p.beats[momentId] : null;
  if (!b || b.source?.kind === 'moment') return;
  if (!head) {
    // Zůstane, kde v čase je; jen ho vysuneme za konec bloku, aby blok zůstal pohromadě.
    const groupId = b.groupId;
    b.groupId = null;
    b.off = true;
    if (groupId) {
      p.order.splice(p.order.indexOf(beatId), 1);
      const last = p.order.reduce((at, id, i) => (p.beats[id]?.groupId === groupId ? i : at), -1);
      p.order.splice(last + 1, 0, beatId);
    }
    return;
  }
  p.order.splice(p.order.indexOf(beatId), 1);
  const groupId = momentGroup(p, head);
  const last = p.order.reduce((at, id, i) => (p.beats[id]?.groupId === groupId ? i : at), p.order.indexOf(head.id));
  b.groupId = groupId;
  b.off = false;
  p.order.splice(last + 1, 0, beatId);
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

/** Momenty a Story Drivery v pořadí vyprávění; u Momentu i jeho storybeaty v pořadí. Podklad pro zápis zpět. */
export function exportSources(p: Project) {
  return p.order
    .map((id, i) => ({ b: p.beats[id], i }))
    .filter((x) => x.b?.source)
    .map(({ b, i }) => ({
      id: b.source!.id,
      kind: b.source!.kind,
      order: i + 1,
      title: b.title,
      synopsis: b.synopsis,
      text: b.source!.text,
      storybeats: b.source!.kind === 'moment' && b.groupId ? p.order.filter((x) => p.beats[x]?.groupId === b.groupId && p.beats[x].dramatica).map((x) => p.beats[x].dramatica!.uuid ?? key(p.beats[x].dramatica!)) : [],
    }));
}

/** Storybeaty na kartách jako podklad pro zápis zpět; vyřazené (nepřiřazené) se neposílají. */
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
      plotOrder: b.off ? null : i + 1,
      moments: [momentOf(p, b)?.title].filter((x): x is string => !!x),
    }));
}
