import { describe, expect, it } from 'vitest';
import { insertParas, paste, retype } from '../src/edit';
import { parseLines } from '../src/text';
import { para } from './fixtures';

const shape = (ps: { type: string; text: string }[]) => ps.map((p) => `${p.type}: ${p.text}`);

describe('vkládání scénáře ze schránky', () => {
  it('text bez prázdných řádků (Final Draft, Word, PDF) rozdělí na prvky', () => {
    const text = 'INT. KUCHYNĚ – DEN\nEva krájí chleba.\nEVA\n(tiše)\nKde jsi byl?\nPetr mlčí.\nSTŘIH NA:\nEXT. DVŮR – NOC\nPrší.';
    expect(shape(parseLines(text))).toEqual([
      'scene: INT. KUCHYNĚ – DEN',
      'action: Eva krájí chleba.',
      'character: EVA',
      'paren: (tiše)',
      'dialogue: Kde jsi byl?',
      'action: Petr mlčí.',
      'transition: STŘIH NA:',
      'scene: EXT. DVŮR – NOC',
      'action: Prší.',
    ]);
  });

  it('odsazený text: pokračování repliky pozná podle odsazení', () => {
    const text = 'EVA\n          Kde jsi\n          byl tak dlouho?\nPetr mlčí.';
    expect(shape(parseLines(text))).toEqual(['character: EVA', 'dialogue: Kde jsi byl tak dlouho?', 'action: Petr mlčí.']);
  });

  it('zápis Fountain s prázdnými řádky zůstává jako dřív', () => {
    const text = 'INT. KUCHYNĚ – DEN\nEva krájí chleba.\nA pak nůž odloží.\n\nEVA\nKde jsi\nbyl?\n\nTICHO.';
    expect(shape(parseLines(text))).toEqual([
      'scene: INT. KUCHYNĚ – DEN',
      'action: Eva krájí chleba.\nA pak nůž odloží.',
      'character: EVA',
      'dialogue: Kde jsi byl?',
      'action: TICHO.',
    ]);
  });

  it('více scén se vloží jako samostatné odstavce s typy', () => {
    const ps = [para('action', '')];
    paste(ps, { i: 0, off: 0 }, 'INT. A – DEN\nAkce.\nMARTA\nAhoj.\nINT. B – NOC\nJiná akce.');
    expect(ps.map((p) => p.type)).toEqual(['scene', 'action', 'character', 'dialogue', 'scene', 'action']);
  });

  it('odstavce zkopírované z Fabuly se vloží beze změny typů', () => {
    const ps = [para('action', 'Začátek. Konec.')];
    insertParas(ps, { i: 0, off: 9 }, [para('character', 'EVA'), para('dialogue', 'NE, NEKŘIČ.')]);
    expect(shape(ps)).toEqual(['action: Začátek. ', 'character: EVA', 'dialogue: NE, NEKŘIČ.', 'action: Konec.']);
  });

  it('změna na poznámku přidá závorky, změna zpět je odebere', () => {
    const p = para('dialogue', 'tiše');
    retype(p, 'paren');
    expect(p.text).toBe('(tiše)');
    retype(p, 'dialogue');
    expect(p.text).toBe('tiše');
  });
});
