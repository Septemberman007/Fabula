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
