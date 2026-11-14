import { describe, expect, it } from 'vitest';
import { CONTD, MORE, PAPERS, eighths, paginate, parasLines, wrapText } from '../src/paginate';
import { para, project } from './fixtures';

const words = (n: number, w = 'slovo') => Array(n).fill(w).join(' ');
/** Akce, která zabere přesně daný počet řádků (každý řádek je jedno dlouhé slovo). */
const action = (lines: number) => para('action', Array(lines).fill('x'.repeat(60)).join(' '));
/** Všechny řádky strany jako text. */
const text = (pg: ReturnType<typeof paginate>, n: number) => pg.pages[n - 1].items.flatMap((i) => i.lines);

describe('zalamování řádků', () => {
  it('láme po slovech na danou šířku', () => {
    expect(wrapText('jedna dvě tři čtyři', 10)).toEqual(['jedna dvě', 'tři čtyři']);
    expect(wrapText(words(24), 60).every((l) => l.length <= 60)).toBe(true);
  });
  it('zachová ruční konce řádků a rozdělí příliš dlouhé slovo', () => {
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b']);
    expect(wrapText('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });
  it('počítá mezery mezi odstavci: dva řádky před hlavičkou, nic uvnitř repliky', () => {
    expect(parasLines([para('scene', 'INT. BYT – DEN'), para('action', 'Ticho.'), para('character', 'MARTA'), para('paren', '(tiše)'), para('dialogue', 'Ahoj.')])).toBe(2 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
  });
});

describe('stránkování', () => {
  it('prázdný scénář nemá žádnou stranu', () => {
    const p = project();
    p.add('a');
    expect(paginate(p).pages).toHaveLength(0);
    expect(paginate(p).totalLines).toBe(0);
  });

  it('počet řádků na straně se řídí papírem', () => {
    const p = project();
    p.add('a', { paras: [action(200)] });
    expect(paginate(p).perPage).toBe(PAPERS.a4.lines);
    expect(paginate(p).pages).toHaveLength(Math.ceil(200 / 58));
    p.paper = 'letter';
    expect(paginate(p).pages).toHaveLength(Math.ceil(200 / 54));
  });

  it('vyřazené beaty se nestránkují', () => {
    const p = project();
    p.add('a', { paras: [action(10)] });
    const off = p.add('b', { paras: [action(100)], off: true });
    const pg = paginate(p);
    expect(pg.pages).toHaveLength(1);
    expect(pg.beat.has(off.id)).toBe(false);
  });

  it('hlavička scény nezůstane na konci strany sama', () => {
    const p = project();
    const head = para('scene', 'INT. SKLAD – NOC');
    // 54 řádků akce, pak mezera 2 a hlavička na řádku 57; pro další akci (mezera + 2 řádky) už místo není.
    p.add('a', { paras: [action(54)] });
    p.add('b', { paras: [head, para('action', 'Tma.')] });
    const pg = paginate(p);
    expect(pg.para.get(head.id)).toMatchObject({ page: 2, breakBefore: true });
    expect(pg.pages[0].used).toBe(54);
  });

  it('jméno mluvčího se neoddělí od repliky', () => {
    const p = project();
    const cue = para('character', 'MARTA');
    p.add('a', { paras: [action(56), cue, para('dialogue', 'Tohle se na stranu nevejde.')] });
    const pg = paginate(p);
    expect(pg.para.get(cue.id)!.page).toBe(2);
  });

  it('akci dělí tak, aby nikde nezůstal osamocený řádek', () => {
    const p = project();
    const long = action(6);
    p.add('a', { paras: [action(52), long] });
    const pg = paginate(p);
    // Na straně zbývá po mezeře 5 řádků, ale šestý by na další straně zůstal sám: přejdou tam dva.
    expect(pg.para.get(long.id)).toMatchObject({ page: 1, splits: [{ after: 4, page: 2 }] });
  });

  it('krátkou akci, která se nevejde, přesune celou', () => {
    const p = project();
    const short = action(3);
    p.add('a', { paras: [action(55), short] });
    expect(paginate(p).para.get(short.id)).toMatchObject({ page: 2, breakBefore: true, splits: [] });
  });

  it('dlouhou repliku rozdělí s (DÁLE) a (POKR.)', () => {
    const p = project();
    const cue = para('character', 'VIKTOR');
    const speech = para('dialogue', Array(12).fill('Tahle věta má přesně tolik slov, aby vyšla.').join(' '));
    p.add('a', { paras: [action(46), cue, speech] });
    const pg = paginate(p);
    const first = text(pg, 1);
    const second = text(pg, 2);
    expect(first.at(-1)).toBe(MORE);
    expect(first.at(-2)).toMatch(/[.!?]$/);
    expect(second[0]).toBe(`VIKTOR ${CONTD}`);
    expect(pg.pages[0].used).toBeLessThanOrEqual(58);
    const at = pg.para.get(speech.id)!;
    expect(at.splits).toHaveLength(1);
    expect(at.splits[0].page).toBe(2);
    // Celá replika je na stranách právě jednou.
    const all = [...first, ...second].filter((l) => l.startsWith('Tahle') || l.includes('vyšla') || l.includes('slov')).join(' ');
    expect(all.match(/Tahle/g)).toHaveLength(12);
  });

  it('žádná strana nepřeteče a beaty na sebe navazují', () => {
    const p = project();
    for (let i = 0; i < 40; i++) {
      p.add(`b${i}`, {
        paras: [
          para('scene', `INT. MÍSTO ${i} – DEN`),
          para('action', words(30 + ((i * 37) % 90))),
          para('character', 'MARTA'),
          para('paren', '(potichu, skoro pro sebe)'),
          para('dialogue', words(10 + ((i * 53) % 200), 'ano.')),
          para('character', 'VIKTOR'),
          para('dialogue', words(5 + ((i * 11) % 40))),
          para('transition', 'STŘIH NA:'),
        ],
      });
    }
    const pg = paginate(p);
    expect(pg.pages.length).toBeGreaterThan(10);
    for (const page of pg.pages) {
      expect(page.used).toBeLessThanOrEqual(pg.perPage);
      expect(page.items.reduce((n, i) => n + i.gap + i.lines.length, 0)).toBe(page.used);
      expect(page.items[0].gap).toBe(0);
      // Strana nekončí hlavičkou scény ani jménem mluvčího a nezačíná přechodem.
      expect(['scene', 'character']).not.toContain(page.items.at(-1)!.type);
      expect(page.items[0].type).not.toBe('transition');
    }
    let prev = 0;
    for (const id of p.order) {
      const b = pg.beat.get(id)!;
      expect(b.start).toBeGreaterThanOrEqual(prev);
      expect(b.end).toBeGreaterThan(b.start);
      prev = b.end;
    }
    expect(prev).toBe(pg.totalLines);
    expect(pg.pages.flatMap((x) => x.items).filter((i) => i.sceneNo).map((i) => i.sceneNo)).toEqual([...Array(40)].map((_, i) => i + 1));
  });

  it('výsledek si pamatuje, dokud se scénář nezmění', () => {
    const p = project();
    p.add('a', { paras: [action(10)] });
    const first = paginate(p);
    expect(paginate(p)).toBe(first);
    p.beats = { ...p.beats };
    expect(paginate(p)).not.toBe(first);
  });
});

describe('délka v osminách podle papíru', () => {
  it('stejný počet řádků je na A4 kratší než na Letteru', () => {
    expect(eighths(54, PAPERS.letter.lines)).toBe('1');
    expect(eighths(54, PAPERS.a4.lines)).toBe('7/8');
  });
});
