import { describe, expect, it } from 'vitest';
import { Bundle, Storybeat, assignStorybeats, bundleFromNcp, csvStoryformId, exportDramatica, exportSources, importDramatica, isNcp, mergeDramatica, orderBreaks, parseCsv, sceneFromStorybeats, sceneOf, storybeatsFromCsv, storybeatsFromJson, unassignStorybeat, unassigned } from '../src/dramatica';
import { evaluate } from '../src/evaluate';
import { appScript } from '../src/version';

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

describe('jen storybeaty (CSV)', () => {
  it('storybeaty žijí ve storyformu; scénou je nejpodrobnější úroveň, řazeno po Signpostech', () => {
    const p = importDramatica([sb('MC', 'progression', 5), sb('OS', 'progression', 2), sb('OS', 'progression', 1), sb('RS', 'progression', 1), sb('OS', 'signpost', 1, { summary: 'O čem je první část' })], 'Test');
    expect(p.lanes.map((l) => l.name)).toEqual(['A story', 'B story', 'Minizápletky']);
    expect(titles(p)).toEqual(['[1. dějství]', 'OS1', 'RS1', 'OS2', '[2. dějství]', 'MC5', '[3. dějství]', '[4. dějství]']);
    expect(p.order.map((id) => p.beats[id]?.storybeats?.[0]).filter(Boolean)).toEqual(['OS/progression/1', 'RS/progression/1', 'OS/progression/2', 'MC/progression/5']);
    // Signpost s Progresemi scénou není: čeká mezi nepřiřazenými.
    expect(unassigned(p).map((x) => x.key)).toEqual(['OS/signpost/1']);
    expect(p.groups).toEqual([]);
    expect(Object.values(p.beats).every((b) => p.lanes[0].id === b.laneId && !b.off)).toBe(true);
  });
  it('opakovaný import nesáhne na scény a text z Dramatiky nepřepíše úpravu z Fabuly', () => {
    const p = importDramatica([sb('OS', 'progression', 1, { summary: 'staré', storytelling: 'A' }), sb('OS', 'progression', 3, { storytelling: 'X' })], 'Test');
    const first = p.beats[p.order[1]];
    first.paras[0].text = 'Rozepsaná scéna.';
    first.title = 'Můj název';
    p.storyform!.beats[1].storytelling = 'X upravené ve Fabule';
    const res = mergeDramatica(p, [sb('OS', 'progression', 1, { summary: 'nové', storytelling: 'B' }), sb('OS', 'progression', 2), sb('OS', 'progression', 3, { storytelling: 'Y' })]);
    // Přibyl jeden storybeat a k němu jedna scéna.
    expect(res).toEqual({ added: 2, updated: 1, conflicts: 1 });
    expect(titles(p).slice(0, 3)).toEqual(['[1. dějství]', 'Můj název', 'OS3']);
    expect(first.paras[0].text).toBe('Rozepsaná scéna.');
    expect(p.storyform!.beats.map((x) => [x.key, x.summary, x.storytelling])).toEqual([
      ['OS/progression/1', 'nové', 'B'],
      ['OS/progression/2', '', ''],
      ['OS/progression/3', '', 'X upravené ve Fabule'],
    ]);
    expect(exportDramatica(p).map((x) => x.changed)).toEqual([false, false, true]);
  });
  it('číslo Signpostu bere ze sloupce Signpost; ze zdvojených verzí platí ta s delším textem', () => {
    const csv = [
      '"Storyform UUID","Storybeat UUID","Throughline","Scope","Signpost","Progression","Sequence","Parent UUID","Narrative Function","Summary","Storytelling"',
      '"form_X","s2a","Main Character","signpost","2","","1","","Progress","První verze","A"',
      '"form_X","s2b","Main Character","signpost","2","","2","","Progress","Druhá verze","Delší text B"',
      '"form_X","e51","Objective Story","event","4","","51","","Production","Stížnost","Text události\n\nEVA Ne."',
    ].join('\n');
    expect(csvStoryformId(csv)).toBe('form_X');
    expect(storybeatsFromCsv(csv)).toMatchObject([
      { throughline: 'MC', scope: 'signpost', sequence: 2, uuid: 's2b', summary: 'Druhá verze', storytelling: 'Delší text B' },
      { throughline: 'OS', scope: 'event', sequence: 51, storytelling: 'Text události\n\nEVA Ne.' },
    ]);
  });
  it('výpis konektoru nezamění Signposty se stejným pořadovým číslem verze', () => {
    const rows = [
      { kind: 'Storybeat', throughline: 'os', scope: 'signpost', signpost: 1, sequence: 1, summary: 'jedna' },
      { kind: 'Storybeat', throughline: 'os', scope: 'signpost', signpost: 2, sequence: 1, summary: 'dvě' },
    ];
    expect(storybeatsFromJson(rows).map((x) => [x.sequence, x.summary])).toEqual([[1, 'jedna'], [2, 'dvě']]);
  });
});

