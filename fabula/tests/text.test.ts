import { describe, expect, it } from 'vitest';
import { beatCharacters, detectedCharacters, eighths, parseFountain, toFountain, unknownSpeakers } from '../src/text';
import { para, project } from './fixtures';

describe('Fountain', () => {
  const source = 'INT. BYT – DEN\n\nPetr vejde.\n\nPETR\n(tiše)\nAhoj.\n\n> STŘIH NA:';

  it('rozpozná typy odstavců', () => {
    expect(parseFountain(source).map((x) => x.type)).toEqual(['scene', 'action', 'character', 'paren', 'dialogue', 'transition']);
  });

  it('po zápisu a novém načtení dá stejný text', () => {
    expect(toFountain(parseFountain(source))).toBe(source);
  });

  it('poznámku ke scénáři zapíše do dvojitých hranatých závorek', () => {
    expect(toFountain([{ ...para('action', 'Prší.'), note: 'ověřit počasí' }])).toBe('Prší. [[ověřit počasí]]');
  });
});

describe('rozpoznávání postav', () => {
  const p = project();
  p.characters = [
    { id: 'marta', name: 'Marta', color: '#000', aliases: '', role: 'main' },
    { id: 'viktor', name: 'Viktor', color: '#000', aliases: 'bratr', role: 'main' },
  ];

  it('najde mluvčího, skloňované jméno i další slovo', () => {
    const speaks = p.add('a', { paras: [para('character', 'MARTA (V.O.)'), para('dialogue', 'Ano.')] });
    const declined = p.add('b', { paras: [para('action', 'Hron se podívá na Martu.')] });
    const alias = p.add('c', { synopsis: 'Bratr volá.' });
    const none = p.add('d', { paras: [para('action', 'Prázdná chodba.')] });
    expect([...detectedCharacters(p, speaks)]).toEqual(['marta']);
    expect([...detectedCharacters(p, declined)]).toEqual(['marta']);
    expect([...detectedCharacters(p, alias)]).toEqual(['viktor']);
    expect(detectedCharacters(p, none).size).toBe(0);
  });

  it('spojí ruční a rozpoznané postavy', () => {
    const b = p.add('e', { characterIds: ['viktor'], paras: [para('action', 'Marta čeká.')] });
    expect(beatCharacters(p, b)).toEqual(['marta', 'viktor']);
  });

  it('ohlásí mluvčí, kteří nejsou v seznamu', () => {
    p.add('f', { paras: [para('character', 'kurýr'), para('dialogue', 'Podpis.')] });
    expect(unknownSpeakers(p)).toEqual(['KURÝR']);
  });
});

describe('délka v osminách strany', () => {
  it.each([
    [0, '0'],
    [3, '1/8'],
    [55, '1'],
    [76, '1 3/8'],
  ])('%i řádků → %s', (lines, text) => expect(eighths(lines)).toBe(text));
});
