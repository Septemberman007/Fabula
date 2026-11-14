import { describe, expect, it } from 'vitest';
import { deleteRange, insertText, paste, sliceRange, splitPara } from '../src/edit';
import { toFountain } from '../src/text';
import { para } from './fixtures';

const scene = () => [para('scene', 'INT. BYT – DEN'), para('action', 'Marta vejde.'), para('character', 'MARTA'), para('dialogue', 'Je tu někdo?')];
const shape = (ps: { type: string; text: string }[]) => ps.map((p) => `${p.type}:${p.text}`);

describe('mazání výběru', () => {
  it('uvnitř jednoho odstavce', () => {
    const ps = scene();
    expect(deleteRange(ps, { i: 1, off: 0 }, { i: 1, off: 6 })).toEqual({ i: 1, off: 0 });
    expect(ps[1].text).toBe('vejde.');
  });
  it('přes více odstavců je spojí a prostřední odstraní', () => {
    const ps = scene();
    const caret = deleteRange(ps, { i: 1, off: 5 }, { i: 3, off: 3 });
    expect(caret).toEqual({ i: 1, off: 5 });
    expect(shape(ps)).toEqual(['scene:INT. BYT – DEN', 'action:Martatu někdo?']);
  });
  it('když z prvního odstavce nic nezbude, zůstane typ posledního', () => {
    const ps = scene();
    deleteRange(ps, { i: 1, off: 0 }, { i: 3, off: 0 });
    expect(shape(ps)).toEqual(['scene:INT. BYT – DEN', 'dialogue:Je tu někdo?']);
  });
  it('Backspace na začátku odstavce ho připojí k předchozímu', () => {
    const ps = scene();
    const caret = deleteRange(ps, { i: 0, off: ps[0].text.length }, { i: 1, off: 0 });
    expect(caret).toEqual({ i: 0, off: 14 });
    expect(shape(ps)[0]).toBe('scene:INT. BYT – DENMarta vejde.');
    expect(ps).toHaveLength(3);
  });
});

describe('Enter', () => {
  it('po mluvčím následuje replika, po replice akce', () => {
    const ps = [para('character', 'MARTA')];
    expect(splitPara(ps, { i: 0, off: 5 })).toEqual({ i: 1, off: 0 });
    expect(ps[1].type).toBe('dialogue');
    ps[1].text = 'Ahoj.';
    splitPara(ps, { i: 1, off: 5 });
    expect(ps[2].type).toBe('action');
  });
  it('uprostřed odstavce přenese zbytek textu dál', () => {
    const ps = [para('action', 'Jedna. Dvě.')];
    splitPara(ps, { i: 0, off: 7 });
    expect(shape(ps)).toEqual(['action:Jedna. ', 'action:Dvě.']);
  });
  it('v prázdné replice z ní udělá akci', () => {
    const ps = [para('dialogue', '')];
    expect(splitPara(ps, { i: 0, off: 0 })).toEqual({ i: 0, off: 0 });
    expect(shape(ps)).toEqual(['action:']);
  });
  it('na začátku hlavičky jen vloží řádek nad ni', () => {
    const ps = scene();
    expect(splitPara(ps, { i: 0, off: 0 })).toEqual({ i: 1, off: 0 });
    expect(shape(ps).slice(0, 2)).toEqual(['action:', 'scene:INT. BYT – DEN']);
  });
});

