import type { ID, Para, ParaType, Project } from './model';
import { LINES_PER_PAGE, detectedCharacters, parasLines, speaker, speakerCharacter } from './text';

const words = (t: string) => t.match(/\S+/g)?.length ?? 0;
const up = (s: string) => s.toLocaleUpperCase('cs');

/** Kmeny českých a anglických vulgarismů; počítají se slova, která jimi začínají. */
const PROFANITY = /(?<![\p{L}])(kurv|kurev|píč|pič|prdel|hovn|hoven|sr[aá][tč]|sraní|vysr|posr|nasr|zasr|debil|zmrd|mrd|kokot|čur[aá]k|čůr[aá]k|hajzl|šuk|jeb|do prdele|fuck|shit|bitch|asshole|bastard|damn|cunt|dick)\p{L}*/giu;
export const profanities = (text: string) => text.match(PROFANITY)?.length ?? 0;

export interface Heading {
  intExt: string;
  location: string;
  time: string;
}

/** Rozloží hlavičku scény na INT/EXT, místo a denní dobu. */
export function parseHeading(text: string): Heading {
  const m = up(text.trim()).match(/^(INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|INT|EXT)?[.\s]*(.*)$/s);
  const rest = (m?.[2] ?? '').trim();
  const cut = rest.match(/^(.*)\s[–—-]\s([^–—-]+)$/);
  const ie = (m?.[1] ?? '').replace(/[.\s]/g, '');
  return {
    intExt: ie === 'I/E' || ie.includes('/') ? 'INT/EXT' : ie,
    location: (cut ? cut[1] : rest).trim() || '(bez místa)',
    time: cut ? cut[2].trim() : '',
  };
}

const DAY = /\b(DEN|DAY|RÁNO|MORNING|DOPOLEDNE|ODPOLEDNE|AFTERNOON|POLEDNE|SVÍTÁNÍ|DAWN)\b/;
const NIGHT = /\b(NOC|NIGHT|VEČER|EVENING|SOUMRAK|DUSK)\b/;
export const dayPart = (time: string) => (NIGHT.test(time) ? 'Noc' : DAY.test(time) ? 'Den' : time ? 'Jiné' : 'Neuvedeno');

export interface Scene {
  n: number;
  heading: string;
  parsed: Heading;
  beats: ID[];
  lines: number;
  words: number;
  /** Mluvčí (jméno verzálkami) → počet replik a slov. */
  speakers: Map<string, { speeches: number; words: number; profanity: number }>;
  /** Postavy ze seznamu, které ve scéně vystupují (mluví nebo jsou zmíněny či ručně přiřazeny). */
  cast: Set<ID>;
  tags: Set<ID>;
  tension: number;
}

/**
 * Rozdělí scénář na scény. Scéna začíná hlavičkou a pokračuje přes další rozepsané beaty
 * až k další hlavičce; prázdný beat ji ukončí. Vyřazené beaty se přeskakují.
 */
export function scenes(p: Project): Scene[] {
  const out: Scene[] = [];
  let cur: Scene | null = null;
  const paras = new Map<Scene, Para[]>();
  for (const bid of p.order) {
    const b = p.beats[bid];
    if (!b || b.off) continue;
    if (!b.paras.some((x) => x.text.trim())) {
      cur = null;
      continue;
    }
    for (const para of b.paras) {
      if (!para.text.trim()) continue;
      if (para.type === 'scene') {
        cur = { n: out.length + 1, heading: up(para.text.trim()), parsed: parseHeading(para.text), beats: [], lines: 0, words: 0, speakers: new Map(), cast: new Set(), tags: new Set(), tension: 0 };
        out.push(cur);
        paras.set(cur, []);
      }
      if (!cur) continue;
      paras.get(cur)!.push(para);
      if (!cur.beats.includes(bid)) cur.beats.push(bid);
    }
  }
  for (const sc of out) {
    const ps = paras.get(sc)!;
    sc.lines = parasLines(ps);
    sc.words = ps.reduce((n, x) => n + words(x.text), 0);
    let who: string | null = null;
    for (const x of ps) {
      if (x.type === 'character') {
        who = speaker(x.text);
        if (!who) continue;
        const e = sc.speakers.get(who) ?? { speeches: 0, words: 0, profanity: 0 };
        e.speeches++;
        sc.speakers.set(who, e);
        const c = speakerCharacter(p, x.text);
        if (c) sc.cast.add(c);
      } else if (x.type === 'dialogue' && who) {
        sc.speakers.get(who)!.words += words(x.text);
        sc.speakers.get(who)!.profanity += profanities(x.text);
      }
      else if (x.type !== 'paren') who = null;
    }
    for (const bid of sc.beats) {
      const b = p.beats[bid];
      for (const c of b.characterIds) sc.cast.add(c);
      for (const t of b.tagIds) sc.tags.add(t);
      sc.tension = Math.max(sc.tension, b.tension);
    }
    // Zmínky v textu beatů této scény (výsledek rozpoznání se bere z mezipaměti).
    for (const bid of sc.beats) for (const c of detectedCharacters(p, p.beats[bid])) sc.cast.add(c);
  }
  return out;
}

export interface Totals {
  beats: number;
  beatsOff: number;
  written: number;
  scenes: number;
  lines: number;
  pages: number;
  words: number;
  paragraphs: number;
  byType: Record<ParaType, { count: number; words: number }>;
  intExt: Record<string, number>;
  dayNight: Record<string, number>;
  avgSceneLines: number;
  longest: Scene | null;
  shortest: Scene | null;
  dialogueShare: number;
  links: number;
  byStatus: Record<string, number>;
}

