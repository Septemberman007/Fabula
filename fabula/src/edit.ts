import type { ID, Para, Project } from './model';
import { newPara } from './model';
import type { ParaType } from './model';
import { NEXT_TYPE, SCENE_RE, parseLines, toFountain } from './text';

/**
 * Úpravy textu beatu jako jednoho souvislého dokumentu: mazání výběru přes více odstavců,
 * dělení a slučování odstavců, vkládání víceřádkového textu. Funkce upravují seznam odstavců
 * na místě a vracejí polohu, kde má skončit kurzor.
 */

/** Poloha v textu beatu: pořadí odstavce a znak v něm. */
export interface Pos {
  i: number;
  off: number;
}

export const before = (a: Pos, b: Pos) => a.i < b.i || (a.i === b.i && a.off <= b.off);

/** Smaže text mezi dvěma polohami (a ≤ b); odstavce na okrajích spojí do jednoho. */
export function deleteRange(ps: Para[], a: Pos, b: Pos): Pos {
  const first = ps[a.i];
  const last = ps[b.i];
  const head = first.text.slice(0, a.off);
  const tail = last.text.slice(b.off);
  if (a.i !== b.i) {
    // Když z prvního odstavce nic nezbylo, výsledek je pokračováním posledního: převezme jeho typ.
    if (!head) first.type = last.type;
    if (!first.note && last.note) first.note = last.note;
    ps.splice(a.i + 1, b.i - a.i);
  }
  first.text = head + tail;
  return { i: a.i, off: a.off };
}

/** Vloží text do odstavce (smí obsahovat ruční konce řádků). */
export function insertText(ps: Para[], at: Pos, text: string): Pos {
  const p = ps[at.i];
  p.text = p.text.slice(0, at.off) + text + p.text.slice(at.off);
  detectScene(p);
  return { i: at.i, off: at.off + text.length };
}

/** „int. “ na začátku akce z ní udělá hlavičku scény. */
export function detectScene(p: Para) {
  if (p.type === 'action' && SCENE_RE.test(p.text) && !p.text.includes('\n')) p.type = 'scene';
}

/** Enter: rozdělí odstavec v místě kurzoru. Typ dalšího odstavce se řídí zvyklostmi scénáře. */
export function splitPara(ps: Para[], at: Pos): Pos {
  const p = ps[at.i];
  // Enter v prázdném odstavci jiného typu z něj udělá akci (únik z dialogu).
  if (!p.text.trim() && p.type !== 'action') {
    p.type = 'action';
    return { i: at.i, off: 0 };
  }
  // Enter na začátku neprázdného odstavce jen vloží prázdný řádek nad něj.
  if (at.off === 0 && p.text) {
    ps.splice(at.i, 0, newPara('action'));
    return { i: at.i + 1, off: 0 };
  }
  const next = newPara(NEXT_TYPE[p.type], p.text.slice(at.off));
  p.text = p.text.slice(0, at.off);
  ps.splice(at.i + 1, 0, next);
  return { i: at.i + 1, off: 0 };
}