describe('Momenty a splétání', () => {
  const moment = (id: string, act: number, order: number, storybeats: string[] = [], synopsis = ''): Bundle['moments'][number] => ({ id, title: id, synopsis, text: '', act, order, storybeats });
  const bundle = (): Bundle => ({
    storybeats: [sb('OS', 'signpost', 1), sb('OS', 'progression', 1), sb('MC', 'event', 1), sb('RS', 'signpost', 2), sb('IC', 'signpost', 3), sb('OS', 'signpost', 4), sb('OS', 'progression', 9)],
    moments: [moment('Zlom', 2, 1, ['RS/signpost/2']), moment('Příjezd', 1, 2, ['OS/progression/1', 'MC/event/1'], 'Sanitka.'), moment('Úvod', 1, 1), moment('Pád', 3, 1, ['IC/signpost/3']), moment('Finále', 3, 2, ['OS/signpost/4'])],
    drivers: [0, 1, 2, 3, 4].map((index) => ({ id: `d${index}`, index, summary: '', storytelling: `Driver ${index}` })),
    players: [],
    notes: [],
    storyformId: 'form_A',
  });
  const scene = (p: ReturnType<typeof importDramatica>, title: string) => Object.values(p.beats).find((b) => b.title === title)!;

  it('scéna je jedna karta a storybeaty jsou její štítky; nepřiřazené nejsou na tabuli', () => {
    const p = importDramatica(bundle(), 'x');
    // Dějství 3 nese Signposty 3 i 4, takže Midpoint uzavírá 2. dějství a Fourth Driver stojí uprostřed třetího.
    expect(p.storyform!.signpostAct).toEqual([1, 2, 3, 3]);
    expect(titles(p)).toEqual([
      '[1. dějství]', 'Initial Story Driver', 'Úvod', 'Příjezd', 'Second Story Driver',
      '[2. dějství]', 'Zlom', 'Midpoint Story Driver',
      '[3. dějství]', 'Pád', 'Fourth Story Driver', 'Finále', 'Concluding Story Driver',
    ]);
    expect(scene(p, 'Příjezd')).toMatchObject({ synopsis: 'Sanitka.', storybeats: ['OS/progression/1', 'MC/event/1'], source: { kind: 'moment' } });
    expect(unassigned(p).map((x) => x.key)).toEqual(['OS/signpost/1', 'OS/progression/9']);
    expect(Object.values(p.beats)).toHaveLength(10);
    expect(Object.values(p.beats).every((b) => !b.off && b.laneId === p.lanes[0].id)).toBe(true);
    expect(p.groups).toEqual([]);
  });
  it('přiřazení, přesun mezi scénami, vyjmutí a nová scéna ze storybeatů', () => {
    const p = importDramatica(bundle(), 'x');
    assignStorybeats(p, scene(p, 'Úvod').id, ['OS/signpost/1', 'MC/event/1', 'nesmysl']);
    expect(scene(p, 'Úvod').storybeats).toEqual(['OS/signpost/1', 'MC/event/1']);
    expect(scene(p, 'Příjezd').storybeats).toEqual(['OS/progression/1']);
    expect(sceneOf(p, 'MC/event/1')!.title).toBe('Úvod');
    unassignStorybeat(p, 'MC/event/1');
    expect(unassigned(p).map((x) => x.key)).toEqual(['OS/progression/9', 'MC/event/1']);
    const made = sceneFromStorybeats(p, ['OS/progression/9'], scene(p, 'Zlom').id)!;
    expect(titles(p).slice(5, 8)).toEqual(['[2. dějství]', 'Zlom', 'OS9']);
    expect(p.beats[made].storybeats).toEqual(['OS/progression/9']);
  });
  it('přehozené pořadí uvnitř throughline ohlásí kontrola příběhu', () => {
    const p = importDramatica(bundle(), 'x');
    expect(orderBreaks(p)).toEqual([]);
    assignStorybeats(p, scene(p, 'Zlom').id, ['OS/signpost/1']);
    assignStorybeats(p, scene(p, 'Úvod').id, ['OS/signpost/4']);
    expect(orderBreaks(p)).toMatchObject([{ first: scene(p, 'Úvod').id, second: scene(p, 'Zlom').id, earlier: { key: 'OS/signpost/1' }, later: { key: 'OS/signpost/4' } }]);
    expect(evaluate(p).some((i) => i.key === 'weave:OS/signpost/1' && i.message.includes('OS S1'))).toBe(true);
  });
  it('opakovaný import respektuje splétání z Fabuly i přejmenované a smazané předěly', () => {
    const p = importDramatica(bundle(), 'x');
    assignStorybeats(p, scene(p, 'Úvod').id, ['MC/event/1']);
    p.breaks[p.storyform!.acts[1]].title = 'Expozice';
    const b = bundle();
    b.moments.push(moment('Nový', 1, 3, ['OS/progression/9']));
    expect(mergeDramatica(p, b)).toEqual({ added: 1, updated: 0, conflicts: 0 });
    expect(scene(p, 'Úvod').storybeats).toEqual(['MC/event/1']);
    expect(scene(p, 'Příjezd').storybeats).toEqual(['OS/progression/1']);
    expect(titles(p).slice(0, 6)).toEqual(['[Expozice]', 'Initial Story Driver', 'Úvod', 'Příjezd', 'Second Story Driver', 'Nový']);
    const before = [...p.order];
    expect(mergeDramatica(p, b)).toEqual({ added: 0, updated: 0, conflicts: 0 });
    expect(p.order).toEqual(before);
    // Smazaný předěl dějství import nezhroutí: založí se znovu před dalším dějstvím.
    const second = p.storyform!.acts[2];
    p.order.splice(p.order.indexOf(second), 1);
    delete p.breaks[second];
    b.moments.push(moment('Další', 2, 5));
    expect(mergeDramatica(p, b).added).toBe(1);
    expect(titles(p).filter((t) => t.startsWith('['))).toEqual(['[Expozice]', '[2. dějství]', '[3. dějství]']);
    expect(titles(p).indexOf('Další')).toBe(titles(p).indexOf('[2. dějství]') + 1);
  });
  it('export nese pořadí scén, jejich storybeaty a identifikátor storyformu', () => {
    const p = importDramatica(bundle(), 'x');
    const out = exportSources(p);
    expect(out.map((x) => x.title)).toEqual(['Initial Story Driver', 'Úvod', 'Příjezd', 'Second Story Driver', 'Zlom', 'Midpoint Story Driver', 'Pád', 'Fourth Story Driver', 'Finále', 'Concluding Story Driver']);
    expect(out[2].storybeats).toEqual(['OS/progression/1', 'MC/event/1']);
    const beats = exportDramatica(p);
    expect(beats.find((x) => x.scope === 'event')).toMatchObject({ storyform: 'form_A', plotOrder: 2, scene: 'Příjezd', changed: false });
    expect(beats.filter((x) => x.plotOrder === null).map((x) => x.sequence)).toEqual([1, 9]);
  });
});

