import type { Beat, ID, Para, ParaType, Project } from './model';

const up = (s: string) => s.toLocaleUpperCase('cs');
const id = () => crypto.randomUUID();

export const SCENE_RE = /^(INT\.?\/EXT|EXT\.?\/INT|INT|EXT|I\/E)[.\s]/i;
const TRANSITION_RE = /^(STŘIH NA|PROLÍNAČKA|ZATMÍVAČKA|ROZTMÍVAČKA|FADE (IN|OUT)|CUT TO|DISSOLVE TO)\b|TO:$/;

/** Typy psané verzálkami. */
export const UPPER: Record<ParaType, boolean> = {
  scene: true,
  character: true,
  transition: true,
  action: false,
  dialogue: false,
  paren: false,
};

/** Jaký odstavec následuje po Enteru. */
export const NEXT_TYPE: Record<ParaType, ParaType> = {
  scene: 'action',
  action: 'action',
  character: 'dialogue',
  paren: 'dialogue',
  dialogue: 'action',
  transition: 'scene',
};

export const TYPE_CYCLE: ParaType[] = ['action', 'character', 'dialogue', 'paren', 'transition', 'scene'];

/** Převede prostý text (zápis Fountain) na odstavce scénáře. */
export function parseFountain(text: string): Para[] {
  const out: Para[] = [];
  const push = (type: ParaType, t: string) => out.push({ id: id(), type, text: UPPER[type] ? up(t.trim()) : t.trim() });
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    const first = lines[0].trim();
    const isUpper = /\p{L}/u.test(first) && first === up(first);
    if (lines.length === 1 && (SCENE_RE.test(first) || /^\.[^.]/.test(first))) {
      push('scene', first.replace(/^\./, ''));
    } else if (lines.length === 1 && (first.startsWith('>') || (isUpper && TRANSITION_RE.test(first)))) {
      push('transition', first.replace(/^>\s*/, ''));
    } else if (lines.length > 1 && (isUpper || first.startsWith('@')) && !SCENE_RE.test(first)) {
      push('character', first.replace(/^@/, ''));
      for (const l of lines.slice(1)) {
        const t = l.trim();
        const last = out[out.length - 1];
        if (/^\(.*\)$/.test(t)) push('paren', t);
        else if (last.type === 'dialogue') last.text += ' ' + t;
        else push('dialogue', t);
      }
    } else {
      push('action', lines.map((l) => l.trim()).join('\n'));
    }
  }
  return out;
}

/** Zapíše odstavce jako text ve formátu Fountain. */
export function toFountain(paras: Para[]): string {
  let s = '';
  paras.forEach((p, i) => {
    const t = UPPER[p.type] ? up(p.text.trim()) : p.text.trim();
    if (!t) return;
    const attached = (p.type === 'dialogue' || p.type === 'paren') && i > 0 && ['character', 'paren', 'dialogue'].includes(paras[i - 1].type);
    s += s ? (attached ? '\n' : '\n\n') : '';
    if (p.type === 'scene') s += SCENE_RE.test(t) ? t : '.' + t;
    else if (p.type === 'transition') s += /TO:$/.test(t) ? t : '> ' + t;
    else if (p.type === 'character') s += t;
    else s += t;
    if (p.note?.trim()) s += ` [[${p.note.trim().replace(/\n/g, ' ')}]]`;
  });
  return s;
}

const WIDTH: Record<ParaType, number> = { scene: 60, action: 60, character: 38, paren: 25, dialogue: 35, transition: 60 };
export const LINES_PER_PAGE = 55;

/** Odhad počtu řádků, které beat zabere na stránce scénáře. */
const linesCache = new WeakMap<Para[], number>();

export function beatLines(b: Beat): number {
  const hit = linesCache.get(b.paras);
  if (hit !== undefined) return hit;
  let n = 0;
  b.paras.forEach((p, i) => {
    if (!p.text.trim()) return;
    const attached = (p.type === 'dialogue' || p.type === 'paren') && i > 0;
    n += attached ? 0 : 1;
    for (const line of p.text.split('\n')) n += Math.max(1, Math.ceil(line.length / WIDTH[p.type]));
  });
  linesCache.set(b.paras, n);
  return n;
}
export const beatPages = (b: Beat) => beatLines(b) / LINES_PER_PAGE;
export const beatWords = (b: Beat) => b.paras.reduce((n, p) => n + (p.text.match(/\S+/g)?.length ?? 0), 0);
export const hasText = (b: Beat) => b.paras.some((p) => p.text.trim());

