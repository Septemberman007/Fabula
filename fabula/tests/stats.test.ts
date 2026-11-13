import { describe, expect, it } from 'vitest';
import { cast, dayPart, locations, parseHeading, profanities, scenes, toCsv, totals } from '../src/stats';
import { para, project } from './fixtures';

describe('hlavička scény', () => {
  it('rozloží INT/EXT, místo a dobu', () => {
    expect(parseHeading('int. Depozitář muzea – noc')).toEqual({ intExt: 'INT', location: 'DEPOZITÁŘ MUZEA', time: 'NOC' });
    expect(parseHeading('INT./EXT. AUTO - DEN').intExt).toBe('INT/EXT');
    expect(parseHeading('KUCHYNĚ')).toEqual({ intExt: '', location: 'KUCHYNĚ', time: '' });
  });

  it('zařadí denní dobu', () => {
    expect(['NOC', 'RÁNO', 'POZDĚJI', ''].map(dayPart)).toEqual(['Noc', 'Den', 'Jiné', 'Neuvedeno']);
  });
});

function story() {
  const p = project();
  p.characters = [
    { id: 'm', name: 'Marta', color: '#000', aliases: '', role: 'main' },
    { id: 'h', name: 'Hron', color: '#000', aliases: '', role: 'secondary' },
  ];
  p.add('Kancelář', { paras: [para('scene', 'INT. KANCELÁŘ – VEČER'), para('character', 'MARTA'), para('dialogue', 'Do prdele, kde to je?')] });
  p.add('Pokračování', { paras: [para('action', 'Vejde Hron.'), para('character', 'HRON'), para('dialogue', 'Hledáte tohle?')] });
  p.add('Nerozepsaný');
  p.add('Ulice', { paras: [para('scene', 'EXT. ULICE – NOC'), para('action', 'Prší.')] });
  p.add('Vyřazený', { off: true, paras: [para('scene', 'INT. SKLEP – DEN'), para('action', 'Nic.')] });
  return p;
}

describe('reporty', () => {
  const p = story();
  const sc = scenes(p);

  it('scéna pokračuje přes další rozepsaný beat a vyřazené beaty se nepočítají', () => {
    expect(sc.map((s) => [s.heading, s.beats.length])).toEqual([
      ['INT. KANCELÁŘ – VEČER', 2],
      ['EXT. ULICE – NOC', 1],
    ]);
  });

  it('souhrny', () => {
    const t = totals(p, sc);
    expect(t).toMatchObject({ beats: 4, beatsOff: 1, written: 3, scenes: 2, intExt: { INT: 1, EXT: 1 }, dayNight: { Noc: 2 } });
    expect(t.byType.dialogue.count).toBe(2);
  });

  it('obsazení: repliky, slova a vulgarismy', () => {
    const rows = cast(p, sc);
    const marta = rows.find((r) => r.id === 'm')!;
    expect(marta).toMatchObject({ speeches: 1, words: 5, profanity: 1, speaking: [1] });
    expect(marta.partners).toEqual([{ name: 'Hron', scenes: 1 }]);
    expect(rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1);
  });

  it('lokace', () => {
    expect(locations(sc).map((l) => l.location)).toEqual(['KANCELÁŘ', 'ULICE']);
  });
});

describe('pomocné funkce', () => {
  it('vulgarismy podle kmene, ale ne „sranda“', () => {
    expect(profanities('Kurva, to je hovno.')).toBe(2);
    expect(profanities('To je sranda.')).toBe(0);
  });

  it('CSV escapuje uvozovky a začíná BOM', () => {
    expect(toCsv(['a'], [['řekl "ne"']])).toBe('﻿"a"\r\n"řekl ""ne"""');
  });
});
