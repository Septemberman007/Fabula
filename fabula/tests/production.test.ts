import { describe, expect, it } from 'vitest';
import { breakdown, breakdownCsv, elementScenes, ensureProduction, findAll, tagText, toggleInScene } from '../src/production';
import { scenes } from '../src/stats';
import { para, project } from './fixtures';

const setup = () => {
  const p = project();
  p.add('a', { paras: [para('scene', 'INT. POKOJ – DEN'), para('action', 'Eva vytáhne pistoli ze šuplíku.'), para('character', 'EVA'), para('dialogue', 'Kde je moje pistole?')] });
  p.add('b', { paras: [para('scene', 'EXT. LES – NOC'), para('action', 'Pistolí míří na vlka. Pistolnice visí na větvi.')] });
  p.add('c', { paras: [para('scene', 'INT. CHODBA – DEN'), para('action', 'Ticho.')] });
  const prod = ensureProduction(p);
  return { p, props: prod.categories.find((c) => c.name === 'Rekvizity')!.id, animals: prod.categories.find((c) => c.name === 'Zvířata')!.id };
};

describe('produkční prvky', () => {
  it('hledá celá slova, tvary čárkou i kmen s hvězdičkou, bez ohledu na velikost písmen', () => {
    expect(findAll('Pistole a pistolnice', { name: 'pistole', aliases: '' })).toEqual([[0, 7]]);
    expect(findAll('Má pistoli, ne pistolí.', { name: 'pistole', aliases: 'pistoli, pistolí' })).toEqual([[3, 10], [15, 22]]);
    expect(findAll('pistole pistolnice', { name: 'pistole', aliases: 'pistol*' }).map(([a, b]) => b - a)).toEqual([7, 10]);
    expect(findAll('Starý vůz na vůz', { name: 'starý vůz', aliases: '' })).toEqual([[0, 9]]);
  });
  it('označení vybraného tvaru přidá tvar k prvku jen tehdy, když ho prvek nenajde sám', () => {
    const { p, props } = setup();
    const id = tagText(p, 'pistole', props)!;
    expect(tagText(p, 'pistoli', props, id)).toBe(id);
    expect(tagText(p, 'pistole', props)).toBe(id);
    expect(p.production!.elements).toHaveLength(1);
    expect(p.production!.elements[0].aliases).toBe('pistoli');
    expect(elementScenes(p.production!.elements[0], scenes(p)).map((s) => s.n)).toEqual([1]);
  });
  it('rozpis po scénách; ruční přidání a vyřazení ze scény', () => {
    const { p, props, animals } = setup();
    const gun = tagText(p, 'pistol*', props)!;
    tagText(p, 'vlka', animals);
    const sc = scenes(p);
    const row = (n: number) => breakdown(p).find((x) => x.scene.n === n)!;
    expect(row(1).elements.get(props)!.map((x) => x.el.name)).toEqual(['pistol*']);
    expect(row(2).elements.get(animals)!.map((x) => x.found)).toEqual([true]);
    expect(row(3).elements.size).toBe(0);
    toggleInScene(p, gun, sc[2].id, sc);
    toggleInScene(p, gun, sc[0].id, sc);
    expect(breakdown(p).map((x) => (x.elements.get(props) ?? []).map((e) => e.found))).toEqual([[], [true], [false]]);
    toggleInScene(p, gun, sc[0].id, sc);
    expect(row(1).elements.get(props)!.length).toBe(1);
    const csv = breakdownCsv(p).split('\r\n');
    expect(csv[0]).toContain('"Rekvizity"');
    expect(csv[2]).toContain('"vlka"');
  });
});
