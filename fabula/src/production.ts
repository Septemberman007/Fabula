import type { ID, ProdCategory, ProdElement, Production, Project } from './model';
import { uid } from './model';
import { Scene, dayPart, scenes, toCsv } from './stats';
import { eighths, paginate } from './paginate';

/**
 * Produkční rozpis: prvky, které scény potřebují (rekvizity, kostýmy, komparz, vozidla…), roztříděné
 * do kategorií. Prvek se ve scénách hledá podle jména a dalších tvarů, takže se nemusí označovat
 * každý výskyt zvlášť; scénu jde k prvku přidat i ručně, nebo ji z něj vyřadit.
 */

/** Výchozí kategorie (podle zvyklostí produkčního rozpisu). */
export const DEFAULT_CATEGORIES: [string, string][] = [
  ['Komparz', '#0e7490'],
  ['Rekvizity', '#b45309'],
  ['Kostýmy', '#7c3aed'],
  ['Masky a vlasy', '#db2777'],
  ['Výprava a dekorace', '#4d7c0f'],
  ['Vozidla', '#1d4ed8'],
  ['Zvířata', '#a16207'],
  ['Kaskadérské akce', '#dc2626'],
  ['Speciální efekty', '#ea580c'],
  ['Vizuální efekty', '#0891b2'],
  ['Zvuk', '#475569'],
  ['Hudba', '#9333ea'],
  ['Speciální technika', '#15803d'],
  ['Poznámky pro produkci', '#64748b'],
];

/** Produkce projektu; při prvním použití dostane výchozí kategorie. */
export function ensureProduction(p: Project): Production {
  p.production ??= { categories: DEFAULT_CATEGORIES.map(([name, color]) => ({ id: uid(), name, color })), elements: [] };
  return p.production;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Tvary, podle kterých se prvek hledá. */
export const forms = (el: Pick<ProdElement, 'name' | 'aliases'>) => [el.name, ...el.aliases.split(',')].map((x) => x.trim()).filter((x) => x.length > 1);

const reCache = new Map<string, RegExp | null>();
/**
 * Vzor pro hledání prvku v textu: celé slovo nebo slovní spojení bez ohledu na velikost písmen.
 * Tvar s hvězdičkou na konci („pistol*“) najde i všechna slova, která tak začínají (pistole, pistoli, pistolí).
 * Hranice slova se hlídá skupinou před shodou, ne lookbehindem: ten starší Safari nezná.
 */
function matcher(el: Pick<ProdElement, 'name' | 'aliases'>): RegExp | null {
  const key = `${el.name}\u0000${el.aliases}`;
  if (!reCache.has(key)) {
    const alts = forms(el)
      .sort((a, b) => b.length - a.length)
      .map((f) => (f.endsWith('*') ? `${esc(f.slice(0, -1).trim())}\\p{L}*` : esc(f)).replace(/\s+/g, '\\s+'));
    reCache.set(key, alts.length ? new RegExp(`(^|[^\\p{L}])(${alts.join('|')})(?![\\p{L}])`, 'giu') : null);
  }
  return reCache.get(key) ?? null;
}

/** Výskyty prvku v textu jako dvojice [začátek, konec). */
export function findAll(text: string, el: Pick<ProdElement, 'name' | 'aliases'>): [number, number][] {
  const re = matcher(el);
  if (!re) return [];
  const out: [number, number][] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[1].length;
    out.push([start, start + m[2].length]);
    // Hraniční znak patří k další shodě: vrátíme se o něj zpět.
    re.lastIndex = start + m[2].length;
  }
  return out;
}

/** Odstavce, ve kterých se prvky hledají: jména mluvčích ne (ta patří obsazení). */
const searchable = (sc: Scene) => sc.paras.filter((x) => x.type !== 'character').map((x) => x.text).join('\n');

/** Scény, ve kterých prvek je: nalezené v textu (bez vyřazených) a přidané ručně. */
export function elementScenes(el: ProdElement, sc: Scene[]): Scene[] {
  return sc.filter((x) => el.scenes.includes(x.id) || (!el.skip.includes(x.id) && findAll(searchable(x), el).length > 0));
}

export interface SceneBreakdown {
  scene: Scene;
  /** Kategorie → prvky ve scéně. */
  elements: Map<ID, { el: ProdElement; found: boolean }[]>;
}

