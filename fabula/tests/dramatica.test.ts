import { describe, expect, it } from 'vitest';
import { exportDramatica, importDramatica, mergeDramatica, parseCsv, storybeatsFromCsv, storybeatsFromJson, Storybeat } from '../src/dramatica';

const sb = (throughline: Storybeat['throughline'], scope: Storybeat['scope'], sequence: number, patch: Partial<Storybeat> = {}): Storybeat => ({
  throughline,
  scope,
  sequence,
  fn: `${throughline}${sequence}`,
  summary: '',
  storytelling: '',
  plotOrder: null,
  moments: [],
  ...patch,
});
const titles = (p: ReturnType<typeof importDramatica>) => p.order.map((id) => p.beats[id]?.title ?? `[${p.breaks[id].title}]`);

describe('CSV', () => {
  it('čte uvozovky, oddělovač v textu i víceřádkové buňky', () => {
    expect(parseCsv('a;b\n"x;1";"dva\nřádky ""tady"""\n')).toEqual([['a', 'b'], ['x;1', 'dva\nřádky "tady"']]);
  });
  it('pozná sloupce podle názvů a storybeat podle popisku', () => {
    const csv = 'Storybeat,Narrative Function,Summary,Storytelling\n"Objective Story Progression 13",Prerequisites,"Krátce","Dlouze, s čárkou"\nMain Character Signpost 2,Progress,,\nnesmysl,,,\n';
    expect(storybeatsFromCsv(csv)).toMatchObject([
      { throughline: 'OS', scope: 'progression', sequence: 13, fn: 'Prerequisites', summary: 'Krátce', storytelling: 'Dlouze, s čárkou' },
      { throughline: 'MC', scope: 'signpost', sequence: 2, fn: 'Progress' },
    ]);
  });
  it('pozná i oddělené sloupce throughline, úroveň a pořadí', () => {
    const csv = 'Throughline;Scope;Sequence;Plot Order;Moment\nRelationship Story;Event;33;7;Na chodbě\n';
    expect(storybeatsFromCsv(csv)).toMatchObject([{ throughline: 'RS', scope: 'event', sequence: 33, plotOrder: 7, moments: ['Na chodbě'] }]);
  });
});

describe('výpis konektoru', () => {
  it('najde storybeaty kdekoli ve struktuře', () => {
    const data = { results: [{ structuredContent: { storyform_memory: { components: [
      { kind: 'Storybeat', uuid: 'u1', throughline: 'ic', scope: 'progression', sequence: 14, plot_order: null, summary: 'S', storytelling: 'T', narrative_function: { name: 'Appraisal' } },
      { kind: 'Player', name: 'Eva' },
    ] } } }] };
    expect(storybeatsFromJson(data)).toEqual([sb('IC', 'progression', 14, { uuid: 'u1', fn: 'Appraisal', summary: 'S', storytelling: 'T' })]);
  });
});

