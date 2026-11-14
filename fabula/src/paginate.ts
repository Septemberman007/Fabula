import type { Beat, ID, Para, ParaType, Paper, Project } from './model';
import { UPPER } from './text';

/**
 * Skutečné stránkování scénáře.
 *
 * Vychází ze standardní sazby: Courier 12 b., tedy 10 znaků na palec a 6 řádků na palec,
 * okraje 1" nahoře a dole, 1,5" vlevo. Odstavce se zalomí na šířku svého typu a pak se skládají
 * na strany podle pravidel, která drží i Final Draft: hlavička scény nezůstane dole sama,
 * jméno mluvčího se neoddělí od repliky, dlouhá replika se dělí s „(DÁLE)“ a „(POKR.)“.
 */

export const PAPERS: Record<Paper, { label: string; lines: number; width: string; height: string; css: string }> = {
  a4: { label: 'A4', lines: 58, width: '210mm', height: '297mm', css: 'A4' },
  letter: { label: 'US Letter', lines: 54, width: '8.5in', height: '11in', css: 'letter' },
};
export const paperOf = (p: Pick<Project, 'paper'>): Paper => (p.paper === 'letter' ? 'letter' : 'a4');
/** Počet řádků textu na straně zvoleného papíru. */
export const pageLines = (p: Pick<Project, 'paper'>) => PAPERS[paperOf(p)].lines;

/** Odsazení zleva a šířka ve znacích, počet prázdných řádků před odstavcem. */
export const LAYOUT: Record<ParaType, { indent: number; width: number; before: number }> = {
  scene: { indent: 0, width: 60, before: 2 },
  action: { indent: 0, width: 60, before: 1 },
  character: { indent: 22, width: 38, before: 1 },
  paren: { indent: 16, width: 25, before: 0 },
  dialogue: { indent: 10, width: 35, before: 0 },
  transition: { indent: 0, width: 60, before: 1 },
};

export const MORE = '(DÁLE)';
export const CONTD = '(POKR.)';

const up = (s: string) => s.toLocaleUpperCase('cs');

/**
 * Zalomí text na danou šířku stejně jako textové pole v prohlížeči: láme v mezerách a za spojovníkem
 * uvnitř slova, vícenásobné mezery zachová a slovo delší než řádek rozdělí natvrdo.
 */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\s+$/, '').replace(/^\n+/, '').split('\n')) {
    const tokens = raw.trim().match(/\s+|\S+/g);
    if (!tokens) {
      out.push('');
      continue;
    }
    let line = '';
    let space = '';
    for (const token of tokens) {
      if (/^\s/.test(token)) {
        space = token.replace(/\t/g, ' ');
        continue;
      }
      // Části slova, mezi kterými se smí zalomit (za spojovníkem mezi písmeny).
      const parts = token.split(/(?<=[\p{L}\d]-)(?=\p{L})/u);
      parts.forEach((part, i) => {
        let w = part;
        const glue = i === 0 ? space : '';
        if (line && line.length + glue.length + w.length <= width) {
          line += glue + w;
          return;
        }
        if (line) out.push(line);
        line = '';
        while (w.length > width) {
          out.push(w.slice(0, width));
          w = w.slice(width);
        }
        line = w;
      });
      space = '';
    }
    if (line) out.push(line);
  }
  return out;
}

const wrapCache = new WeakMap<Para, string[]>();
/** Řádky odstavce tak, jak budou na straně. Prázdný odstavec nemá žádné. */
export function paraLines(para: Para): string[] {
  let hit = wrapCache.get(para);
  if (!hit) {
    hit = para.text.trim() ? wrapText(UPPER[para.type] ? up(para.text) : para.text, LAYOUT[para.type].width) : [];
    wrapCache.set(para, hit);
  }
  return hit;
}

const SPEECH: ParaType[] = ['character', 'paren', 'dialogue'];
const gapBefore = (type: ParaType, prev: ParaType | null) =>
  (type === 'dialogue' || type === 'paren') && prev && SPEECH.includes(prev) ? 0 : Math.max(1, LAYOUT[type].before);

