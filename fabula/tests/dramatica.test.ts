import { describe, expect, it } from 'vitest';
import { Bundle, Storybeat, assignMoment, bundleFromNcp, exportDramatica, exportSources, importDramatica, isNcp, mergeDramatica, momentCards, momentOf, parseCsv, storybeatTag, storybeatsFromCsv, storybeatsFromJson } from '../src/dramatica';
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
  it('dějové linie místo throughlines, Signposty jako předěly, pořadí napříč throughlines', () => {
    const p = importDramatica([sb('MC', 'progression', 5), sb('OS', 'progression', 2), sb('OS', 'progression', 1), sb('RS', 'progression', 1), sb('IC', 'signpost', 1)], 'Test');
    expect(p.lanes.map((l) => l.name)).toEqual(['A story', 'B story', 'Minizápletky']);
    expect(titles(p)).toEqual(['[Signpost 1]', 'OS1', 'IC1', 'RS1', 'OS2', '[Signpost 2]', 'MC5']);
    const lane = (i: number) => p.lanes.find((l) => l.id === p.beats[p.order[i]].laneId)!.name;
    expect([lane(1), lane(2), lane(3), lane(6)]).toEqual(['A story', 'B story', 'B story', 'A story']);
    expect(p.groups).toEqual([]);
    expect(storybeatTag(p.beats[p.order[1]].dramatica!)).toBe('OS P1');
  });
  it('kartou je nejpodrobnější úroveň; text nadřazené jde do rešerše', () => {
    const p = importDramatica([sb('OS', 'signpost', 1, { fn: 'Understanding', summary: 'O čem je první část' }), ...[1, 2, 3, 4].map((n) => sb('OS', 'progression', n))], 'Test');
    expect(titles(p)).toEqual(['[Signpost 1]', 'OS1', 'OS2', 'OS3', 'OS4']);
    expect(p.research).toMatchObject([{ folder: 'Dramatica', title: 'Objective Story · Signpost 1 · Understanding', text: 'O čem je první část' }]);
  });
  it('opakovaný import doplní změny a nesáhne na scénář ani na vlastní název', () => {
    const p = importDramatica([sb('OS', 'progression', 1, { summary: 'staré' }), sb('OS', 'progression', 3)], 'Test');
    const first = p.beats[p.order[1]];
    first.paras[0].text = 'Rozepsaná scéna.';
    p.beats[p.order[2]].title = 'Můj název';
    expect(mergeDramatica(p, [sb('OS', 'progression', 1, { summary: 'nové' }), sb('OS', 'progression', 2), sb('OS', 'progression', 3)])).toEqual({ added: 1, updated: 1 });
    expect(titles(p)).toEqual(['[Signpost 1]', 'OS1', 'OS2', 'Můj název']);
    expect(first).toMatchObject({ synopsis: 'nové', paras: [{ text: 'Rozepsaná scéna.' }] });
  });
  it('číslo Signpostu bere ze sloupce Signpost a duplicitní verze sloučí', () => {
    const csv = [
      '"Storyform UUID","Storybeat UUID","Throughline","Scope","Signpost","Progression","Sequence","Parent UUID","Narrative Function","Summary","Storytelling"',
      '"f","s2a","Main Character","signpost","2","","1","","Progress","První verze","Dlouze A"',
      '"f","s2b","Main Character","signpost","2","","2","","Progress","Druhá verze","Dlouze B"',
      '"f","e51","Objective Story","event","4","","51","","Production","Stížnost","Text události\n\nEVA Ne."',
    ].join('\n');
    expect(storybeatsFromCsv(csv)).toMatchObject([
      { throughline: 'MC', scope: 'signpost', sequence: 2, uuid: 's2a', summary: 'První verze', storytelling: 'Dlouze A\n\n———\n\nDlouze B' },
      { throughline: 'OS', scope: 'event', sequence: 51, storytelling: 'Text události\n\nEVA Ne.' },
    ]);
  });
});

