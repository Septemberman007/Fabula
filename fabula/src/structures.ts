import type { Beat, ID, Project } from './model';
import { newBeat } from './model';

/**
 * Struktury vyprávění (Save the Cat, Hero's Journey) jako pravítko přes scény. Struktura příběh nepřeznačuje:
 * jen ukazuje, kterému jejímu kroku která část vyprávění odpovídá, a ke každému kroku klade otázku.
 * Kroky jsou zavěšené na čtyři Signposty; jejich hranice si autor může posunout tím, že scénu označí
 * za začátek kroku.
 */

export interface Slot {
  id: string;
  name: string;
  /** Signpost (čtvrtina příběhu), do kterého krok patří. */
  signpost: 1 | 2 | 3 | 4;
  /** Kolik místa krok v rámci svého Signpostu obvykle zabere, poměrně k ostatním. */
  weight: number;
  /** Otázka, kterou krok autorovi klade. Nikdy obsah. */
  ask: string;
}
export interface Structure {
  id: string;
  name: string;
  short: string;
  /** Pro jaké příběhy se struktura hodí a kde ji nenásledovat slepě. */
  note: string;
  slots: Slot[];
}

const slot = (id: string, name: string, signpost: Slot['signpost'], weight: number, ask: string): Slot => ({ id, name, signpost, weight, ask });

export const STRUCTURES: Structure[] = [
  {
    id: 'stc',
    name: 'Save the Cat',
    short: 'StC',
    note: 'Počítá s hrdinou, který se změní a uspěje. U příběhu s jiným koncem ber kroky kolem „All Is Lost“ a „Finale“ jako otázky, ne jako předpis.',
    slots: [
      slot('opening', 'Opening Image', 1, 0.5, 'Jaký obraz ukáže svět a hrdinku předtím, než se cokoli změní?'),
      slot('theme', 'Theme Stated', 1, 0.5, 'Kdo a jak mimochodem vysloví, o čem příběh je?'),
      slot('setup', 'Set-Up', 1, 2, 'Co v životě hrdinky nefunguje a co musí divák znát, než přijde změna?'),
      slot('catalyst', 'Catalyst', 1, 0.5, 'Která událost zvenčí rozbije dosavadní stav?'),
      slot('debate', 'Debate', 1, 2, 'Proč hrdinka váhá a co ji stojí rozhodnutí vykročit?'),
      slot('break2', 'Break into Two', 1, 0.5, 'Jakým vlastním rozhodnutím vstoupí do nového světa?'),
      slot('bstory', 'B Story', 2, 1, 'Který vztah ponese téma a kde začíná?'),
      slot('fun', 'Fun and Games', 2, 4, 'Co je slib premisy: jak vypadá nový svět v plném chodu?'),
      slot('midpoint', 'Midpoint', 2, 0.5, 'Jaké zdánlivé vítězství nebo porážka zvedne sázky a otočí směr?'),
      slot('badguys', 'Bad Guys Close In', 3, 3, 'Jak sílí tlak zvenčí i zevnitř a co se začíná rozpadat?'),
      slot('lost', 'All Is Lost', 3, 0.5, 'Co hrdinka ztratí, aby to vypadalo jako konec?'),
      slot('night', 'Dark Night of the Soul', 3, 1.5, 'Co si na dně přizná?'),
      slot('break3', 'Break into Three', 3, 0.5, 'Jaké poznání spojí obě dějové linie a dá jí nový plán?'),
      slot('finale', 'Finale', 4, 4, 'Jak nový přístup obstojí v poslední zkoušce a co se tím změní ve světě?'),
      slot('final', 'Final Image', 4, 0.5, 'Jaký obraz je protějškem úvodního a ukáže, co se změnilo?'),
    ],
  },
  {
    id: 'hj',
    name: "Hero's Journey",
    short: 'HJ',
    note: 'Sleduje cestu jedné postavy tam a zpět. Vztahovou linii a pohled toho, kdo hrdinku ovlivňuje, do ní musíš vplést sám.',
    slots: [
      slot('ordinary', 'Ordinary World', 1, 2, 'Jaký je všední svět hrdinky a co jí v něm chybí?'),
      slot('call', 'Call to Adventure', 1, 0.5, 'Co ji vyzve ke změně?'),
      slot('refusal', 'Refusal of the Call', 1, 1, 'Čeho se bojí a proč výzvu odmítá?'),
      slot('mentor', 'Meeting the Mentor', 1, 1, 'Kdo nebo co jí dá odvahu, radu či dar?'),
      slot('threshold', 'Crossing the Threshold', 1, 0.5, 'Čím se nevratně zaváže a opustí známý svět?'),
      slot('tests', 'Tests, Allies, Enemies', 2, 3, 'Kdo se ukáže jako spojenec a kdo jako protivník, a jaká pravidla má nový svět?'),
      slot('approach', 'Approach to the Inmost Cave', 2, 1.5, 'Jak se připravuje na největší nebezpečí?'),
      slot('ordeal', 'The Ordeal', 2, 1, 'V jaké zkoušce čelí největšímu strachu a co v ní zemře?'),
      slot('reward', 'Reward', 3, 1.5, 'Co získá a jak ji to změní?'),
      slot('roadback', 'The Road Back', 3, 1.5, 'Co ji žene zpátky a co ji pronásleduje?'),
      slot('resurrection', 'Resurrection', 4, 2, 'V jaké poslední zkoušce musí prokázat, že se změnila?'),
      slot('elixir', 'Return with the Elixir', 4, 1, 'Co přináší zpět a komu to pomůže?'),
    ],
  },
];
export const structureOf = (id: string) => STRUCTURES.find((x) => x.id === id);