export function totals(p: Project, sc: Scene[]): Totals {
  const byType = { scene: { count: 0, words: 0 }, action: { count: 0, words: 0 }, character: { count: 0, words: 0 }, paren: { count: 0, words: 0 }, dialogue: { count: 0, words: 0 }, transition: { count: 0, words: 0 } };
  const all = p.order.filter((id) => p.beats[id]).map((id) => p.beats[id]);
  const active = all.filter((b) => !b.off);
  let lines = 0;
  const byStatus: Record<string, number> = {};
  for (const b of active) {
    lines += parasLines(b.paras);
    byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
    for (const x of b.paras) {
      if (!x.text.trim()) continue;
      byType[x.type].count++;
      byType[x.type].words += words(x.text);
    }
  }
  const total = Object.values(byType).reduce((n, t) => n + t.words, 0);
  const count = (key: (s: Scene) => string) => sc.reduce<Record<string, number>>((m, s) => ((m[key(s)] = (m[key(s)] ?? 0) + 1), m), {});
  const sorted = [...sc].sort((a, b) => b.lines - a.lines);
  return {
    beats: active.length,
    beatsOff: all.length - active.length,
    written: active.filter((b) => b.paras.some((x) => x.text.trim())).length,
    scenes: sc.length,
    lines,
    pages: lines / LINES_PER_PAGE,
    words: total,
    paragraphs: Object.values(byType).reduce((n, t) => n + t.count, 0),
    byType,
    intExt: count((s) => s.parsed.intExt || 'Neuvedeno'),
    dayNight: count((s) => dayPart(s.parsed.time)),
    avgSceneLines: sc.length ? sc.reduce((n, s) => n + s.lines, 0) / sc.length : 0,
    longest: sorted[0] ?? null,
    shortest: sorted.at(-1) ?? null,
    dialogueShare: total ? byType.dialogue.words / total : 0,
    links: p.links.length,
    byStatus,
  };
}

export interface LocationRow {
  location: string;
  intExt: string[];
  times: string[];
  scenes: number[];
  lines: number;
}

export function locations(sc: Scene[]): LocationRow[] {
  const m = new Map<string, LocationRow>();
  for (const s of sc) {
    const r = m.get(s.parsed.location) ?? { location: s.parsed.location, intExt: [], times: [], scenes: [], lines: 0 };
    if (s.parsed.intExt && !r.intExt.includes(s.parsed.intExt)) r.intExt.push(s.parsed.intExt);
    if (s.parsed.time && !r.times.includes(s.parsed.time)) r.times.push(s.parsed.time);
    r.scenes.push(s.n);
    r.lines += s.lines;
    m.set(s.parsed.location, r);
  }
  return [...m.values()].sort((a, b) => b.scenes.length - a.scenes.length || b.lines - a.lines);
}

export interface CastRow {
  id: ID | null;
  name: string;
  role: string;
  speaking: number[];
  nonSpeaking: number[];
  speeches: number;
  words: number;
  share: number;
  profanity: number;
  /** Beaty, ve kterých postava vystupuje (i nerozepsané). */
  beats: number;
  partners: { name: string; scenes: number }[];
}

/** Obsazení: kde kdo mluví, kolik toho řekne a s kým sdílí scény. */
export function cast(p: Project, sc: Scene[]): CastRow[] {
  const ROLE = { main: 'hlavní', secondary: 'vedlejší', small: 'malá role' } as const;
  const rows = new Map<string, CastRow>();
  const keyOf = (name: string) => {
    const c = p.characters.find((x) => x.id === speakerCharacter(p, name));
    return c ? c.id : `?${name}`;
  };
  for (const c of p.characters) {
    rows.set(c.id, { id: c.id, name: c.name || 'Bez jména', role: ROLE[c.role], speaking: [], nonSpeaking: [], speeches: 0, words: 0, share: 0, profanity: 0, beats: 0, partners: [] });
  }
  const together = new Map<string, Map<string, number>>();
  for (const s of sc) {
    const present = new Set<string>(s.cast);
    for (const [name, e] of s.speakers) {
      const k = keyOf(name);
      if (!rows.has(k)) rows.set(k, { id: null, name, role: 'není v seznamu', speaking: [], nonSpeaking: [], speeches: 0, words: 0, share: 0, profanity: 0, beats: 0, partners: [] });
      const r = rows.get(k)!;
      if (!r.speaking.includes(s.n)) r.speaking.push(s.n);
      r.speeches += e.speeches;
      r.words += e.words;
      r.profanity += e.profanity;
      present.add(k);
    }
    for (const k of present) {
      const r = rows.get(k);
      if (r && !r.speaking.includes(s.n)) r.nonSpeaking.push(s.n);
      for (const other of present) {
        if (other === k) continue;
        const m = together.get(k) ?? new Map<string, number>();
        m.set(other, (m.get(other) ?? 0) + 1);
        together.set(k, m);
      }
    }
  }
  const all = [...rows.values()].reduce((n, r) => n + r.words, 0);
  for (const [k, r] of rows) {
    r.share = all ? r.words / all : 0;
    if (r.id) r.beats = Object.values(p.beats).filter((b) => !b.off && (b.characterIds.includes(r.id!) || detectedCharacters(p, b).has(r.id!))).length;
    r.partners = [...(together.get(k) ?? [])]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([o, n]) => ({ name: rows.get(o)?.name ?? o, scenes: n }));
  }
  return [...rows.values()].sort((a, b) => b.words - a.words || b.speaking.length + b.nonSpeaking.length - (a.speaking.length + a.nonSpeaking.length));
}

/** Tabulka jako CSV (středníky a BOM, aby ji Excel otevřel s češtinou). */
export function toCsv(head: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

export const totalWords = (p: Project) => Object.values(p.beats).reduce((n, b) => n + (b.off ? 0 : b.paras.reduce((m, x) => m + words(x.text), 0)), 0);