const beatCache = new WeakMap<Para[], number>();
/** Počet řádků, které odstavce zaberou včetně mezer mezi nimi (bez vlivu zlomů stran). */
export function parasLines(paras: Para[]): number {
  const hit = beatCache.get(paras);
  if (hit !== undefined) return hit;
  let n = 0;
  let prev: ParaType | null = null;
  for (const para of paras) {
    const len = paraLines(para).length;
    if (!len) continue;
    n += gapBefore(para.type, prev) + len;
    prev = para.type;
  }
  beatCache.set(paras, n);
  return n;
}
export const beatLines = (b: Beat) => parasLines(b.paras);
/** Přibližná délka beatu ve stranách bez ohledu na papír (pro poměrné šířky na časové ose). */
export const beatPages = (b: Beat) => beatLines(b) / 56;

/** Délka v osminách strany, jak se uvádí v produkci: „2 3/8“. */
export function eighths(lines: number, perPage: number): string {
  const e = Math.max(lines > 0 ? 1 : 0, Math.round((lines / perPage) * 8));
  const whole = Math.floor(e / 8);
  const rest = e % 8;
  return [whole || '', rest ? `${rest}/8` : ''].filter(Boolean).join(' ') || '0';
}

// ---------- Výsledek ----------

export interface PageItem {
  paraId: ID;
  beatId: ID;
  /** „more“ je vložený řádek (DÁLE) na konci strany. */
  type: ParaType | 'more';
  lines: string[];
  /** Prázdné řádky nad položkou. */
  gap: number;
  /** Číslo scény u hlavičky. */
  sceneNo?: number;
  /** Zopakované jméno mluvčího na začátku další strany. */
  contd?: boolean;
}
export interface Page {
  n: number;
  items: PageItem[];
  /** Kolik řádků je na straně zaplněno. */
  used: number;
}
export interface ParaPlace {
  /** Strana, na které odstavec začíná. */
  page: number;
  /** Zabrané řádky včetně mezery nad odstavcem a vložených (DÁLE) / (POKR.). */
  lines: number;
  /** Odstavcem začíná nová strana. */
  breakBefore: boolean;
  /** Zlomy uvnitř odstavce: po kolika řádcích a jaká strana následuje. */
  splits: { after: number; page: number }[];
}
export interface BeatPlace {
  page: number;
  lastPage: number;
  /** Poloha začátku a konce v řádcích od začátku scénáře. */
  start: number;
  end: number;
  lines: number;
}
export interface Pagination {
  paper: Paper;
  perPage: number;
  pages: Page[];
  /** Délka scénáře v řádcích: plné strany a zaplněná část poslední. */
  totalLines: number;
  para: Map<ID, ParaPlace>;
  beat: Map<ID, BeatPlace>;
}

// ---------- Sazba ----------

interface Block {
  para: Para;
  beatId: ID;
  lines: string[];
  before: number;
  sceneNo?: number;
}
interface Row {
  b: Block;
  i: number;
}
type Unit = { speech: false; b: Block; before: number } | { speech: true; cue: Block | null; rows: Row[]; before: number };