describe('import do Fabuly', () => {
  it('každá throughline má linii, Signposty jsou předěly a pořadí jde napříč throughlines', () => {
    const p = importDramatica([sb('MC', 'progression', 5), sb('OS', 'progression', 2), sb('OS', 'progression', 1), sb('MC', 'progression', 1), sb('RS', 'signpost', 1)], 'Test');
    expect(p.lanes.map((l) => l.name)).toEqual(['Objective Story', 'Main Character', 'Influence Character', 'Relationship Story']);
    expect(titles(p)).toEqual(['[Signpost 1]', 'OS1', 'MC1', 'RS1', 'OS2', '[Signpost 2]', 'MC5']);
    expect(p.beats[p.order[1]].laneId).toBe(p.lanes[0].id);
  });
  it('pořadí z Dramatiky má přednost', () => {
    const p = importDramatica([sb('OS', 'progression', 1, { plotOrder: 9 }), sb('MC', 'progression', 2, { plotOrder: 3 }), sb('IC', 'progression', 1)], 'Test');
    expect(titles(p)).toEqual(['[Signpost 1]', 'MC2', 'OS1', 'IC1']);
  });
  it('Signpost s Progresemi není kartou, jeho text jde do rešerše', () => {
    const p = importDramatica([sb('OS', 'signpost', 1, { fn: 'Understanding', summary: 'O čem je první část' }), ...[1, 2, 3, 4].map((n) => sb('OS', 'progression', n))], 'Test');
    expect(titles(p)).toEqual(['[Signpost 1]', 'OS1', 'OS2', 'OS3', 'OS4']);
    expect(p.groups.map((g) => g.title)).toEqual(['OS 1 · Understanding']);
    expect(p.beats[p.order[1]].groupId).toBe(p.groups[0].id);
    expect(p.research).toMatchObject([{ folder: 'Dramatica', title: 'Objective Story · Signpost 1 · Understanding', text: 'O čem je první část', beatIds: p.order.slice(1) }]);
  });
  it('opakovaný import doplní změny a nesáhne na scénář ani na vlastní název', () => {
    const p = importDramatica([sb('OS', 'progression', 1, { summary: 'staré' }), sb('OS', 'progression', 3)], 'Test');
    const first = p.beats[p.order[1]];
    first.paras[0].text = 'Rozepsaná scéna.';
    p.beats[p.order[2]].title = 'Můj název';
    const res = mergeDramatica(p, [sb('OS', 'progression', 1, { summary: 'nové', moments: ['Příjezd'] }), sb('OS', 'progression', 2), sb('OS', 'progression', 3)]);
    expect(res).toEqual({ added: 1, updated: 1 });
    expect(titles(p)).toEqual(['[Signpost 1]', 'OS1', 'OS2', 'Můj název']);
    expect(first).toMatchObject({ synopsis: 'nové', paras: [{ text: 'Rozepsaná scéna.' }] });
    expect(p.tags).toMatchObject([{ name: 'Příjezd', category: 'Momenty' }]);
  });
  it('export vrátí synopse a Storytelling v pořadí vyprávění', () => {
    const p = importDramatica([sb('MC', 'progression', 1, { uuid: 'u', storytelling: 'T' }), sb('OS', 'progression', 1)], 'Test');
    p.beats[p.order[2]].synopsis = 'Upraveno ve Fabule';
    expect(exportDramatica(p)).toMatchObject([
      { throughline: 'OS', sequence: 1, plotOrder: 1 },
      { uuid: 'u', throughline: 'MC', summary: 'Upraveno ve Fabule', storytelling: 'T', plotOrder: 2 },
    ]);
  });
});

describe('export z Plot Progression', () => {
  const csv = [
    '"Storyform UUID","Storybeat UUID","Throughline","Scope","Signpost","Progression","Sequence","Parent UUID","Narrative Function","Summary","Storytelling"',
    '"f","s2a","Main Character","signpost","2","","1","","Progress","První verze","Dlouze A"',
    '"f","s2b","Main Character","signpost","2","","2","","Progress","Druhá verze","Dlouze B"',
    '"f","p13","Objective Story","progression","4","13","13","","Prerequisites","Policie","Text progrese"',
    '"f","e51","Objective Story","event","4","","51","","Production","Stížnost","Text události\n\nEVA Ne."',
    '"f","p14","Objective Story","progression","4","14","14","","Strategy","",""',
    '"f","e1","Main Character","event","1","1","1","p1","Knowledge","Sanitka",""',
    '"f","p1","Main Character","progression","1","1","1","s1","Fate","Příjezd",""',
    '"f","e2","Main Character","event","1","1","2","p1","A","",""',
    '"f","e3","Main Character","event","1","1","3","p1","B","",""',
    '"f","e4","Main Character","event","1","1","4","p1","C","",""',
  ].join('\n');
  const all = storybeatsFromCsv(csv);
  it('číslo Signpostu bere ze sloupce Signpost a duplicitní verze sloučí', () => {
    expect(all.filter((x) => x.scope === 'signpost')).toMatchObject([{ throughline: 'MC', sequence: 2, uuid: 's2a', summary: 'První verze', storytelling: 'Dlouze A\n\n———\n\nDlouze B' }]);
  });
  it('kartou je nejpodrobnější úroveň; Progrese s úplnými Událostmi je jen skupina', () => {
    const p = importDramatica(all, 'Test');
    expect(titles(p)).toEqual(['[Signpost 1]', 'Knowledge', 'A', 'B', 'C', '[Signpost 2]', 'Progress', '[Signpost 4]', 'Prerequisites', 'Production', 'Strategy']);
    const g = (id: string) => p.groups.find((x) => x.id === p.beats[id].groupId)!;
    expect(g(p.order[1]).title).toBe('MC P1 · Fate');
    expect(p.groups.find((x) => x.id === g(p.order[1]).parentId)!.title).toBe('MC 1');
    expect(g(p.order[8]).title).toBe('OS 4');
    expect(g(p.order[9]).title).toBe('OS P13 · Prerequisites');
    expect(p.research.map((r) => r.title)).toEqual(['Main Character · Progression 1 · Fate']);
    expect(p.beats[p.order[9]].dramatica).toMatchObject({ uuid: 'e51', storytelling: 'Text události\n\nEVA Ne.' });
  });
});