describe('soubor NCP', () => {
  const ncp = {
    story: { title: 'Příběh' },
    payloads: {
      'dramatica-project:': {
        stories: [
          {
            moments: [
              { id: 'm0', act: 1, order: 1, summary: 'Untitled', synopsis: '', setting: '', timing: '', imperatives: '', storybeats: [{ storybeat_id: 'neznámý' }] },
              { id: 'm2', act: 1, order: 3, summary: 'V sanitce', synopsis: 'Jedou mlčky.', setting: 'Sanitka', timing: 'Ráno', imperatives: '', storybeats: [{ sequence: 1, narrative_id: 'narrative_form_Z', storybeat_id: 'o1' }, { sequence: 0, storybeat_id: 'e1' }] },
              { id: 't1', act: 2, order: 1, summary: 'One Last Push', synopsis: '', setting: '', timing: '', imperatives: '', storybeats: [{ storybeat_id: 's2' }] },
              { id: 't2', act: 2, order: 1, summary: 'One Last Push', synopsis: '', setting: '', timing: '', imperatives: '', storybeats: [{ storybeat_id: 's2' }] },
            ],
          },
        ],
        storyforms: [
          {
            id: 'form_Z',
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
                  { id: 'd5', dynamic: 'main_character_approach', vector: 'do_er', summary: '', storytelling: '' },
                  { id: 'd2', dynamic: 'initial_story_driver', vector: 'Action', summary: 'Uklízečka najde muže.', storytelling: 'Nad ránem…' },
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
  it('pozná formát, vezme i šablonové Momenty a zdvojené sloučí', () => {
    expect(isNcp(ncp)).toBe(true);
    expect(isNcp({ format: 2 })).toBe(false);
    expect(bundle.title).toBe('Příběh');
    expect(bundle.moments).toMatchObject([
      { id: 'm2', title: 'V sanitce', text: 'Místo: Sanitka\nČas: Ráno', storybeats: ['MC/event/1', 'OS/progression/1'] },
      { id: 't1', title: 'One Last Push', act: 2, storybeats: ['OS/signpost/2'] },
    ]);
    expect(bundle.storyformId).toBe('form_Z');
    expect(bundle.drivers.map((d) => d.index)).toEqual([0]);
  });
  it('dvě řady Momentů pod jedním číslem dějství se rozdělí podle Signpostů', () => {
    const copy = structuredClone(ncp) as any;
    const pr = copy.payloads['dramatica-project:'];
    pr.storyforms[0].narrative.subtext.storybeats.push(
      { id: 'i3', throughline: 'Influence Character', scope: 'signpost', signpost: 3, sequence: 3, narrative_function: 'Subconscious', summary: '', storytelling: '' },
      { id: 'i4', throughline: 'Influence Character', scope: 'signpost', signpost: 4, sequence: 4, narrative_function: 'Conscious', summary: '', storytelling: '' },
    );
    const m = (id: string, order: number, title: string, link?: string) => ({ id, act: 3, order, summary: title, synopsis: '', setting: '', timing: '', imperatives: '', storybeats: link ? [{ storybeat_id: link }] : [] });
    pr.stories[0].moments.push(m('a0', 0, 'Emerging'), m('b0', 0, 'No-Return'), m('a1', 1, 'Nudge', 'i3'), m('b1', 1, 'Last Push', 'i4'), m('a2', 2, 'Game-Changing'));
    const b = bundleFromNcp(copy);
    expect(b.moments.filter((x) => x.act >= 3).map((x) => `${x.act}:${x.title}`)).toEqual(['3:Emerging', '3:Nudge', '3:Game-Changing', '4:No-Return', '4:Last Push']);
  });
  it('postaví tabuli, obsazení, rešerši i storyform', () => {
    const p = importDramatica(bundle, 'x');
    expect(titles(p)).toEqual(['[1. dějství]', 'Initial Story Driver', 'V sanitce', '[2. dějství]', 'One Last Push']);
    expect(Object.values(p.beats).find((b) => b.title === 'V sanitce')!.storybeats).toEqual(['MC/event/1', 'OS/progression/1']);
    expect(p.characters.map((c) => [c.name, c.role, c.aliases])).toEqual([['Eva Horáková', 'main', 'Eva'], ['Zuzana', 'secondary', ''], ['Jan Veselý', 'small', 'Jan']]);
    expect(p.research.map((r) => `${r.folder}/${r.title}`)).toEqual(['Postavy/Eva Horáková', 'Postavy/Zuzana', 'Dramatica/Logline']);
    expect(p.storyform!.points).toEqual([
      { throughline: '', name: 'Story Goal', fn: 'Understanding', summary: 'Pochopit domov.', text: '' },
      { throughline: 'MC', name: 'Problem', fn: 'Inequity', summary: 'Vina.', text: 'Podrobně.' },
    ]);
    expect(p.storyform!.id).toBe('form_Z');
    expect(p.storyform!.dynamics).toEqual([
      { name: 'Story Outcome', value: 'Failure', summary: 'Režim přežije.' },
      { name: 'Main Character Approach', value: 'Do-er', summary: '' },
    ]);
  });
});

describe('oznámení o nové verzi', () => {
  it('pozná soubor aplikace na stránce i ve vlastní adrese', () => {
    expect(appScript('<script type="module" crossorigin src="./assets/index-8-95dYeL.js"></script>')).toBe('assets/index-8-95dYeL.js');
    expect(appScript('https://x.github.io/Fabula/assets/index-DYym1zeO.js')).toBe('assets/index-DYym1zeO.js');
    expect(appScript('<html></html>')).toBeNull();
  });
});

import { appendDraft, draftToParas, pointId, pointsOf, scenesOfPoint, togglePoint, weave } from '../src/dramatica';

describe('splétání, storypointy u scén a převod textu', () => {
  const make = () => {
    const beats = [sb('OS', 'signpost', 1), sb('OS', 'signpost', 2), sb('OS', 'signpost', 4), sb('MC', 'signpost', 1), sb('MC', 'signpost', 2)];
    const moments = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, title: `Scéna ${i}`, synopsis: '', text: '', act: 1, order: i, storybeats: [] as string[] }));
    moments[0].storybeats = ['OS/signpost/1', 'MC/signpost/1'];
    moments[1].storybeats = ['OS/signpost/2'];
    moments[11].storybeats = ['OS/signpost/4'];
    const p = importDramatica({ storybeats: beats, moments, drivers: [], players: [], notes: [], storyform: { dynamics: [], points: [{ throughline: 'MC', name: 'Problem', fn: 'Inequity', summary: 'Vina.', text: '' }, { throughline: '', name: 'Story Goal', fn: 'Understanding', summary: '', text: '' }] } }, 'x');
    return p;
  };
  const id = (p: ReturnType<typeof make>, n: number) => Object.values(p.beats).find((b) => b.title === `Scéna ${n}`)!.id;

  it('najde, kde throughline leží, kde dlouho mlčí a který Signpost chybí', () => {
    const p = make();
    const w = weave(p);
    expect([...w.rows.OS.keys()]).toEqual([id(p, 0), id(p, 1), id(p, 11)]);
    expect(w.spans.filter((x) => x.throughline === 'OS').map((x) => x.signpost)).toEqual([1, 2, 4]);
    expect(w.gaps).toEqual([{ throughline: 'OS', from: id(p, 1), to: id(p, 11), scenes: 9 }]);
    // OS nemá Signpost 3 ve storyformu vůbec, takže nechybí; MC má Signpost 2 a ve scéně není.
    expect(w.missing).toEqual([{ throughline: 'MC', signposts: [2] }]);
    const messages = evaluate(p).map((i) => i.message);
    expect(messages.some((m) => m.includes('Objective Story mlčí 9 scén'))).toBe(true);
    expect(messages.some((m) => m.includes('Main Character: v žádné scéně zatím není nic ze Signpostu 2'))).toBe(true);
  });
  it('storypoint jde připnout k více scénám a zase odepnout', () => {
    const p = make();
    const problem = pointId(p.storyform!.points[0]);
    expect([problem, pointId(p.storyform!.points[1])]).toEqual(['MC/Problem', 'ST/Story Goal']);
    togglePoint(p, id(p, 3), problem);
    togglePoint(p, id(p, 1), problem);
    expect(scenesOfPoint(p, problem).map((b) => b.title)).toEqual(['Scéna 1', 'Scéna 3']);
    expect(pointsOf(p, p.beats[id(p, 3)]).map((x) => x.name)).toEqual(['Problem']);
    togglePoint(p, id(p, 3), problem);
    expect(scenesOfPoint(p, problem).map((b) => b.title)).toEqual(['Scéna 1']);
  });
  it('rozepsaný text převede na hlavičku, akci a repliky', () => {
    const text = 'INT. JÍDELNA – DEN\n\nCibulka ochutná čaj. Podívá se do hrnku.\n\nCIBULKA\nČaj je studený.\n\nZUZANA Máte připravenou výbavu?\n\nEVA Ne.\n\nOběd. Jídelna plná drobných zvuků.';
    expect(draftToParas(text).map((x) => `${x.type}:${x.text}`)).toEqual([
      'scene:INT. JÍDELNA – DEN',
      'action:Cibulka ochutná čaj. Podívá se do hrnku.',
      'character:CIBULKA',
      'dialogue:Čaj je studený.',
      'character:ZUZANA',
      'dialogue:Máte připravenou výbavu?',
      'character:EVA',
      'dialogue:Ne.',
      'action:Oběd. Jídelna plná drobných zvuků.',
    ]);
    const p = make();
    expect(appendDraft(p, id(p, 0), 'EVA\nNe.')).toBe(2);
    expect(p.beats[id(p, 0)]).toMatchObject({ status: 'draft', paras: [{ type: 'character', text: 'EVA' }, { type: 'dialogue', text: 'Ne.' }] });
    expect(appendDraft(p, id(p, 0), 'Ticho.')).toBe(1);
    expect(p.beats[id(p, 0)].paras).toHaveLength(3);
  });
});
