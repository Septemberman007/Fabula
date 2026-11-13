import { describe, expect, it } from 'vitest';
import { exportFdx, exportFountain, importCau, importFdx, importFountain, normalize } from '../src/io';
import { para, project } from './fixtures';

describe('převod starších projektů', () => {
  it('formát 1 doplní o všechna nová pole', () => {
    const old = {
      format: 1,
      id: 'x',
      title: 'Starý',
      lanes: [{ id: 'l', name: 'A', color: '#000' }],
      characters: [{ id: 'c', name: 'Marta', color: '#000' }],
      beats: { b: { id: 'b', title: 'Beat', synopsis: '', script: 'INT. BYT – DEN\n\nTicho.', laneId: 'l', characterIds: [], tension: 5, status: 'idea' } },
      breaks: {},
      order: ['b'],
      links: [{ id: 'k', from: 'b', to: 'b' }],
    };
    const p = normalize(old)!;
    expect(p.format).toBe(2);
    expect(p.beats.b.paras.map((x) => x.type)).toEqual(['scene', 'action']);
    expect(p.beats.b).toMatchObject({ tagIds: [], tagLevels: {}, groupId: null, concurrent: false, off: false, versions: [] });
    expect(p.characters[0]).toMatchObject({ aliases: '', role: 'main' });
    expect(p).toMatchObject({ tags: [], groups: [], notes: [], research: [], revisions: [], targetPages: 110 });
  });

  it('odmítne cizí data', () => {
    expect(normalize({ foo: 1 })).toBeNull();
    expect(normalize(null)).toBeNull();
  });
});

describe('Final Draft', () => {
  it('export a zpětný import zachová beaty, předěly a synopse', () => {
    const p = project();
    p.titlePage.author = 'Jan Novák';
    p.add('První', { synopsis: 'Začátek.', paras: [para('scene', 'INT. BYT – DEN'), para('character', 'PETR'), para('dialogue', 'Ahoj & čau.')] });
    p.breaks.x = { id: 'x', title: 'Druhé dějství' };
    p.order.push('x');
    p.add('Druhý', { synopsis: 'Konec.', paras: [para('scene', 'EXT. ULICE – NOC'), para('action', 'Prší.')] });
    p.add('Vyřazený', { off: true, paras: [para('scene', 'INT. SKLEP – DEN')] });

    const back = importFdx(exportFdx(p), 'x.fdx');
    const items = back.order.map((id) => back.beats[id]?.title ?? `#${back.breaks[id].title}`);
    expect(items).toEqual(['První', '#Druhé Dějství', 'Druhý']);
    expect(back.order.filter((id) => back.beats[id]).map((id) => back.beats[id].synopsis)).toEqual(['Začátek.', 'Konec.']);
    expect(back.beats[back.order[0]].paras.map((x) => x.text)).toEqual(['INT. BYT – DEN', 'PETR', 'Ahoj & čau.']);
    expect(back.characters.map((c) => c.name)).toEqual(['Petr']);
  });

  it('odmítne soubor, který není Final Draft', () => {
    expect(() => importFdx('<html></html>', 'x.fdx')).toThrow();
  });
});

describe('Fountain', () => {
  it('každá scéna se stane beatem a titul se vezme z hlavičky', () => {
    const p = importFountain('Title: Můj film\n\nINT. BYT – DEN\n\nPetr vejde.\n\nEXT. ULICE – NOC\n\nPrší.', 'x.fountain');
    expect(p.title).toBe('Můj film');
    expect(p.order.map((id) => p.beats[id].title)).toEqual(['Byt', 'Ulice']);
  });

  it('export nese titulní stranu a vynechá vyřazené beaty', () => {
    const p = project();
    p.titlePage.author = 'Jan Novák';
    p.add('A', { paras: [para('action', 'Zůstane.')] });
    p.add('B', { off: true, paras: [para('action', 'Zmizí.')] });
    const text = exportFountain(p);
    expect(text).toContain('Author: Jan Novák');
    expect(text).toContain('Zůstane.');
    expect(text).not.toContain('Zmizí.');
  });
});