/** Scény v pořadí vyprávění, které se počítají do příběhu. */
const live = (p: Project): ID[] => p.order.filter((id) => p.beats[id] && !p.beats[id].off);

/**
 * Kde ve scénách začíná každý ze čtyř Signpostů. Příběh z Dramatiky se dělí podle svých dějství;
 * jiný příběh na čtvrtiny.
 */
export function signpostStarts(p: Project): number[] {
  const scenes = live(p);
  const sf = p.storyform;
  const acts = Object.keys(sf?.acts ?? {}).map(Number).filter((n) => p.order.includes(sf!.acts[n]));
  if (!sf || !acts.length || sf.signpostAct?.length !== 4) return [0, 1, 2, 3].map((k) => Math.round((scenes.length * k) / 4));
  const at = new Map(scenes.map((id, i) => [id, i]));
  /** Index první scény za daným místem v pořadí. */
  const firstAfter = (orderIndex: number) => {
    for (let i = orderIndex; i < p.order.length; i++) if (at.has(p.order[i])) return at.get(p.order[i])!;
    return scenes.length;
  };
  const sorted = acts.sort((a, b) => p.order.indexOf(sf.acts[a]) - p.order.indexOf(sf.acts[b]));
  const bounds = sorted.map((n) => firstAfter(p.order.indexOf(sf.acts[n])));
  return [1, 2, 3, 4].map((sp) => {
    const k = Math.max(0, sorted.indexOf(sf.signpostAct[sp - 1]));
    const [from, to] = [bounds[k], bounds[k + 1] ?? scenes.length];
    // Dějství, které nese víc Signpostů, se mezi ně dělí rovným dílem.
    const mine = [1, 2, 3, 4].filter((x) => sf.signpostAct[x - 1] === sf.signpostAct[sp - 1]);
    return from + Math.round(((to - from) * mine.indexOf(sp)) / mine.length);
  });
}

export interface Placed {
  slot: Slot;
  scenes: ID[];
}

/**
 * Rozloží kroky struktury přes scény. Pevné body jsou začátky Signpostů a scény, které autor označil
 * za začátek kroku; mezi nimi se kroky rozdělí podle svých vah.
 */
export function layout(p: Project, st: Structure): Placed[] {
  const scenes = live(p);
  const n = st.slots.length;
  const start: (number | undefined)[] = Array(n).fill(undefined);
  // Autorovy značky mají přednost; značka, která by šla proti pořadí kroků, se nepoužije.
  let floor = 0;
  st.slots.forEach((s, i) => {
    const at = scenes.findIndex((id) => p.beats[id].pins?.[st.id] === s.id);
    if (at >= floor) (start[i] = at), (floor = at);
  });
  const sp = signpostStarts(p);
  st.slots.forEach((s, i) => {
    if (start[i] !== undefined || (i > 0 && st.slots[i - 1].signpost === s.signpost)) return;
    const prev = Math.max(0, ...start.slice(0, i).filter((x): x is number => x !== undefined));
    const next = Math.min(scenes.length, ...start.slice(i + 1).filter((x): x is number => x !== undefined));
    start[i] = Math.min(next, Math.max(prev, sp[s.signpost - 1]));
  });
  start[0] ??= 0;
  // Mezi pevnými body podle vah.
  let a = 0;
  while (a < n) {
    let b = a + 1;
    while (b < n && start[b] === undefined) b++;
    const [from, to] = [start[a]!, b < n ? start[b]! : scenes.length];
    const total = st.slots.slice(a, b).reduce((k, s) => k + s.weight, 0);
    let run = 0;
    for (let i = a + 1; i < b; i++) {
      run += st.slots[i - 1].weight;
      start[i] = from + Math.round(((to - from) * run) / total);
    }
    a = b;
  }
  return st.slots.map((s, i) => ({ slot: s, scenes: scenes.slice(start[i]!, i + 1 < n ? start[i + 1]! : scenes.length) }));
}