/** Rozpis po scénách: každá scéna se svými prvky po kategoriích. */
export function breakdown(p: Project, sc: Scene[] = scenes(p)): SceneBreakdown[] {
  const prod = p.production;
  return sc.map((scene) => {
    const text = searchable(scene);
    const elements = new Map<ID, { el: ProdElement; found: boolean }[]>();
    for (const el of prod?.elements ?? []) {
      const found = findAll(text, el).length > 0;
      if (!(el.scenes.includes(scene.id) || (found && !el.skip.includes(scene.id)))) continue;
      elements.set(el.categoryId, [...(elements.get(el.categoryId) ?? []), { el, found }]);
    }
    return { scene, elements };
  });
}

/**
 * Označí text jako prvek. Bez `elementId` vznikne nový prvek v kategorii; s ním se text přidá
 * k existujícímu prvku jako další tvar (pokud ho prvek už nenajde sám). Vrátí id prvku.
 */
export function tagText(p: Project, text: string, categoryId: ID, elementId?: ID): ID | null {
  const name = text.replace(/\s+/g, ' ').trim();
  const prod = ensureProduction(p);
  if (!name) return null;
  const old = elementId ? prod.elements.find((x) => x.id === elementId) : prod.elements.find((x) => x.categoryId === categoryId && x.name.toLocaleLowerCase('cs') === name.toLocaleLowerCase('cs'));
  if (old) {
    if (!findAll(name, old).length) old.aliases = [old.aliases.trim(), name].filter(Boolean).join(', ');
    return old.id;
  }
  const el: ProdElement = { id: uid(), categoryId, name, aliases: '', note: '', scenes: [], skip: [] };
  prod.elements.push(el);
  return el.id;
}

/** Přidá prvek do scény, nebo ho z ní odebere (nalezený v textu se vyřadí, ručně přidaný se odpojí). */
export function toggleInScene(p: Project, elementId: ID, sceneId: ID, sc: Scene[]) {
  const el = p.production?.elements.find((x) => x.id === elementId);
  const scene = sc.find((x) => x.id === sceneId);
  if (!el || !scene) return;
  const found = findAll(searchable(scene), el).length > 0;
  const inside = el.scenes.includes(sceneId) || (found && !el.skip.includes(sceneId));
  if (inside) {
    el.scenes = el.scenes.filter((x) => x !== sceneId);
    if (found && !el.skip.includes(sceneId)) el.skip.push(sceneId);
  } else {
    el.skip = el.skip.filter((x) => x !== sceneId);
    if (!found) el.scenes.push(sceneId);
  }
}

/** Smaže prvek. */
export function removeElement(p: Project, id: ID) {
  if (p.production) p.production.elements = p.production.elements.filter((x) => x.id !== id);
}

/** Smaže kategorii; její prvky přejdou do první zbývající. */
export function removeCategory(p: Project, id: ID) {
  const prod = p.production;
  if (!prod || prod.categories.length < 2) return;
  prod.categories = prod.categories.filter((x) => x.id !== id);
  for (const el of prod.elements) if (el.categoryId === id) el.categoryId = prod.categories[0].id;
}

export const categoryOf = (p: Project, id: ID): ProdCategory | undefined => p.production?.categories.find((x) => x.id === id);

/** Rozpis jako CSV pro rozpisový a plánovací software: řádek na scénu, sloupec na kategorii. */
export function breakdownCsv(p: Project): string {
  const pg = paginate(p);
  const cats = p.production?.categories ?? [];
  const names = (ids: Iterable<ID>) => [...ids].map((id) => p.characters.find((c) => c.id === id)?.name ?? '').filter(Boolean).join(', ');
  return toCsv(
    ['Scéna', 'Hlavička', 'INT/EXT', 'Místo', 'Denní doba', 'Den/Noc', 'Strana', 'Délka (osminy)', 'Postavy', ...cats.map((c) => c.name)],
    breakdown(p).map(({ scene: s, elements }) => [
      s.n,
      s.heading,
      s.parsed.intExt,
      s.parsed.location,
      s.parsed.time,
      dayPart(s.parsed.time),
      s.page,
      eighths(s.lines, pg.perPage),
      names(s.cast),
      ...cats.map((c) => (elements.get(c.id) ?? []).map((x) => x.el.name).join(', ')),
    ]),
  );
}