describe('Momenty', () => {
  const moment = (id: string, act: number, order: number, storybeats: string[] = [], synopsis = ''): Bundle['moments'][number] => ({ id, title: id, synopsis, text: '', act, order, storybeats });
  const bundle = (): Bundle => ({
    storybeats: [sb('OS', 'signpost', 1), sb('OS', 'progression', 1), sb('MC', 'event', 1), sb('RS', 'signpost', 2), sb('IC', 'signpost', 2), sb('OS', 'progression', 9)],
    moments: [moment('Zlom', 2, 1, ['RS/signpost/2', 'IC/signpost/2']), moment('Příjezd', 1, 2, ['OS/progression/1', 'MC/event/1'], 'Sanitka.'), moment('Úvod', 1, 1), moment('Finále', 3, 1)],
    drivers: [0, 1, 2, 3, 4].map((index) => ({ id: `d${index}`, index, summary: '', storytelling: `Driver ${index}` })),
    players: [],
    notes: [],
  });
  const lane = (p: ReturnType<typeof importDramatica>, id: string) => p.lanes.find((l) => l.id === p.beats[id].laneId)!.name;

  it('Moment je karta s blokem storybeatů v pořadí; nepřiřazené leží vyřazené tam, kam v čase patří', () => {
    const p = importDramatica(bundle(), 'x');
    expect(titles(p)).toEqual([
      '[1. dějství]', 'Initial Story Driver', 'OS1', 'Úvod', 'Příjezd', 'OS1', 'MC1', 'Second Story Driver',
      '[2. dějství]', 'Zlom', 'RS2', 'IC2', 'Midpoint Story Driver', 'OS9', 'Fourth Story Driver',
      '[3. dějství]', 'Finále', 'Concluding Story Driver',
    ]);
    const [, , sign, uvod, prijezd, os1, mc1] = p.order;
    // Signpost 1 patří na začátek prvního dějství, Progrese 9 (začátek Signpostu 3) doprostřed druhého.
    expect([p.beats[sign].dramatica!.scope, p.beats[sign].off, p.beats[p.order[13]].off]).toEqual(['signpost', true, true]);
    expect(p.beats[uvod].groupId).toBeNull();
    expect(p.groups.find((g) => g.id === p.beats[prijezd].groupId)!.title).toBe('Příjezd');
    expect([p.beats[os1].groupId, p.beats[mc1].groupId]).toEqual([p.beats[prijezd].groupId, p.beats[prijezd].groupId]);
    expect(p.beats[prijezd]).toMatchObject({ synopsis: 'Sanitka.', source: { kind: 'moment' } });
    // Moment se storybeaty jen ze vztahu a vlivové postavy začíná v B story.
    expect([lane(p, prijezd), lane(p, p.order[9]), lane(p, p.order[10])]).toEqual(['A story', 'B story', 'B story']);
    expect(p.order.filter((id) => p.beats[id]?.off)).toHaveLength(2);
  });
  it('storybeat je jen v jednom Momentu', () => {
    const b = bundle();
    b.moments.push(moment('Druhý', 2, 2, ['RS/signpost/2']));
    const p = importDramatica(b, 'x');
    expect(Object.values(p.beats).filter((x) => x.dramatica?.throughline === 'RS')).toHaveLength(1);
    expect(p.beats[p.order[p.order.findIndex((id) => p.beats[id]?.title === 'Druhý')]].groupId).toBeNull();
  });
  it('přiřazení nepřiřazeného do Momentu a zpět', () => {
    const p = importDramatica(bundle(), 'x');
    const os9 = p.order.find((id) => p.beats[id]?.dramatica?.sequence === 9)!;
    const finale = momentCards(p).find((m) => m.title === 'Finále')!;
    assignMoment(p, os9, finale.id);
    expect(p.beats[os9]).toMatchObject({ off: false, groupId: finale.groupId });
    expect(momentOf(p, p.beats[os9])!.id).toBe(finale.id);
    expect(titles(p).slice(-4)).toEqual(['[3. dějství]', 'Finále', 'OS9', 'Concluding Story Driver']);
    assignMoment(p, os9, null);
    expect(p.beats[os9]).toMatchObject({ off: true, groupId: null });
    expect(titles(p).slice(-4)).toEqual(['[3. dějství]', 'Finále', 'OS9', 'Concluding Story Driver']);
  });
  it('opakovaný import nic nezdvojí ani nepřesune; export nese pořadí a složení Momentů', () => {
    const p = importDramatica(bundle(), 'x');
    const os9 = p.order.find((id) => p.beats[id]?.dramatica?.sequence === 9)!;
    assignMoment(p, os9, momentCards(p)[0].id);
    const before = [...p.order];
    expect(mergeDramatica(p, bundle())).toEqual({ added: 0, updated: 0 });
    expect(p.order).toEqual(before);
    const out = exportSources(p);
    expect(out.map((x) => x.title)).toEqual(['Initial Story Driver', 'Úvod', 'Příjezd', 'Second Story Driver', 'Zlom', 'Midpoint Story Driver', 'Fourth Story Driver', 'Finále', 'Concluding Story Driver']);
    expect(out[1].storybeats).toEqual(['OS/progression/9']);
    expect(out[2].storybeats).toEqual(['OS/progression/1', 'MC/event/1']);
    expect(exportDramatica(p).filter((x) => x.plotOrder === null).map((x) => x.sequence)).toEqual([1]);
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
              { id: 'm2', act: 1, order: 3, summary: 'V sanitce', synopsis: 'Jedou mlčky.', setting: 'Sanitka', timing: 'Ráno', imperatives: '', storybeats: [{ sequence: 1, storybeat_id: 'o1' }, { sequence: 0, storybeat_id: 'e1' }] },
              { id: 't1', act: 2, order: 1, summary: 'One Last Push', synopsis: '', setting: '', timing: '', imperatives: '', storybeats: [{ storybeat_id: 's2' }] },
              { id: 't2', act: 2, order: 1, summary: 'One Last Push', synopsis: '', setting: '', timing: '', imperatives: '', storybeats: [{ storybeat_id: 's2' }] },
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
    expect(bundle.drivers.map((d) => d.index)).toEqual([0]);
  });
  it('postaví tabuli, obsazení, rešerši i storyform', () => {
    const p = importDramatica(bundle, 'x');
    expect(titles(p)).toEqual(['[1. dějství]', 'Initial Story Driver', 'V sanitce', 'Knowledge', 'Instinct', '[2. dějství]', 'One Last Push', 'Doing']);
    expect(p.characters.map((c) => [c.name, c.role, c.aliases])).toEqual([['Eva Horáková', 'main', 'Eva'], ['Zuzana', 'secondary', ''], ['Jan Veselý', 'small', 'Jan']]);
    expect(p.research.map((r) => `${r.folder}/${r.title}`)).toEqual(['Postavy/Eva Horáková', 'Postavy/Zuzana', 'Dramatica/Logline']);
    expect(p.storyform!.points).toEqual([
      { throughline: '', name: 'Story Goal', fn: 'Understanding', summary: 'Pochopit domov.', text: '' },
      { throughline: 'MC', name: 'Problem', fn: 'Inequity', summary: 'Vina.', text: 'Podrobně.' },
    ]);
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