const SENTENCE_END = /([.!?…:"“”'’)\]]|--|—|–)$/;

/** Nejlepší místo zlomu repliky: počet řádků, které zůstanou na straně, nebo −1, když rozumné dělení není. */
function speechCut(rows: Row[], start: number, avail: number): number {
  let fallback = -1;
  for (let k = Math.min(avail - 1, rows.length - start - 2); k >= 2; k--) {
    const last = rows[start + k - 1];
    if (last.b.para.type !== 'dialogue') continue;
    const placed = last.i + 1;
    const len = last.b.lines.length;
    // Uvnitř odstavce nesmí na žádné straně zůstat osamocený řádek.
    if (placed < len && (placed < 2 || len - placed < 2)) continue;
    if (SENTENCE_END.test(last.b.lines[last.i])) return k;
    if (fallback < 0) fallback = k;
  }
  return fallback;
}

function buildUnits(p: Project): Unit[] {
  const units: Unit[] = [];
  let prev: ParaType | null = null;
  let scene = 0;
  let open: Extract<Unit, { speech: true }> | null = null;
  for (const bid of p.order) {
    const beat = p.beats[bid];
    if (!beat || beat.off) continue;
    for (const para of beat.paras) {
      const lines = paraLines(para);
      if (!lines.length) continue;
      const type = para.type;
      const b: Block = { para, beatId: bid, lines, before: gapBefore(type, prev) };
      prev = type;
      if (type === 'character') {
        open = { speech: true, cue: b, rows: [], before: b.before };
        units.push(open);
      } else if (type === 'dialogue' || type === 'paren') {
        if (!open) {
          open = { speech: true, cue: null, rows: [], before: b.before };
          units.push(open);
        }
        lines.forEach((_, i) => open!.rows.push({ b, i }));
      } else {
        open = null;
        if (type === 'scene') b.sceneNo = ++scene;
        units.push({ speech: false, b, before: b.before });
      }
    }
  }
  return units;
}

let last: { order: Project['order']; beats: Project['beats']; paper: Paper; result: Pagination } | null = null;

/** Rozloží scénář (bez vyřazených beatů) na strany. Výsledek se pamatuje, dokud se text nezmění. */
export function paginate(p: Project): Pagination {
  const paper = paperOf(p);
  if (last && last.order === p.order && last.beats === p.beats && last.paper === paper) return last.result;

  const per = PAPERS[paper].lines;
  const units = buildUnits(p);
  const pages: Page[] = [];
  const paraPlace = new Map<ID, ParaPlace>();
  const beatPlace = new Map<ID, BeatPlace>();
  let page: Page = { n: 1, items: [], used: 0 };
  /** Na straně zatím není žádný skutečný (nevložený) text. */
  let fresh = true;
  let y = 0;

  const newPage = () => {
    page.used = y;
    pages.push(page);
    page = { n: page.n + 1, items: [], used: 0 };
    y = 0;
    fresh = true;
  };

  /** Zapíše položku na stranu a připočte její řádky odstavci a beatu. */
  const add = (owner: Block, item: PageItem, from: number | null) => {
    const n = item.gap + item.lines.length;
    const abs = (page.n - 1) * per + y;
    let pp = paraPlace.get(owner.para.id);
    if (!pp) paraPlace.set(owner.para.id, (pp = { page: page.n, lines: 0, breakBefore: false, splits: [] }));
    if (from !== null) {
      if (from === 0) pp.breakBefore = fresh && page.n > 1;
      else if (fresh) pp.splits.push({ after: from, page: page.n });
      fresh = false;
    }
    pp.lines += n;
    let bp = beatPlace.get(owner.beatId);
    if (!bp) beatPlace.set(owner.beatId, (bp = { page: page.n, lastPage: page.n, start: abs, end: abs, lines: 0 }));
    bp.lastPage = page.n;
    bp.end = abs + n;
    bp.lines += n;
    page.items.push(item);
    y += n;
  };
  const put = (b: Block, from: number, to: number, gap: number) =>
    add(b, { paraId: b.para.id, beatId: b.beatId, type: b.para.type, lines: b.lines.slice(from, to), gap, sceneNo: from === 0 ? b.sceneNo : undefined }, from);

  const isTransition = (u: Unit | undefined): u is Extract<Unit, { speech: false }> => !!u && !u.speech && u.b.para.type === 'transition';

  /** Vejde se jednotka celá, ale přechod za ní (STŘIH NA:) by už začínal další stranu? */
  const pushesTransition = (i: number, len: number, room: number) => {
    const next = units[i + 1];
    return isTransition(next) && len + next.before + next.b.lines.length > room;
  };

  /** Smí jednotka začít na této straně v dané výšce, aniž poruší pravidla? */
  const canStart = (i: number, at: number): boolean => {
    const u = units[i];
    if (!u) return true;
    const gap = at > 0 ? u.before : 0;
    if (u.speech) {
      const avail = per - at - gap - (u.cue?.lines.length ?? 0);
      if (u.rows.length <= avail && !pushesTransition(i, u.rows.length, avail)) return true;
      return speechCut(u.rows, 0, avail) >= 0;
    }
    const len = u.b.lines.length;
    const room = per - at - gap;
    if (u.b.para.type === 'scene') return len <= room && canStart(i + 1, at + gap + len);
    if (u.b.para.type !== 'action') return len <= room;
    if (len > room) return len >= 4 && room >= 2;
    // Přechod nemá začínat stranu: krátká akce se k němu přesune celá, dlouhá se rozdělí.
    return len >= 4 || !pushesTransition(i, len, room);
  };

  const placeAction = (b: Block, i: number) => {
    const len = b.lines.length;
    let from = 0;
    for (;;) {
      const gap = y > 0 && from === 0 ? b.before : 0;
      const rest = len - from;
      const avail = per - y - gap;
      let k: number;
      if (rest <= avail) {
        k = rest;
        if (rest >= 4 && y + gap > 0 && pushesTransition(i, rest, avail)) k = rest - 2;
      } else {
        k = Math.min(avail, rest - 2);
        if (k < 2) {
          if (y > 0) {
            newPage();
            continue;
          }
          k = Math.max(1, Math.min(avail, rest));
        } else {
          // Raději skončit na konci věty, pokud je do čtyř řádků výš.
          for (let j = k; j >= Math.max(2, k - 4); j--) {
            if (SENTENCE_END.test(b.lines[from + j - 1])) {
              k = j;
              break;
            }
          }
        }
      }
      put(b, from, from + k, gap);
      from += k;
      if (from >= len) return;
      newPage();
    }
  };

  const placeSpeech = (u: Extract<Unit, { speech: true }>, i: number) => {
    const { cue, rows } = u;
    let start = 0;
    const putRows = (a: number, z: number, gap: number) => {
      for (let i = a; i < z; ) {
        let j = i;
        while (j + 1 < z && rows[j + 1].b === rows[i].b) j++;
        put(rows[i].b, rows[i].i, rows[j].i + 1, i === a ? gap : 0);
        i = j + 1;
      }
    };
    for (;;) {
      const contd = start > 0;
      const gap = y > 0 && !contd ? u.before : 0;
      const head = cue ? (contd ? 1 : cue.lines.length) : 0;
      const rest = rows.length - start;
      const avail = per - y - gap - head;
      let k = rest;
      // Replika se dělí, když se nevejde, nebo když by za ní přechod zůstal sám na další straně.
      const pushed = rest <= avail && pushesTransition(i, rest, avail);
      if (rest > avail || pushed) {
        k = speechCut(rows, start, avail);
        if (k < 0 && pushed) k = rest;
        else if (k < 0) {
          if (y > 0) {
            newPage();
            continue;
          }
          k = Math.max(1, Math.min(avail - 1, rest));
        }
      }
      if (cue) {
        if (!contd) put(cue, 0, cue.lines.length, gap);
        else {
          const name = cue.lines.join(' ');
          add(cue, { paraId: cue.para.id, beatId: cue.beatId, type: 'character', lines: [/\((POKR|CONT)/i.test(name) ? name : `${name} ${CONTD}`], gap: 0, contd: true }, null);
        }
      }
      putRows(start, start + k, cue ? 0 : gap);
      start += k;
      if (start >= rows.length) return;
      const owner = rows[start - 1].b;
      add(owner, { paraId: owner.para.id, beatId: owner.beatId, type: 'more', lines: [MORE], gap: 0 }, null);
      newPage();
    }
  };

  units.forEach((u, i) => {
    if (y > 0 && !canStart(i, y)) newPage();
    if (u.speech) placeSpeech(u, i);
    else if (u.b.para.type === 'action') placeAction(u.b, i);
    else put(u.b, 0, u.b.lines.length, y > 0 ? u.before : 0);
  });
  if (page.items.length) {
    page.used = y;
    pages.push(page);
  }

  const result: Pagination = {
    paper,
    perPage: per,
    pages,
    totalLines: pages.length ? (pages.length - 1) * per + pages[pages.length - 1].used : 0,
    para: paraPlace,
    beat: beatPlace,
  };
  last = { order: p.order, beats: p.beats, paper, result };
  return result;
}

/** Rozsah stran beatu pro popisek: „12“ nebo „12–13“. */
export const pageRange = (b: BeatPlace | undefined) => (b ? (b.page === b.lastPage ? `${b.page}` : `${b.page}–${b.lastPage}`) : '');
