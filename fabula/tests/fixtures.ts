import type { Beat, Para, ParaType, Project } from '../src/model';
import { newBeat } from '../src/model';

let n = 0;
const id = (prefix: string) => `${prefix}${++n}`;

export const para = (type: ParaType, text: string): Para => ({ id: id('p'), type, text });

/** Malý projekt pro testy: jedna linie, žádné beaty. Beaty se přidávají přes `add`. */
export function project(): Project & { add: (title: string, patch?: Partial<Beat>) => Beat } {
  const p: Project = {
    format: 2,
    id: 'proj',
    title: 'Test',
    lanes: [{ id: 'lane', name: 'Hlavní děj', color: '#c2410c' }],
    characters: [],
    tags: [],
    groups: [],
    beats: {},
    breaks: {},
    order: [],
    links: [],
    notes: [],
    research: [],
    titlePage: { author: '', basedOn: '', draft: '', contact: '' },
    revisions: [],
    targetPages: 110,
    paper: 'a4',
  };
  return Object.assign(p, {
    add(title: string, patch: Partial<Beat> = {}) {
      const b = newBeat('lane', { id: id('b'), title, paras: [], ...patch });
      p.beats[b.id] = b;
      p.order.push(b.id);
      return b;
    },
  });
}