/** Krok struktury, do kterého scéna spadá. */
export const slotOf = (p: Project, st: Structure, beatId: ID): Slot | null => layout(p, st).find((x) => x.scenes.includes(beatId))?.slot ?? null;

/** Označí scénu za začátek kroku (nebo značku zruší); krok může začínat jen jednou scénou. */
export function pinSlot(p: Project, beatId: ID, structure: string, slotId: string | null) {
  for (const b of Object.values(p.beats)) if (slotId && b.pins?.[structure] === slotId) delete b.pins[structure];
  const b = p.beats[beatId];
  if (!b) return;
  b.pins = { ...(b.pins ?? {}) };
  if (slotId) b.pins[structure] = slotId;
  else delete b.pins[structure];
}

/** Zapne nebo vypne pravítko struktury. */
export function toggleStructure(p: Project, id: string) {
  const on = p.structures ?? [];
  p.structures = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
}

/** Scéna, do které autor zatím nic nevložil. */
export function isBlank(p: Project, b: Beat): boolean {
  return !b.synopsis.trim() && !b.storybeats?.length && !b.points?.length && b.paras.every((x) => !x.text.trim()) && !p.links.some((l) => l.from === b.id || l.to === b.id);
}

/**
 * Založí pro každý krok struktury prázdnou scénu na místě, kde krok začíná. Krok, který svou scénu už má,
 * se přeskočí. Vrátí počet založených scén.
 */
export function applyStructure(p: Project, id: string): number {
  const st = structureOf(id);
  if (!st) return 0;
  if (!(p.structures ?? []).includes(id)) toggleStructure(p, id);
  const have = new Set(Object.values(p.beats).filter((b) => b.template === id).map((b) => b.pins?.[id]));
  const placed = layout(p, st);
  let made = 0;
  // Odzadu: krok bez vlastních scén se zařadí těsně před začátek kroku, který po něm následuje.
  let next: ID | undefined;
  for (const { slot: s, scenes } of [...placed].reverse()) {
    if (have.has(s.id)) {
      next = Object.values(p.beats).find((b) => b.template === id && b.pins?.[id] === s.id)?.id ?? scenes[0] ?? next;
      continue;
    }
    const b = newBeat(p.lanes[0].id, { title: s.name, template: id, pins: { [id]: s.id } });
    // Značku začátku kroku přebírá nová scéna.
    for (const x of Object.values(p.beats)) if (x.pins?.[id] === s.id) delete x.pins[id];
    p.beats[b.id] = b;
    const at = scenes[0] ?? next;
    p.order.splice(at ? p.order.indexOf(at) : p.order.length, 0, b.id);
    next = b.id;
    made++;
  }
  return made;
}

/** Prázdné scény, které založila daná struktura (`dramatica` = Momenty šablony z Dramatiky). */
export function blankScenes(p: Project, id: string): Beat[] {
  return Object.values(p.beats).filter((b) => (id === 'dramatica' ? b.source?.kind === 'moment' : b.template === id) && isBlank(p, b));
}

/** Odebere prázdné scény struktury; co autor rozepsal nebo spletl se storybeaty, zůstává. Vrátí počet odebraných. */
export function clearStructure(p: Project, id: string): number {
  const gone = blankScenes(p, id);
  const ids = new Set(gone.map((b) => b.id));
  p.order = p.order.filter((x) => !ids.has(x));
  for (const b of gone) {
    // Odebraný Moment z Dramatiky se při dalším importu nevrací.
    if (b.source && p.storyform) p.storyform.dropped = [...new Set([...(p.storyform.dropped ?? []), b.source.id])];
    delete p.beats[b.id];
  }
  return gone.length;
}