/** Jméno mluvčího bez dovětků typu (V.O.) nebo (POKR.). */
export const speaker = (text: string) => up(text.replace(/\(.*?\)/g, '').replace(/^@/, '').trim());

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function charWords(c: { name: string; aliases: string }): string[] {
  return [c.name, ...c.aliases.split(',')].map((w) => w.trim()).filter((w) => w.length > 1);
}

/** Postavy rozpoznané z textu beatu: mluvčí a jména zmíněná v akci, hlavičce či synopsi. */
/** Výsledek rozpoznání pro beat; platí, dokud se nezmění beat ani seznam postav. */
const detectCache = new WeakMap<Beat, { chars: Project['characters']; found: Set<ID> }>();
/** Vzory pro hledání jmen, sestavené jednou pro daný seznam postav. */
const patternCache = new WeakMap<Project['characters'], { id: ID; words: string[]; re: RegExp[] }[]>();

function patterns(chars: Project['characters']) {
  let out = patternCache.get(chars);
  if (!out) {
    out = chars.map((c) => {
      const words = charWords(c).map(up);
      return {
        id: c.id,
        words,
        // Česká jména se skloňují (Marta → Martu, Viktor → Viktorem): shodu hledáme na kmeni bez koncové samohlásky.
        re: words.map((W) => new RegExp(`(^|[^\\p{L}])${esc(W.length > 3 ? W.replace(/[AEIOUYÁÉÍÓÚŮÝĚ]$/u, '') : W)}\\p{L}{0,3}(?![\\p{L}])`, 'u')),
      };
    });
    patternCache.set(chars, out);
  }
  return out;
}

export function detectedCharacters(p: Project, b: Beat): Set<ID> {
  const cached = detectCache.get(b);
  if (cached && cached.chars === p.characters) return cached.found;
  const found = new Set<ID>();
  const speakers = new Set(b.paras.filter((x) => x.type === 'character').map((x) => speaker(x.text)));
  const prose = up(
    [b.title, b.synopsis, ...b.paras.filter((x) => x.type === 'action' || x.type === 'scene').map((x) => x.text)].join('\n'),
  );
  for (const c of patterns(p.characters)) {
    if (c.words.some((W) => speakers.has(W)) || c.re.some((re) => re.test(prose))) found.add(c.id);
  }
  detectCache.set(b, { chars: p.characters, found });
  return found;
}

/** Ruční i rozpoznané postavy dohromady, v pořadí seznamu postav. */
export function beatCharacters(p: Project, b: Beat): ID[] {
  const det = detectedCharacters(p, b);
  return p.characters.filter((c) => det.has(c.id) || b.characterIds.includes(c.id)).map((c) => c.id);
}

/** Mluvčí ve scénáři, kteří nejsou v seznamu postav. */
export function unknownSpeakers(p: Project): string[] {
  const known = new Set(p.characters.flatMap((c) => charWords(c).map(up)));
  const seen = new Set<string>();
  for (const bid of p.order) {
    for (const para of p.beats[bid]?.paras ?? []) {
      if (para.type !== 'character') continue;
      const s = speaker(para.text);
      if (s && !known.has(s)) seen.add(s);
    }
  }
  return [...seen];
}

/** Pořadová čísla scén podle hlaviček napříč celým scénářem. */
export function sceneNumbers(p: Project): Map<ID, number> {
  const m = new Map<ID, number>();
  let n = 0;
  for (const bid of p.order) for (const para of p.beats[bid]?.paras ?? []) if (para.type === 'scene' && para.text.trim()) m.set(para.id, ++n);
  return m;
}

export const titleCase = (s: string) => s.toLocaleLowerCase('cs').replace(/(^|[\s-])\p{L}/gu, (m) => up(m));

/** Postava, které patří replika s danou hlavičkou mluvčího (podle jména nebo dalších slov). */
export function speakerCharacter(p: Project, text: string): ID | undefined {
  const s = speaker(text);
  return p.characters.find((c) => charWords(c).some((w) => up(w) === s))?.id;
}

/** Odhad řádků pro libovolný úsek odstavců (scéna může jít přes více beatů). */
export const parasLines = (paras: Para[]) => beatLines({ paras } as Beat);

/** Délka v osminách strany, jak se uvádí v produkci: „2 3/8“. */
export function eighths(lines: number): string {
  const e = Math.max(lines > 0 ? 1 : 0, Math.round((lines / LINES_PER_PAGE) * 8));
  const whole = Math.floor(e / 8);
  const rest = e % 8;
  return [whole || '', rest ? `${rest}/8` : ''].filter(Boolean).join(' ') || '0';
}
