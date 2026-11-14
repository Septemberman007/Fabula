import { Project, uid, Beat, ID, newBeat } from './model';
import { parseFountain } from './text';

export function emptyProject(): Project {
  const lane = { id: uid(), name: 'Hlavní děj', color: '#c2410c' };
  return {
    format: 2,
    id: uid(),
    title: 'Nový příběh',
    lanes: [lane],
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
}

/** Ukázkový příběh, aby pohledy nebyly při prvním spuštění prázdné. */
export function seed(): Project {
  const main = { id: uid(), name: 'Hlavní děj', color: '#c2410c' };
  const rel = { id: uid(), name: 'Sourozenci', color: '#0f766e' };
  const marta = { id: uid(), name: 'Marta', color: '#6d28d9', aliases: '', role: 'main' as const };
  const viktor = { id: uid(), name: 'Viktor', color: '#b45309', aliases: 'bratr', role: 'main' as const };
  const hron = { id: uid(), name: 'Inspektor Hron', color: '#1d4ed8', aliases: 'Hron', role: 'secondary' as const };
  const frame = { id: uid(), name: 'Prázdný rám', color: '#be185d', mode: 'none' as const, category: 'Témata' };
  const debt = { id: uid(), name: 'Viktorův dluh', color: '#4d7c0f', mode: 'none' as const, category: 'Mini-zápletky' };
  const loyalty = { id: uid(), name: 'Martina loajalita', color: '#1d4ed8', mode: 'change' as const, category: 'Rysy postav' };
  const suspicion = { id: uid(), name: 'Podezření', color: '#b45309', mode: 'rising' as const, category: 'Nebezpečí' };
  const block = { id: uid(), title: 'Pravda vychází najevo', color: '#0f766e', collapsed: false, parentId: null };
  const seq = { id: uid(), title: 'Odhalení padělku', color: '#6d28d9', collapsed: false, parentId: block.id };

  const p: Project = {
    format: 2,
    id: uid(),
    title: 'Prázdný rám',
    lanes: [main, rel],
    characters: [marta, viktor, hron],
    tags: [debt, suspicion, loyalty, frame],
    groups: [block, seq],
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

  const beat = (title: string, synopsis: string, laneId: ID, chars: ID[], tension: number): ID => {
    const b: Beat = newBeat(laneId, { title, synopsis, characterIds: chars, tension });
    p.beats[b.id] = b;
    p.order.push(b.id);
    return b.id;
  };
  const brk = (title: string) => {
    const id = uid();
    p.breaks[id] = { id, title };
    p.order.push(id);
  };
  const link = (from: ID, to: ID, note = '') => p.links.push({ id: uid(), from, to, note });

  const b1 = beat('Prázdný rám v depozitáři', 'Marta při inventuře zjistí, že z rámu zmizelo plátno.', main.id, [marta.id], 3);
  const b2 = beat('Viktor se ozve', 'Bratr po letech volá a potřebuje půjčit peníze.', rel.id, [marta.id, viktor.id], 2);
  const b3 = beat('Marta je podezřelá', 'Hron zjistí, že klíče od depozitáře měla jen ona.', main.id, [marta.id, hron.id], 5);
  brk('Druhé dějství');
  const b4 = beat('Byl to padělek', 'Restaurátorská zpráva ukáže, že obraz byl falešný už roky.', main.id, [marta.id], 6);
  const b5 = beat('Hádka', 'Viktor přizná, že padělek kdysi namaloval on.', rel.id, [marta.id, viktor.id], 7);
  const b6 = beat('Zatajený důkaz', 'Marta před Hronem schová zprávu restaurátora.', main.id, [marta.id, hron.id], 8);
  brk('Třetí dějství');
  const b7 = beat('Přiznání', 'Viktor se udá, aby sestru kryl.', rel.id, [viktor.id, hron.id], 9);
  const b8 = beat('Rám zůstane prázdný', 'Marta pověsí prázdný rám zpět na zeď galerie.', main.id, [marta.id], 4);

  p.beats[b1].paras = parseFountain(
    'INT. DEPOZITÁŘ MUZEA – NOC\n\nMarta prochází mezi regály s baterkou a odškrtává položky v seznamu. U jednoho rámu se zastaví.\n\nMARTA\nTo není možné.',
  );
  p.beats[b1].tagIds = [frame.id];
  p.beats[b8].tagIds = [frame.id];
  p.beats[b1].tagLevels[frame.id] = 3;
  p.beats[b8].tagLevels[frame.id] = 9;
  for (const b of [b2, b5, b7]) p.beats[b].tagIds.push(debt.id);
  for (const [b, level] of [[b2, 7], [b5, 3], [b6, 9], [b8, 5]] as const) {
    p.beats[b].tagIds.push(loyalty.id);
    p.beats[b].tagLevels[loyalty.id] = level;
  }
  for (const [b, level] of [[b3, 4], [b4, 5], [b6, 8], [b7, 9], [b8, 2]] as const) {
    p.beats[b].tagIds.push(suspicion.id);
    p.beats[b].tagLevels[suspicion.id] = level;
  }
  p.beats[b4].groupId = seq.id;
  p.beats[b5].groupId = seq.id;
  p.beats[b6].groupId = block.id;
  // Viktor volá ve chvíli, kdy Hron Martu vyslýchá: oba beaty se dějí souběžně.
  p.beats[b3].concurrent = true;
  p.beats[b6].paras = parseFountain('INT. KANCELÁŘ KURÁTORKY – VEČER\n\nMarta zasune zprávu restaurátora pod desky. Ve dveřích stojí Hron.\n\nHRON\nNěco jste mi chtěla ukázat?');
  p.beats[b7].paras = parseFountain('Do kanceláře bez zaklepání vejde Viktor.\n\nVIKTOR\nNechte ji. Ten obraz jsem maloval já.');
  p.beats[b1].status = 'draft';

  p.notes.push({ id: uid(), text: 'Kde byl Viktor v noci krádeže? Zatím to nikde neříkáme.', x: 236, y: 410, color: '#fde68a' });
  p.research.push(
    { id: uid(), title: 'Jak se pozná padělek', text: 'Rentgen, UV lampa, analýza pigmentů. Titanová běloba se používá až od 20. let 20. století – na starším obraze ji restaurátor odhalí hned.', folder: 'Podklady', url: '', beatIds: [b4] },
    { id: uid(), title: 'Viktor – minulost', text: 'Nedostudovaný malíř. Kopie dělal na zakázku, první padělek prodal kvůli dluhům.', folder: 'Postavy', url: '', beatIds: [b5] },
  );

  link(b1, b3, 'klíče od depozitáře měla jen ona');
  link(b1, b4);
  link(b2, b5);
  link(b4, b5, 'Marta pozná bratrův rukopis');
  link(b5, b6);
  link(b3, b6);
  link(b6, b7);
  link(b7, b8);
  return p;
}