describe('vkládání', () => {
  it('psaní „int. “ udělá z akce hlavičku scény', () => {
    const ps = [para('action', '')];
    insertText(ps, { i: 0, off: 0 }, 'int. sklep');
    expect(ps[0].type).toBe('scene');
  });
  it('jednořádkový text se vloží do odstavce', () => {
    const ps = scene();
    expect(paste(ps, { i: 1, off: 6 }, 'tiše ')).toEqual({ i: 1, off: 11 });
    expect(ps[1].text).toBe('Marta tiše vejde.');
  });
  it('víceřádkový text se rozpozná jako scénář', () => {
    const ps = [para('action', '')];
    const caret = paste(ps, { i: 0, off: 0 }, 'EXT. ULICE – NOC\n\nPrší.\n\nVIKTOR\n(šeptem)\nPojď.');
    expect(shape(ps)).toEqual(['scene:EXT. ULICE – NOC', 'action:Prší.', 'character:VIKTOR', 'paren:(šeptem)', 'dialogue:Pojď.']);
    expect(caret).toEqual({ i: 4, off: 5 });
  });
  it('vložení doprostřed odstavce ho rozdělí', () => {
    const ps = [para('action', 'Začátek konec')];
    paste(ps, { i: 0, off: 8 }, 'VIKTOR\nAno.');
    expect(shape(ps)).toEqual(['action:Začátek ', 'character:VIKTOR', 'dialogue:Ano.', 'action:konec']);
  });
  it('zkopírovaný úsek se po vložení vrátí ve stejné podobě', () => {
    const ps = scene();
    const copied = toFountain(sliceRange(ps, { i: 1, off: 6 }, { i: 3, off: 5 }));
    const target = [para('action', '')];
    paste(target, { i: 0, off: 0 }, copied);
    expect(shape(target)).toEqual(['action:vejde.', 'character:MARTA', 'dialogue:Je tu']);
  });
});

import { copyAcross, deleteAcross, editField, Seg } from '../src/edit';
import { project } from './fixtures';

describe('výběr přes hranice beatů', () => {
  const setup = () => {
    const p = project();
    const a = p.add('První', { synopsis: 'Začátek.', paras: [para('scene', 'INT. BYT – DEN'), para('action', 'Marta vejde.')] });
    const b = p.add('Druhý', { synopsis: 'Konec.', paras: [para('character', 'MARTA'), para('dialogue', 'Je tu někdo?')] });
    const segs: Seg[] = [
      { beatId: a.id, kind: 'para', paraId: a.paras[1].id },
      { beatId: b.id, kind: 'title' },
      { beatId: b.id, kind: 'syn' },
      { beatId: b.id, kind: 'para', paraId: b.paras[0].id },
      { beatId: b.id, kind: 'para', paraId: b.paras[1].id },
    ];
    return { p, a, b, segs };
  };
  it('smaže text v každém úseku, beaty zůstanou', () => {
    const { p, a, b, segs } = setup();
    const caret = deleteAcross(p, segs, 6, 3);
    expect(caret).toMatchObject({ beatId: a.id, kind: 'para', paraId: a.paras[1].id, off: 6 });
    expect(shape(p.beats[a.id].paras)).toEqual(['scene:INT. BYT – DEN', 'action:Marta ']);
    expect(p.beats[b.id]).toMatchObject({ title: '', synopsis: '' });
    expect(shape(p.beats[b.id].paras)).toEqual(['dialogue:tu někdo?']);
    expect(p.order).toHaveLength(2);
  });
  it('výběr od názvu smaže jen vybranou část názvu', () => {
    const { p, b, segs } = setup();
    const caret = deleteAcross(p, segs.slice(1, 4), 2, 2);
    expect(caret).toMatchObject({ beatId: b.id, kind: 'title', off: 2 });
    expect(p.beats[b.id].title).toBe('Dr');
    expect(shape(p.beats[b.id].paras)).toEqual(['character:RTA', 'dialogue:Je tu někdo?']);
  });
  it('zkopíruje názvy a synopse jako nadpisy a po vložení do textu je vynechá', () => {
    const { p, segs } = setup();
    const text = copyAcross(p, segs, 6, 5);
    expect(text).toBe('vejde.\n\n# Druhý\n\n= Konec.\n\nMARTA\nJe tu');
    const target = [para('action', '')];
    paste(target, { i: 0, off: 0 }, text);
    expect(shape(target)).toEqual(['action:vejde.', 'character:MARTA', 'dialogue:Je tu']);
  });
  it('název zůstává jednořádkový', () => {
    const { p, b } = setup();
    editField(p, { beatId: b.id, kind: 'title' }, 0, 0, 'Nový\nřádek ');
    expect(p.beats[b.id].title).toBe('Nový řádek Druhý');
  });
});
