import { useMemo, useState } from 'react';
import type { ID, ProdElement, Project } from '../model';
import { uid } from '../model';
import { actions, ui } from '../store';
import { download } from '../io';
import { eighths, paginate } from '../paginate';
import { dayPart, scenes } from '../stats';
import { breakdown, breakdownCsv, elementScenes, ensureProduction, removeCategory, removeElement, toggleInScene } from '../production';

/** Sloupce rozpisu, které nejsou kategoriemi prvků. */
const BASE_COLS: [string, string][] = [
  ['n', 'Č.'],
  ['heading', 'Scéna'],
  ['page', 'Strana'],
  ['length', 'Délka'],
  ['ie', 'INT/EXT'],
  ['dn', 'Den/Noc'],
  ['cast', 'Postavy'],
];
const COLS_KEY = 'fabula.prodCols';
const loadCols = (): string[] | null => {
  try {
    return JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const saveCols = (cols: string[]) => {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  } catch {
    /* jen pohodlí */
  }
};

const edit = (fn: (p: Project) => void) => actions.editScript((d) => fn(d));

/**
 * Produkční rozpis: řádek na scénu, sloupce podle výběru (jako navigátor ve Final Draftu), v buňkách
 * kategorií prvky scény. Pod ním seznam prvků po kategoriích s tvary, podle kterých se hledají.
 */
export function Production({ p }: { p: Project }) {
  const sc = useMemo(() => scenes(p), [p]);
  const rows = useMemo(() => breakdown(p, sc), [p, sc]);
  const pg = paginate(p);
  const prod = p.production;
  const cats = prod?.categories ?? [];
  const [cols, setCols] = useState<string[]>(() => loadCols() ?? ['n', 'heading', 'page', 'length', 'dn', 'cast', ...cats.slice(0, 4).map((c) => c.id)]);
  const shown = (id: string) => cols.includes(id);
  const toggleCol = (id: string) => {
    const next = shown(id) ? cols.filter((x) => x !== id) : [...cols, id];
    setCols(next);
    saveCols(next);
  };
  const base = p.title.trim() || 'pribeh';
  const names = (ids: Iterable<ID>) => [...ids].map((id) => p.characters.find((c) => c.id === id)?.name).filter(Boolean).join(', ');
  const go = (beat: ID) => ui({ selected: beat, multi: [], view: 'script', tab: 'detail' });

  if (!prod) {
    return (
      <div className="prod-empty">
        <p>
          Produkční rozpis třídí, co která scéna potřebuje: rekvizity, kostýmy, komparz, vozidla, efekty… Prvky označíš přímo ve scénáři: vyber slovo a klikni na
          „Označit prvek“. Prvek se pak najde ve všech scénách sám.
        </p>
        <button className="primary" onClick={() => edit((d) => void ensureProduction(d))}>
          Založit rozpis s výchozími kategoriemi
        </button>
      </div>
    );
  }

  return (
    <div className="prod">
      <div className="prod-bar">
        <details className="show-menu">
          <summary>Sloupce</summary>
          <div>
            {BASE_COLS.map(([id, label]) => (
              <label key={id}>
                <input type="checkbox" checked={shown(id)} onChange={() => toggleCol(id)} /> {label}
              </label>
            ))}
            <hr />
            {cats.map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={shown(c.id)} onChange={() => toggleCol(c.id)} /> <i className="prod-dot" style={{ background: c.color }} /> {c.name}
              </label>
            ))}
          </div>
        </details>
        <span className="muted small">
          {sc.length} scén · {prod.elements.length} prvků. Klik na prvek ve scéně ho z ní vyřadí, „+“ přidá prvek, který v textu není.
        </span>
        <button onClick={() => download(`${base} – produkční rozpis.csv`, breakdownCsv(p), 'text/csv')}>Export CSV</button>
      </div>

      <div className="prod-scroll">
        <table className="prod-table">
          <thead>
            <tr>
              {BASE_COLS.filter(([id]) => shown(id)).map(([id, label]) => (
                <th key={id}>{label}</th>
              ))}
              {cats
                .filter((c) => shown(c.id))
                .map((c) => (
                  <th key={c.id} style={{ borderBottomColor: c.color }}>
                    {c.name}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ scene: s, elements }) => (
              <tr key={s.id}>
                {shown('n') && (
                  <td className="num">
                    <button className="linklike" onClick={() => go(s.beats[0])} title="Otevřít scénu ve scénáři">
                      {s.n}
                    </button>
                  </td>
                )}
                {shown('heading') && <td className="prod-heading">{s.heading}</td>}
                {shown('page') && <td className="num">{s.page || ''}</td>}
                {shown('length') && <td className="num">{eighths(s.lines, pg.perPage)}</td>}
                {shown('ie') && <td>{s.parsed.intExt}</td>}
                {shown('dn') && <td>{dayPart(s.parsed.time)}</td>}
                {shown('cast') && <td>{names(s.cast)}</td>}
                {cats
                  .filter((c) => shown(c.id))
                  .map((c) => {
                    const here = elements.get(c.id) ?? [];
                    const others = prod.elements.filter((x) => x.categoryId === c.id && !here.some((h) => h.el.id === x.id));
                    return (
                      <td key={c.id}>
                        {here.map(({ el, found }) => (
                          <button
                            key={el.id}
                            className={`prod-chip${found ? '' : ' manual'}`}
                            style={{ borderColor: c.color }}
                            title={found ? 'Nalezeno v textu scény. Kliknutím prvek ze scény vyřadíš.' : 'Přidáno ručně. Kliknutím odebereš.'}
                            onClick={() => edit((d) => toggleInScene(d, el.id, s.id, scenes(d)))}
                          >
                            {el.name}
                          </button>
                        ))}
                        {others.length > 0 && (
                          <select className="prod-add" value="" title={`Přidat do scény prvek z kategorie ${c.name}`} onChange={(e) => e.target.value && edit((d) => toggleInScene(d, e.target.value, s.id, scenes(d)))}>
                            <option value="">+</option>
                            {others.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
        {sc.length === 0 && <p className="muted">Scénář zatím nemá žádnou scénu s hlavičkou (INT./EXT.), takže není co rozepsat.</p>}
      </div>

      <h3>Prvky</h3>
      <p className="muted small">
        Prvek se ve scénách hledá podle jména a dalších tvarů. Česká slova se skloňují: napiš tvary vedle sebe („pistole, pistoli, pistolí“), nebo kmen s hvězdičkou
        („pistol*“).
      </p>
      <div className="prod-cats">
        {cats.map((c) => {
          const list = prod.elements.filter((x) => x.categoryId === c.id);
          return (
            <section key={c.id} className="prod-cat">
              <div className="prod-cat-head">
                <input type="color" value={c.color} onChange={(e) => edit((d) => void Object.assign(d.production!.categories.find((x) => x.id === c.id)!, { color: e.target.value }))} />
                <input value={c.name} onChange={(e) => edit((d) => void Object.assign(d.production!.categories.find((x) => x.id === c.id)!, { name: e.target.value }))} />
                <button
                  className="x"
                  title={cats.length < 2 ? 'Poslední kategorii nelze smazat' : 'Smazat kategorii (její prvky přejdou do první)'}
                  disabled={cats.length < 2}
                  onClick={() => confirm(`Smazat kategorii „${c.name}“?`) && edit((d) => removeCategory(d, c.id))}
                >
                  ×
                </button>
              </div>
              {list.map((el) => (
                <ElementRow key={el.id} el={el} count={elementScenes(el, sc).length} />
              ))}
              <button
                className="linklike"
                onClick={() => edit((d) => void d.production!.elements.push({ id: uid(), categoryId: c.id, name: '', aliases: '', note: '', scenes: [], skip: [] }))}
              >
                + prvek
              </button>
            </section>
          );
        })}
      </div>
      <button onClick={() => edit((d) => void d.production!.categories.push({ id: uid(), name: 'Nová kategorie', color: '#64748b' }))}>+ Kategorie</button>
    </div>
  );
}

function ElementRow({ el, count }: { el: ProdElement; count: number }) {
  const set = (patch: Partial<ProdElement>) => edit((d) => void Object.assign(d.production!.elements.find((x) => x.id === el.id)!, patch));
  return (
    <div className="prod-el">
      <input value={el.name} placeholder="Název prvku" onChange={(e) => set({ name: e.target.value })} />
      <input value={el.aliases} placeholder="další tvary, kmen*" onChange={(e) => set({ aliases: e.target.value })} />
      <small title="Ve kolika scénách prvek je">{count}×</small>
      <button className="x" title="Smazat prvek" onClick={() => edit((d) => removeElement(d, el.id))}>
        ×
      </button>
    </div>
  );
}
