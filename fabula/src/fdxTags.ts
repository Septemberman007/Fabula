import type { ID, Para, ProdCategory, ProdElement, Project } from './model';
import { uid } from './model';
import { breakdown, elementScenes, ensureProduction, findAll } from './production';
import { scenes } from './stats';

/**
 * Produkční tagy ve formátu Final Draftu (.fdx).
 *
 * Final Draft ukládá tagy do `<TagData>`: kategorie (`TagCategory`, s pevnými Id u vestavěných
 * kategorií), definice prvků (`TagDefinition` s kategorií a názvem) a tagy (`Tag Number`), které
 * odkazují na jednu či více definic. V textu scénáře je otagovaný úsek `<Text TagNumber="…">`.
 *
 * Fabula prvky hledá podle jména a tvarů ve všech scénách. Při importu se proto z otagovaných
 * úseků stanou tvary prvku a scény se srovnají s tím, co bylo otagované ve Final Draftu:
 * kde se prvek najde, ale otagovaný nebyl, se vyřadí; kde otagovaný byl, ale nenajde se, přidá se ručně.
 */

/** Vestavěné kategorie Final Draftu: Id, anglický název, číslo a český název ve Fabule. */
const FD_CATEGORIES: [string, string, number, string][] = [
  ['01fc9642-84ff-4366-b37c-a3068dee57e8', 'Cast Members', 2, 'Obsazení'],
  ['028a4e2b-b507-4d09-88ab-90e3edae9071', 'Background Actors', 3, 'Komparz'],
  ['0377dbe6-77a3-41af-bda8-86eb2468fdbf', 'Stunts', 4, 'Kaskadérské akce'],
  ['04721a56-f54b-49c8-80ad-d53887d6b851', 'Vehicles', 5, 'Vozidla'],
  ['05c556eb-6bc1-4a3a-b09f-f8b5ba1b6afa', 'Props', 6, 'Rekvizity'],
  ['47b02ff1-5161-4137-b736-f36eebba7643', 'Camera', 7, 'Kamera'],
  ['069e18b8-2109-4f3d-94e7-d802027a60a8', 'Special Effects', 8, 'Speciální efekty'],
  ['0726fa85-1e65-4ab8-87de-bf21d09b01f0', 'Wardrobe', 9, 'Kostýmy'],
  ['08ae1eef-32ce-415f-9a9b-0982d2453ec4', 'Makeup/Hair', 10, 'Masky a vlasy'],
  ['09cb0d1c-ce01-4f22-bb64-b5f2e6c491c6', 'Animals', 11, 'Zvířata'],
  ['0ae40617-cc7c-48e6-ae2b-5aaecc09986f', 'Animal Wrangler', 12, 'Práce se zvířaty'],
  ['0b0b44c9-aa4b-4c40-88b1-d94472ad7a26', 'Music', 13, 'Hudba'],
  ['0ce7d308-096d-4603-8fe8-349f72cd89ff', 'Sound', 14, 'Zvuk'],
  ['4a84b619-62f9-4c04-8e46-bf2cd0b7f582', 'Art Department', 15, 'Výtvarné oddělení'],
  ['0debb71b-5743-4c53-80cc-e17e841ce645', 'Set Dressing', 16, 'Výprava a dekorace'],
  ['0e7a8fc5-5441-4bad-a9bf-5ddd3fe51c69', 'Greenery', 17, 'Zeleň'],
  ['109d0eaa-0334-4823-ac0c-b44d3f209dc4', 'Security', 18, 'Ostraha'],
  ['0ff5cda4-4d43-4cfe-940f-91380c46fdad', 'Special Equipment', 19, 'Speciální technika'],
  ['1179a4b1-70ee-4011-b4a2-809a0af09e92', 'Additional Labor', 20, 'Další profese'],
  ['12ab0932-e3b9-4b4a-bcd0-3da1b4e61d5e', 'Visual Effects', 21, 'Vizuální efekty'],
  ['135cc9d1-c4d5-4d00-83d9-571f584ea9cd', 'Mechanical Effects', 22, 'Mechanické efekty'],
  ['148267ae-50ae-4746-8202-659fb7447b55', 'Miscellaneous', 23, 'Různé'],
  ['15b6f4fd-4e74-4ad8-9971-b239d88c2997', 'Notes', 24, 'Poznámky pro produkci'],
  ['63c140da-ef2b-491a-b416-b46f461abb89', 'Script Day', 25, 'Den děje'],
  ['849f1ebf-5507-4f33-bff6-3a5b4d73be14', 'Unit', 26, 'Štáb'],
  ['70877d87-30ef-45b6-be46-c6fa94b83a71', 'Sequence', 27, 'Sekvence'],
  ['c5e89e4d-f83e-4c28-950c-92a63f1b5f26', 'Location', 28, 'Lokace'],
  ['216f33fd-fc42-4269-be01-b05b18f815a0', 'Comments', 29, 'Komentáře'],
];
/** Synopse scén (Final Draft je vede jako kategorii tagů) a obsazení (to Fabula pozná sama) se neimportují. */
const SKIP_IMPORT = new Set(['8e5e75c2-713b-47df-a75f-f12648b98ded', '01fc9642-84ff-4366-b37c-a3068dee57e8']);
const FD_DEFAULT_COLOR = '#940011000000';