/** Zmenšený dokument Causality se stejnou stavbou jako skutečné soubory (formát 33). */
function cauDoc() {
  const link = (pairs: [string, string][]) => pairs.map(([id1, id2]) => ({ id1, id2 }));
  return {
    formatVersion: 33,
    objects: {
      beatObjects: {
        b1: { id: 'b1', name: 'Útěk', synopsis: ' ', beatState: 'ObjectState.Enabled' },
        b2: { id: 'b2', name: 'Honička', synopsis: '', beatState: 'ObjectState.Enabled' },
        b3: { id: 'b3', name: 'Vypuštěno', synopsis: '', beatState: 'ObjectState.Disabled' },
      },
      snippets: {
        s1: { content: '<p class="action">Běží.</p><p class="character">SARAH</p><p class="dialogue">Rychle &amp; tiše!</p>', sceneIntExt: 'INT', sceneLocation: 'CHODBA', sceneTime: 'NIGHT', forceSceneHeading: false },
        s2: { content: '<p class="action">Stále běží.</p>', sceneIntExt: 'INT', sceneLocation: 'CHODBA', sceneTime: 'NIGHT', forceSceneHeading: false },
        s3: { content: '<p class="action">Jinde.</p>', sceneIntExt: 'EXT', sceneLocation: 'DVŮR', sceneTime: '', forceSceneHeading: false },
      },
      timeslices: { t0: {}, t1: {}, t2: {}, t3: {}, tb: {} },
      episodeBreaks: { ep: { id: 'ep', title: 'Zkouška', body: '<p class="titlepagebody">by</p><p class="titlepagebody">Jana Autorka</p>', bottomLeftText: 'Contact:\nAgentura', bottomRightText: 'První verze\n1. 1.' } },
      whiteboardLanes: { lane: { id: 'lane', name: 'Main Lane', indexHint: 0 } },
      whiteboardBlocks: { blk: { id: 'blk', name: 'Útěk z ústavu', localYHint: 10, hasBaseColor: false } },
      whiteboardGroups: { grp: { id: 'grp', name: 'Chodba', localYHint: 0 } },
      beatAliases: { a1: {}, a2: {}, a3: {} },
      characters: { c1: { id: 'c1', name: 'Sarah', color: '#ffc9c91d', detectionWords: ['Sarah', 'Sarah Connor'] } },
      researchObjects: { r1: { title: '' }, rf: { title: 'Secondary Characters' } },
      beatCharacterUsages: { u1: {} },
      beatTagCategories: { cat: { id: 'cat', title: 'Dangers', indexHint: 1 } },
      beatTags: { tag: { id: 'tag', name: 'T-1000 Danger', color: '#ff1ab266', trackEmotion: true, trackTension: true, tensionWhenHigh: 1 } },
      beatTagUsages: { tu1: { emotionValue: 0.4, emotionAbsolute: true }, tu2: { emotionValue: 0.3, emotionAbsolute: false } },
      dependencyObjects: {},
      dependencyConnections: {},
    },
    objectLinks: {
      'BeatObject.timeslice': link([['b1', 't1'], ['b2', 't2'], ['b3', 't3']]),
      'BeatObject.activeSnippet': link([['b1', 's1'], ['b2', 's2'], ['b3', 's3']]),
      'EpisodeBreak.timeslice': link([['ep', 't0']]),
      'WhiteboardBlock.timeslice': link([['blk', 'tb']]),
      'WhiteboardBlock.whiteboardLane': link([['blk', 'lane']]),
      'WhiteboardGroup.whiteboardBlock': link([['grp', 'blk']]),
      'BeatAlias.beatObject': link([['a1', 'b1'], ['a2', 'b2'], ['a3', 'b3']]),
      'BeatAlias.whiteboardGroup': link([['a1', 'grp'], ['a2', 'grp']]),
      'BeatAlias.whiteboardBlock': link([['a3', 'blk']]),
      'Character.researchObject': link([['c1', 'r1']]),
      'ResearchObject.parentObject': link([['r1', 'rf']]),
      'BeatCharacterUsage.beatObject': link([['u1', 'b1']]),
      'BeatCharacterUsage.character': link([['u1', 'c1']]),
      'BeatTag.category': link([['tag', 'cat']]),
      'BeatTagUsage.beatObject': link([['tu1', 'b1'], ['tu2', 'b2']]),
      'BeatTagUsage.beatTag': link([['tu1', 'tag'], ['tu2', 'tag']]),
    },
    orderLinks: { timeslices: link([['tb', 't0'], ['t0', 't1'], ['t1', 't2'], ['t2', 't3']]) },
  };
}

describe('import z Causality', () => {
  const p = importCau(cauDoc(), 'soubor.cau');

  it('název a titulní strana z úvodní epizody', () => {
    expect(p.title).toBe('Zkouška');
    expect(p.titlePage).toMatchObject({ author: 'Jana Autorka', contact: 'Agentura', draft: 'První verze, 1. 1.' });
    expect(Object.keys(p.breaks)).toEqual([]);
  });

  it('pořadí a vyřazený beat', () => {
    expect(p.order).toEqual(['b1', 'b2', 'b3']);
    expect(p.beats.b3.off).toBe(true);
  });

  it('hlavička scény se vloží jen tam, kde se scéna změní', () => {
    expect(p.beats.b1.paras.map((x) => `${x.type}:${x.text}`)).toEqual(['scene:INT. CHODBA – NIGHT', 'action:Běží.', 'character:SARAH', 'dialogue:Rychle & tiše!']);
    expect(p.beats.b2.paras.map((x) => x.type)).toEqual(['action']);
    expect(p.beats.b3.paras[0]).toMatchObject({ type: 'scene', text: 'EXT. DVŮR' });
  });

  it('blok a vnořená skupina', () => {
    expect(p.groups).toEqual([
      expect.objectContaining({ id: 'blk', title: 'Útěk z ústavu', parentId: null }),
      expect.objectContaining({ id: 'grp', title: 'Chodba', parentId: 'blk' }),
    ]);
    expect([p.beats.b1.groupId, p.beats.b3.groupId]).toEqual(['grp', 'blk']);
  });

  it('postava s rolí podle složky a slovy pro rozpoznání', () => {
    expect(p.characters[0]).toMatchObject({ name: 'Sarah', color: '#c9c91d', role: 'secondary', aliases: 'Sarah Connor' });
    expect(p.beats.b1.characterIds).toEqual(['c1']);
  });

  it('tag s kategorií, režimem a sečtenou úrovní emoce', () => {
    expect(p.tags[0]).toMatchObject({ name: 'T-1000 Danger', category: 'Nebezpečí', mode: 'rising' });
    expect([p.beats.b1.tagLevels.tag, p.beats.b2.tagLevels.tag]).toEqual([4, 7]);
    expect(p.beats.b2.tension).toBe(7);
  });

  it('výsledek je platný projekt', () => {
    expect(normalize(JSON.parse(JSON.stringify(p)))).not.toBeNull();
  });

  it('odmítne soubor jiného tvaru', () => {
    expect(() => importCau({}, 'x.cau')).toThrow();
  });
});