/** Text ze schránky jako odstavce scénáře. Názvy a synopse beatů („# název“, „= synopse“) do textu nepatří. */
export const clipParas = (text: string): Para[] => parseLines(text.split('\n').filter((l) => !/^(#+|=)\s/.test(l)).join('\n'));

/**
 * Vloží text ze schránky. Jednořádkový se vloží do odstavce; víceřádkový se rozpozná
 * jako scénář (hlavičky, mluvčí, repliky) a vloží se jako samostatné odstavce.
 */
export function paste(ps: Para[], at: Pos, text: string): Pos {
  const clean = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  if (!clean.includes('\n')) return insertText(ps, at, clean);
  return insertParas(ps, at, clipParas(clean));
}

/** Vloží hotové odstavce (například zkopírované z Fabuly) na polohu kurzoru. */
export function insertParas(ps: Para[], at: Pos, items: Para[]): Pos {
  if (!items.length) return at;
  if (items.length === 1 && items[0].type === 'action' && !items[0].text.includes('\n')) return insertText(ps, at, items[0].text);
  const p = ps[at.i];
  const head = p.text.slice(0, at.off);
  const tail = p.text.slice(at.off);
  let i = at.i;
  if (head.trim()) {
    p.text = head;
    ps.splice(i + 1, 0, ...items);
    i += items.length;
  } else {
    // Prázdný začátek odstavce: první vložený odstavec ho nahradí.
    const [first, ...rest] = items;
    p.type = first.type;
    p.text = first.text;
    if (first.note && !p.note) p.note = first.note;
    ps.splice(i + 1, 0, ...rest);
    i += rest.length;
  }
  const end = { i, off: ps[i].text.length };
  if (tail.trim()) ps.splice(i + 1, 0, newPara(p.type === 'scene' ? 'action' : head.trim() ? p.type : 'action', tail));
  return end;
}

/**
 * Změní typ odstavce. Poznámka (parenteze) dostane závorky, a když přestane být poznámkou, závorky ztratí.
 */
export function retype(p: Para, type: ParaType) {
  if (p.type === type) return;
  const t = p.text.trim();
  if (type === 'paren' && t && !t.startsWith('(')) p.text = `(${t})`;
  else if (p.type === 'paren' && /^\(.*\)$/s.test(t)) p.text = t.slice(1, -1).trim();
  p.type = type;
}

/** Vybraný úsek jako samostatné odstavce (pro kopírování). */
export function sliceRange(ps: Para[], a: Pos, b: Pos): Para[] {
  return ps.slice(a.i, b.i + 1).map((p, k, all) => ({
    ...p,
    text: p.text.slice(k === 0 ? a.off : 0, k === all.length - 1 ? b.off : undefined),
  }));
}

// ---------- Úseky scénáře: název beatu, synopse a odstavce ----------

/** Jeden úsek souvislé plochy scénáře. */
export interface Seg {
  beatId: ID;
  kind: 'title' | 'syn' | 'para';
  paraId?: ID;
}
/** Poloha kurzoru v ploše scénáře. */
export interface Caret extends Seg {
  off: number;
}

export function segText(p: Project, s: Seg): string {
  const b = p.beats[s.beatId];
  if (s.kind === 'title') return b.title;
  if (s.kind === 'syn') return b.synopsis;
  return b.paras.find((x) => x.id === s.paraId)?.text ?? '';
}

/** Nahradí část názvu nebo synopse. Název je vždy jednořádkový. */
export function editField(p: Project, s: Seg, from: number, to: number, text: string): Caret {
  const b = p.beats[s.beatId];
  const ins = s.kind === 'title' ? text.replace(/\s*\n\s*/g, ' ') : text;
  const old = s.kind === 'title' ? b.title : b.synopsis;
  const next = old.slice(0, from) + ins + old.slice(to);
  if (s.kind === 'title') b.title = next;
  else b.synopsis = next;
  return { ...s, off: from + ins.length };
}

/**
 * Smaže výběr sahající přes více úseků (i přes hranice beatů). `segs` jsou všechny úseky výběru v pořadí,
 * `from` je začátek v prvním a `to` konec v posledním. Text se smaže v každém úseku zvlášť: beaty zůstávají,
 * odstavce se spojují jen uvnitř jednoho beatu.
 */
export function deleteAcross(p: Project, segs: Seg[], from: number, to: number): Caret {
  const lastIndex = segs.length - 1;
  const byBeat = new Map<ID, { seg: Seg; k: number }[]>();
  segs.forEach((seg, k) => {
    if (seg.kind !== 'para') {
      const len = segText(p, seg).length;
      editField(p, seg, k === 0 ? from : 0, k === lastIndex ? Math.min(to, len) : len, '');
    } else byBeat.set(seg.beatId, [...(byBeat.get(seg.beatId) ?? []), { seg, k }]);
  });
  let caret: Caret = { ...segs[0], off: from };
  for (const [beatId, list] of byBeat) {
    const ps = p.beats[beatId].paras;
    const first = list[0];
    const last = list[list.length - 1];
    const ai = ps.findIndex((x) => x.id === first.seg.paraId);
    const bi = ps.findIndex((x) => x.id === last.seg.paraId);
    if (ai < 0 || bi < 0) continue;
    const a = { i: ai, off: first.k === 0 ? from : 0 };
    const b = { i: bi, off: last.k === lastIndex ? Math.min(to, ps[bi].text.length) : ps[bi].text.length };
    const c = deleteRange(ps, a, b);
    if (first.k === 0) caret = { beatId, kind: 'para', paraId: ps[c.i].id, off: c.off };
  }
  return caret;
}

/** Výběr přes více úseků jako text: název jako „# název“, synopse jako „= synopse“, odstavce ve Fountain. */
export function copyAcross(p: Project, segs: Seg[], from: number, to: number): string {
  const out: string[] = [];
  let run: Para[] = [];
  const flush = () => {
    if (run.length) out.push(toFountain(run));
    run = [];
  };
  segs.forEach((seg, k) => {
    const text = segText(p, seg).slice(k === 0 ? from : 0, k === segs.length - 1 ? to : undefined);
    if (seg.kind === 'para') {
      const para = p.beats[seg.beatId].paras.find((x) => x.id === seg.paraId);
      if (para) run.push({ ...para, text });
      return;
    }
    flush();
    if (text.trim()) out.push(seg.kind === 'title' ? `# ${text.trim()}` : text.trim().split('\n').map((l) => `= ${l}`).join('\n'));
  });
  flush();
  return out.join('\n\n');
}

/** Odstavce výběru přes více úseků (bez názvů a synopsí), pro kopírování se zachováním typů. */
export function copyParas(p: Project, segs: Seg[], from: number, to: number): Para[] {
  const out: Para[] = [];
  segs.forEach((seg, k) => {
    if (seg.kind !== 'para') return;
    const para = p.beats[seg.beatId].paras.find((x) => x.id === seg.paraId);
    if (!para) return;
    const text = para.text.slice(k === 0 ? from : 0, k === segs.length - 1 ? to : undefined);
    if (text.trim()) out.push({ ...para, text });
  });
  return out;
}

/** Změní typ všech odstavců v úsecích výběru. */
export function retypeAcross(p: Project, segs: Seg[], type: ParaType) {
  for (const seg of segs) {
    if (seg.kind !== 'para') continue;
    const para = p.beats[seg.beatId].paras.find((x) => x.id === seg.paraId);
    if (para) retype(para, type);
  }
}