const low = (s: string) => s.toLocaleLowerCase('cs');
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Barva Final Draftu má 16 bitů na kanál (#RRRRGGGGBBBB). */
const fromFdColor = (c: string | null) => {
  const m = /^#([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})$/i.exec(c ?? '');
  return m ? '#' + [m[1], m[2], m[3]].map((x) => x.slice(0, 2)).join('').toLowerCase() : null;
};
const toFdColor = (c: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? '#' + [m[1], m[2], m[3]].map((x) => (x + x).toUpperCase()).join('') : FD_DEFAULT_COLOR;
};

/** Otagovaný úsek textu v odstavci: číslo tagu a jeho text. */
export type TaggedRun = { tag: string; text: string };

/** Otagované úseky odstavce Final Draftu (přímí potomci `<Text TagNumber>`), sloučené podle čísla tagu. */
export function taggedRuns(paragraph: Element): TaggedRun[] {
  const out: TaggedRun[] = [];
  for (const t of paragraph.children) {
    if (t.nodeName !== 'Text') continue;
    const tag = t.getAttribute('TagNumber');
    const last = out[out.length - 1];
    if (!tag) continue;
    // Tag přerušený jen změnou formátu (dva sousední úseky se stejným číslem) je jeden výskyt.
    if (last && last.tag === tag && t.previousElementSibling?.getAttribute('TagNumber') === tag) last.text += t.textContent ?? '';
    else out.push({ tag, text: t.textContent ?? '' });
  }
  return out;
}

/**
 * Převezme tagy z dokumentu Final Draftu do produkčního rozpisu projektu.
 * `runs` jsou otagované úseky podle id odstavce Fabuly. Vrátí počet převzatých prvků.
 */
export function importFdxTags(p: Project, root: Element, runs: Map<ID, TaggedRun[]>): number {
  const data = [...root.children].find((c) => c.nodeName === 'TagData');
  if (!data || !runs.size) return 0;
  const all = (name: string) => [...data.getElementsByTagName(name)];
  const fdCats = new Map(all('TagCategory').map((c) => [c.getAttribute('Id') ?? '', c]));
  const defs = new Map(all('TagDefinition').map((d) => [d.getAttribute('Id') ?? '', d]));
  const tags = new Map(all('Tag').map((t) => [t.getAttribute('Number') ?? '', [...t.getElementsByTagName('DefId')].map((d) => d.textContent?.trim() ?? '')]));

  // Odstavec → scéna, a pro každou definici: ve kterých scénách a jakými slovy byla otagovaná.
  const sc = scenes(p);
  const sceneOf = new Map<ID, ID>();
  for (const s of sc) for (const q of s.paras) sceneOf.set(q.id, s.id);
  const uses = new Map<string, { scenes: Set<ID>; texts: string[] }>();
  for (const [paraId, list] of runs) {
    const sceneId = sceneOf.get(paraId);
    if (!sceneId) continue;
    for (const r of list) {
      for (const defId of tags.get(r.tag) ?? []) {
        const u = uses.get(defId) ?? { scenes: new Set(), texts: [] };
        u.scenes.add(sceneId);
        const text = r.text.replace(/\s+/g, ' ').trim();
        if (text && !u.texts.some((x) => low(x) === low(text))) u.texts.push(text);
        uses.set(defId, u);
      }
    }
  }
  if (!uses.size) return 0;

  const prod = ensureProduction(p);
  const catFor = new Map<string, ProdCategory>();
  const category = (fdId: string): ProdCategory | null => {
    if (SKIP_IMPORT.has(fdId)) return null;
    if (catFor.has(fdId)) return catFor.get(fdId)!;
    const known = FD_CATEGORIES.find((c) => c[0] === fdId);
    const fd = fdCats.get(fdId);
    const name = known?.[3] ?? fd?.getAttribute('Name') ?? 'Final Draft';
    let cat = prod.categories.find((c) => low(c.name) === low(name));
    if (!cat) {
      const color = fromFdColor(fd?.getAttribute('Color') ?? null);
      cat = { id: uid(), name, color: color && color !== '#941100' ? color : '#64748b' };
      prod.categories.push(cat);
    }
    catFor.set(fdId, cat);
    return cat;
  };

  let added = 0;
  for (const [defId, u] of uses) {
    const def = defs.get(defId);
    if (!def) continue;
    const cat = category(def.getAttribute('CatId') ?? '');
    if (!cat) continue;
    const name = (def.getAttribute('Label') ?? u.texts[0] ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    let el = prod.elements.find((x) => x.categoryId === cat.id && low(x.name) === low(name));
    if (!el) {
      el = { id: uid(), categoryId: cat.id, name, aliases: '', note: '', scenes: [], skip: [] };
      prod.elements.push(el);
      added++;
    }
    // Tvary, kterými byl prvek v textu otagovaný (čárka by tvary rozdělila, takové vynecháme).
    for (const t of u.texts) if (!t.includes(',') && !findAll(t, el).length) el.aliases = [el.aliases.trim(), t].filter(Boolean).join(', ');
    // Scény přesně podle Final Draftu.
    const found = new Set(elementScenes({ ...el, scenes: [], skip: [] }, sc).map((s) => s.id));
    for (const s of found) if (!u.scenes.has(s) && !el.skip.includes(s)) el.skip.push(s);
    for (const s of u.scenes) if (!found.has(s) && !el.scenes.includes(s)) el.scenes.push(s);
  }
  return added;
}

/** Tagy pro export: úseky odstavců s čísly tagů a XML bloku `<TagData>`. */
export interface FdxTagWriter {
  /** Rozdělí řádek odstavce na úseky; otagované dostanou číslo tagu. */
  runs(para: Para, line: string, isHeading: boolean): { text: string; tag?: number }[];
  /** Blok `<TagData>` (prázdný řetězec, když projekt nemá produkční prvky). */
  xml(): string;
}

export function fdxTagWriter(p: Project): FdxTagWriter {
  const prod = p.production;
  const none: FdxTagWriter = { runs: (_, line) => [{ text: line }], xml: () => '' };
  if (!prod?.elements.length) return none;

  // Prvky po scénách: nalezené v textu (hledají se v řádcích) a ručně přidané (otagují se na hlavičce scény).
  const rows = breakdown(p);
  const sceneOf = new Map<ID, { found: ProdElement[]; manual: ProdElement[] }>();
  for (const { scene, elements } of rows) {
    const all = [...elements.values()].flat();
    const entry = { found: all.filter((x) => x.found).map((x) => x.el), manual: all.filter((x) => !x.found).map((x) => x.el) };
    for (const q of scene.paras) sceneOf.set(q.id, entry);
  }
  const headings = new Set(rows.map((r) => r.scene.id));

  const used = new Set<ID>();
  const tags: ID[][] = [];
  const runs: FdxTagWriter['runs'] = (para, line, isHeading) => {
    const entry = sceneOf.get(para.id);
    if (!entry || para.type === 'character') return [{ text: line }];
    // Hranice všech výskytů; každý úsek mezi nimi nese množinu prvků, které ho pokrývají.
    const spans: [number, number, ID][] = [];
    for (const el of entry.found) for (const [a, b] of findAll(line, el)) spans.push([a, b, el.id]);
    if (isHeading && headings.has(para.id)) for (const el of entry.manual) spans.push([0, line.length, el.id]);
    if (!spans.length) return [{ text: line }];
    const cuts = [...new Set([0, line.length, ...spans.flatMap(([a, b]) => [a, b])])].sort((a, b) => a - b);
    const out: { text: string; tag?: number }[] = [];
    let prevKey = '';
    for (let i = 0; i < cuts.length - 1; i++) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      const ids = [...new Set(spans.filter(([s, e]) => s <= a && e >= b).map((x) => x[2]))].sort();
      const key = ids.join(' ');
      const last = out[out.length - 1];
      if (last && key === prevKey) last.text += line.slice(a, b);
      else if (ids.length) {
        ids.forEach((x) => used.add(x));
        tags.push(ids);
        out.push({ text: line.slice(a, b), tag: tags.length });
      } else out.push({ text: line.slice(a, b) });
      prevKey = key;
    }
    return out;
  };

  const xmlBlock = () => {
    if (!tags.length) return '';
    // Kategorie Fabuly → kategorie Final Draftu: vestavěné podle českého názvu, ostatní jako vlastní.
    const fdOf = new Map<ID, { id: string; name: string; number: number }>();
    let next = 30;
    for (const c of prod.categories) {
      const known = FD_CATEGORIES.find((x) => low(x[3]) === low(c.name) || low(x[1]) === low(c.name));
      fdOf.set(c.id, known ? { id: known[0], name: known[1], number: known[2] } : { id: c.id, name: c.name, number: next++ });
    }
    const colorOf = new Map([...fdOf].map(([cid, fd]) => [fd.id, prod.categories.find((c) => c.id === cid)!.color]));
    const cats = [
      ...FD_CATEGORIES.map(([id, name, number]) => ({ id, name, number })),
      ...[...fdOf.values()].filter((x) => !FD_CATEGORIES.some((k) => k[0] === x.id)),
    ];
    const els = prod.elements.filter((e) => used.has(e.id) && fdOf.has(e.categoryId));
    const lines = [
      '  <TagData>',
      '    <TagCategories>',
      ...cats.map((c) => `      <TagCategory Color="${colorOf.has(c.id) ? toFdColor(colorOf.get(c.id)!) : FD_DEFAULT_COLOR}" Id="${c.id}" Name="${xml(c.name)}" Number="${c.number}" Style="Bold"/>`),
      '    </TagCategories>',
      '    <TagDefinitions>',
      ...els.map((e, i) => `      <TagDefinition CatId="${fdOf.get(e.categoryId)!.id}" Id="${e.id}" Label="${xml(e.name.replace(/\*$/, ''))}" Number="${i + 1}"/>`),
      '    </TagDefinitions>',
      '    <Tags>',
      ...tags.flatMap((ids, i) => [`      <Tag Number="${i + 1}">`, ...ids.map((x) => `        <DefId>${x}</DefId>`), '      </Tag>']),
      '    </Tags>',
      '  </TagData>',
    ];
    return lines.join('\n') + '\n';
  };
  return { runs, xml: xmlBlock };
}