import { bundleFromNcp, exportSources, isNcp, linkScene, throughlineOf } from '../src/dramatica';
import { appScript } from '../src/version';

describe('soubor NCP', () => {
  const ncp = {
    story: { title: 'Příběh' },
    payloads: {
      'dramatica-project:': {
        stories: [
          {
            moments: [
              { id: 'm0', act: 1, order: 1, summary: 'Untitled', synopsis: '', setting: '', timing: '', imperatives: '', storybeats: [] },
              { id: 'm2', act: 1, order: 3, summary: 'V sanitce', synopsis: 'Jedou mlčky.', setting: 'Sanitka', timing: 'Ráno', imperatives: '', storybeats: [{ storybeat_id: 'e1' }] },
              { id: 'm1', act: 1, order: 2, summary: 'Krajina', synopsis: 'Mlha.', setting: '', timing: '', imperatives: '', storybeats: [] },
              { id: 'm3', act: 1, order: 4, summary: 'Brána', synopsis: 'Projedou.', setting: '', timing: '', imperatives: '', storybeats: [] },
              { id: 'm9', act: 3, order: 1, summary: 'Konec', synopsis: 'Terasa.', setting: '', timing: '', imperatives: '', storybeats: [] },
              { id: 't', act: 2, order: 1, summary: 'Turning Up the Pressure', synopsis: '', setting: '', timing: '', imperatives: '', storybeats: [{ storybeat_id: 's2' }] },
            ],
          },
        ],
        storyforms: [
          {
            narrative: {
              storytelling: { overviews: { 0: { label: 'Logline', summary: '', storytelling: 'Bývalá zapisovatelka…' } } },
              subtext: {
                storybeats: [
                  { id: 'e1', throughline: 'Main Character', scope: 'event', signpost: 1, sequence: 1, narrative_function: 'Knowledge', summary: 'Sanitka', storytelling: 'Dlouze' },
                  { id: 'o1', throughline: 'Objective Story', scope: 'progression', signpost: 1, sequence: 1, narrative_function: 'Instinct', summary: '', storytelling: '' },
                  { id: 's2', throughline: 'Objective Story', scope: 'signpost', signpost: 2, sequence: 1, narrative_function: 'Doing', summary: '', storytelling: '' },
                ],
                dynamics: [
                  { id: 'd1', dynamic: 'story_outcome', vector: 'failure', summary: 'Režim přežije.', storytelling: '' },
                  { id: 'd2', dynamic: 'initial_story_driver', vector: 'Action', summary: 'Uklízečka najde muže.', storytelling: 'Nad ránem…' },
                  { id: 'd3', dynamic: 'midpoint_story_driver', vector: 'Action', summary: 'Odhalení.', storytelling: '' },
                  { id: 'd4', dynamic: 'fourth_story_driver', vector: 'Action', summary: '', storytelling: '' },
                ],
                storypoints: [
                  { id: 'p1', appreciation: 'Story Goal', narrative_function: 'Understanding', summary: 'Pochopit domov.', storytelling: '' },
                  { id: 'p2', throughline: 'Main Character', appreciation: 'Main Character Problem', narrative_function: 'Inequity', summary: 'Vina.', storytelling: 'Podrobně.' },
                ],
                players: [
                  { id: 'x', name: 'Eva Horáková', role: 'Protagonista, MC', bio: 'Zapisovatelka.', visual: 'drobná', motivations: [{ narrative_function: 'Pursuit', illustration: 'jde za pravdou', storytelling: '' }] },
                  { id: 'y', name: 'Zuzana', role: 'Contagonist' },
                  { id: 'z', name: 'Jan Veselý', role: '' },
                ],
              },
            },
          },
        ],
      },
    },
  };
  const bundle = bundleFromNcp(ncp);
  it('pozná formát a vynechá prázdné předpřipravené Momenty', () => {
    expect(isNcp(ncp)).toBe(true);
    expect(isNcp({ format: 2 })).toBe(false);
    expect(bundle.title).toBe('Příběh');
    expect(bundle.moments.map((m) => m.id)).toEqual(['m2', 'm1', 'm3', 'm9']);
    expect(bundle.moments[0]).toMatchObject({ storybeat: 'MC/event/1', text: 'Místo: Sanitka\nČas: Ráno' });
    expect(bundle.drivers.map((d) => d.index)).toEqual([0, 2]);
  });
  it('scény jdou v pořadí Momentů, Drivery na hranice Signpostů', () => {
    const p = importDramatica(bundle, 'x');
    expect(titles(p)).toEqual([
      '[Signpost 1]', 'Initial Story Driver', 'Krajina', 'Instinct', 'V sanitce', 'Brána',
      '[Signpost 2]', 'Doing', 'Midpoint Story Driver',
      '[Signpost 3]',
      '[Signpost 4]', 'Konec',
    ]);
    const lane = (i: number) => p.lanes.find((l) => l.id === p.beats[p.order[i]].laneId)!.name;
    expect([lane(1), lane(2), lane(4), lane(5)]).toEqual(['Objective Story', 'Scény', 'Main Character', 'Scény']);
    // Jediný Moment storybeatu splyne s jeho kartou: název a synopse scény, Storytelling storybeatu.
    expect(p.beats[p.order[4]]).toMatchObject({ synopsis: 'Jedou mlčky.', dramatica: { uuid: 'e1', storytelling: 'Dlouze' }, source: { id: 'm2', kind: 'moment' } });
    expect(p.beats[p.order[1]].source).toMatchObject({ kind: 'driver', text: 'Nad ránem…' });
  });
  it('postavy jdou do obsazení, storypointy a dynamika do rešerše', () => {
    const p = importDramatica(bundle, 'x');
    expect(p.characters.map((c) => [c.name, c.role, c.aliases])).toEqual([['Eva Horáková', 'main', 'Eva'], ['Zuzana', 'secondary', ''], ['Jan Veselý', 'small', 'Jan']]);
    expect(p.research.map((r) => `${r.folder}/${r.title}`)).toEqual(['Postavy/Eva Horáková', 'Postavy/Zuzana', 'Dramatica/Logline']);
    expect(p.storyform!.points).toEqual([
      { throughline: '', name: 'Story Goal', fn: 'Understanding', summary: 'Pochopit domov.', text: '' },
      { throughline: 'MC', name: 'Problem', fn: 'Inequity', summary: 'Vina.', text: 'Podrobně.' },
    ]);
    expect(p.storyform!.dynamics).toEqual([{ name: 'Story Outcome', value: 'Failure', summary: 'Režim přežije.' }]);
    expect(p.storyform!.beats.map((x) => x.key)).toEqual(['OS/progression/1', 'OS/signpost/2', 'MC/event/1']);
  });
  it('scénu jde přiřadit ke storybeatu: přejde do jeho linie a skupiny', () => {
    const p = importDramatica(bundle, 'x');
    const scene = p.order.map((id) => p.beats[id]).find((b) => b?.title === 'Brána')!;
    linkScene(p, scene.id, 'OS/progression/1');
    expect(p.lanes.find((l) => l.id === scene.laneId)!.name).toBe('Objective Story');
    expect(p.groups.find((g) => g.id === scene.groupId)!.title).toBe('OS 1');
    expect(throughlineOf(p, scene)).toBe('OS');
    expect(exportSources(p).find((x) => x.id === 'm3')!.storybeat).toBe('o1');
    linkScene(p, scene.id, null);
    expect(scene.storybeat).toBeUndefined();
  });
  it('opakovaný import nic nezdvojí a export vrátí pořadí scén', () => {
    const p = importDramatica(bundle, 'x');
    const before = p.order.length;
    expect(mergeDramatica(p, bundle).added).toBe(0);
    expect([p.order.length, p.characters.length, p.research.length]).toEqual([before, 3, 3]);
    expect(exportSources(p).map((x) => x.id)).toEqual(['d2', 'm1', 'm2', 'm3', 'd3', 'm9']);
  });
});

describe('oznámení o nové verzi', () => {
  it('pozná soubor aplikace na stránce i ve vlastní adrese', () => {
    expect(appScript('<script type="module" crossorigin src="./assets/index-8-95dYeL.js"></script>')).toBe('assets/index-8-95dYeL.js');
    expect(appScript('https://x.github.io/Fabula/assets/index-DYym1zeO.js')).toBe('assets/index-DYym1zeO.js');
    expect(appScript('<html></html>')).toBeNull();
  });
});
