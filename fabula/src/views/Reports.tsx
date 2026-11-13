import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ID, PARA_LABEL, ParaType, Project, REVISION_COLORS, STATUS_LABEL, beatName, beatNumber, revisionMark, tagCategories } from '../model';
import { beatColor } from '../colors';
import { parasLines } from '../text';
import { State, actions, ui } from '../store';
import { download } from '../io';
import { LINES_PER_PAGE, eighths } from '../text';
import { cast, locations, scenes, toCsv, totalWords, totals } from '../stats';
import { loadProductivity, saveGoal, streak, today } from '../local';

type Tab = 'stats' | 'map' | 'scenes' | 'locations' | 'cast' | 'tags' | 'notes' | 'revisions' | 'writing' | 'title';
const TABS: [Tab, string][] = [
  ['stats', 'Statistiky'],
  ['map', 'Mapa příběhu'],
  ['scenes', 'Scény'],
  ['locations', 'Lokace'],
  ['cast', 'Postavy'],
  ['tags', 'Motivy'],
  ['notes', 'Poznámky'],
  ['revisions', 'Revize'],
  ['writing', 'Psaní'],
  ['title', 'Titulní strana'],
];

const pct = (v: number) => `${Math.round(v * 100)} %`;
const num = (v: number) => v.toLocaleString('cs');

interface Col<T> {
  head: string;
  cell: (row: T) => ReactNode;
  /** Hodnota pro řazení a export; výchozí je obsah buňky. */
  value?: (row: T) => string | number;
  right?: boolean;
}

/** Tabulka s řazením kliknutím na záhlaví a exportem do CSV. */
function Table<T>({ name, cols, rows, onRow }: { name: string; cols: Col<T>[]; rows: T[]; onRow?: (row: T) => void }) {
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const val = (c: Col<T>, r: T) => (c.value ? c.value(r) : String(c.cell(r) ?? ''));
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols[sort.i];
    return [...rows].sort((a, b) => {
      const x = val(c, a);
      const y = val(c, b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'cs', { numeric: true })) * sort.dir;
    });
  }, [rows, sort]);
  if (!rows.length) return <p className="muted">Zatím tu nic není – report se naplní, jakmile bude ve scénáři text s hlavičkami scén.</p>;
  return (
    <>
      <div className="rep-actions">
        <button onClick={() => download(`${name}.csv`, toCsv(cols.map((c) => c.head), sorted.map((r) => cols.map((c) => val(c, r)))), 'text/csv')}>Export CSV</button>
        <button onClick={() => window.print()}>Tisk</button>
      </div>
      <table className="rep-table">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={c.head} className={c.right ? 'right' : ''} onClick={() => setSort(sort?.i === i ? { i, dir: sort.dir === 1 ? -1 : 1 } : { i, dir: 1 })} title="Kliknutím seřadíš">
                {c.head}
                {sort?.i === i && (sort.dir === 1 ? ' ▲' : ' ▼')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className={onRow ? 'clickable' : ''} onClick={() => onRow?.(r)}>
              {cols.map((c) => (
                <td key={c.head} className={c.right ? 'right' : ''}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Bars({ data }: { data: [string, number][] }) {
  const total = data.reduce((n, [, v]) => n + v, 0);
  if (!total) return <p className="muted">—</p>;
  return (
    <div className="bars">
      {data
        .filter(([, v]) => v > 0)
        .map(([label, v]) => (
          <div key={label} className="bar-row">
            <span>{label}</span>
            <div className="bar">
              <i style={{ width: `${(v / total) * 100}%` }} />
            </div>
            <b>
              {num(v)} · {pct(v / total)}
            </b>
          </div>
        ))}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tile">
      <small>{label}</small>
      <b>{value}</b>
      {sub && <span>{sub}</span>}
    </div>
  );
}

/** Běžící sprint držíme mimo komponentu, aby přežil přepnutí do scénáře a zpět. */
let runningSprint: { ends: number; start: number; minutes: number } | null = null;

function Writing({ p }: { p: Project }) {
  const [prod, setProd] = useState(loadProductivity);
  const [sprint, setSprintState] = useState(runningSprint);
  const setSprint = (v: typeof runningSprint) => setSprintState((runningSprint = v));
  const [done, setDone] = useState<{ minutes: number; words: number } | null>(null);
  const [minutes, setMinutes] = useState(25);
  const [, tick] = useState(0);
  const words = totalWords(p);

  useEffect(() => setProd(loadProductivity()), [p]);
  useEffect(() => {
    if (!sprint) return;
    const t = setInterval(() => {
      if (Date.now() >= sprint.ends) {
        setDone({ minutes: sprint.minutes, words: Math.max(0, totalWords(p) - sprint.start) });
        setSprint(null);
      } else tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [sprint, p]);

  const days = [...Array(14)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return { key: today(d), label: `${d.getDate()}. ${d.getMonth() + 1}.`, words: prod.days[today(d)] ?? 0 };
  });
  const max = Math.max(prod.goal, ...days.map((d) => d.words), 1);
  const todayWords = prod.days[today()] ?? 0;
  const left = sprint ? Math.max(0, Math.ceil((sprint.ends - Date.now()) / 1000)) : 0;

  return (
    <>
      <div className="tiles">
        <Tile label="Dnes napsáno" value={`${num(todayWords)} slov`} sub={prod.goal ? `${pct(Math.min(1, todayWords / prod.goal))} denního cíle` : undefined} />
        <Tile label="Série" value={`${streak(prod)} dní`} sub="po sobě se splněným cílem" />
        <Tile label="Posledních 14 dní" value={`${num(days.reduce((n, d) => n + d.words, 0))} slov`} />
        <div className="tile">
          <small>Denní cíl (slov)</small>
          <input
            type="number"
            min={0}
            step={50}
            value={prod.goal}
            onChange={(e) => {
              saveGoal(Math.max(0, +e.target.value));
              setProd(loadProductivity());
            }}
          />
        </div>
      </div>

      <h3>Posledních 14 dní</h3>
      <div className="daychart">
        <i className="goal-line" style={{ bottom: `calc(20px + (100% - 20px) * ${prod.goal / max})` }} title={`Denní cíl: ${prod.goal} slov`} />
        {days.map((d) => (
          <div key={d.key} className={`day${d.words >= prod.goal && prod.goal > 0 ? ' hit' : ''}`} title={`${d.label} – ${num(d.words)} slov`}>
            <i style={{ height: `${(d.words / max) * 100}%` }} />
            <small>{d.label}</small>
          </div>
        ))}
      </div>
      <p className="muted small">Počítají se slova přidaná do textu scén v tomto prohlížeči. Mazání a krok zpět se neodečítají.</p>

      <h3>Psací sprint</h3>
      {sprint ? (
        <div className="sprint running">
          <b className="clock">
            {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}
          </b>
          <span>
            přidáno <b>{num(Math.max(0, words - sprint.start))}</b> slov
          </span>
          <button
            onClick={() => {
              setDone({ minutes: Math.round((sprint.minutes * 60 - left) / 60), words: Math.max(0, words - sprint.start) });
              setSprint(null);
            }}
          >
            Ukončit sprint
          </button>
        </div>
      ) : (
        <div className="sprint">
          <label>
            Délka
            <select value={minutes} onChange={(e) => setMinutes(+e.target.value)}>
              {[10, 15, 25, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minut
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => (setDone(null), setSprint({ ends: Date.now() + minutes * 60000, start: words, minutes }))}>
            Spustit sprint
          </button>
          {done && (
            <span className="sprint-done">
              Hotovo: {done.minutes} minut, {num(done.words)} nových slov.
            </span>
          )}
        </div>
      )}
      <p className="muted small">Sprint běží dál i po přepnutí do scénáře; výsledek uvidíš, až se sem vrátíš.</p>
    </>
  );
}

/** Mapa příběhu: celý scénář jako pruh stran s beaty, předěly a cílovou délkou. */
function StoryMap({ s }: { s: State }) {
  const p = s.project;
  const items = p.order.map((id) => ({ id, beat: p.beats[id], pages: p.beats[id] && !p.beats[id].off ? parasLines(p.beats[id].paras) / LINES_PER_PAGE : 0 }));
  const total = items.reduce((n, x) => n + x.pages, 0);
  // Dokud je napsáno jen pár stran, přiblížíme měřítko na napsaný text; jinak by beaty nebyly vidět.
  const zoomed = total > 0 && total < p.targetPages * 0.15;
  const span = zoomed ? total : Math.max(p.targetPages, total, 1);
  const unwritten = items.filter((x) => x.beat && !x.beat.off && x.pages === 0).length;
  let at = 0;
  const marks: { title: string; page: number }[] = [];
  const blocks = items.map((x) => {
    const start = at;
    at += x.pages;
    if (!x.beat) marks.push({ title: p.breaks[x.id].title, page: start });
    return { ...x, start };
  });
  const stepSize = [0.125, 0.25, 0.5, 1, 2, 5, 10, 20].find((x) => span / x <= 14) ?? 50;
  const ticks = [...Array(Math.floor(span / stepSize + 1e-9) + 1)].map((_, i) => i * stepSize);
  const bounds = [0, ...marks.map((m) => m.page), total];
  const names = ['Před prvním předělem', ...marks.map((m) => m.title)];
  return (
    <>
      <div className="tiles">
        <Tile label="Napsáno" value={`${total.toFixed(1).replace('.', ',')} str.`} sub={`${pct(total / p.targetPages)} cílové délky`} />
        <div className="tile">
          <small>Cílová délka (stran)</small>
          <input type="number" min={1} value={p.targetPages} onChange={(e) => actions.setTargetPages(+e.target.value)} />
        </div>
        <Tile label="Zbývá" value={`${Math.max(0, p.targetPages - total).toFixed(1).replace('.', ',')} str.`} sub={unwritten ? `${unwritten} beatů ještě nemá text` : 'všechny beaty mají text'} />
      </div>

      <h3>Scénář po stranách</h3>
      <div className="storymap">
        <div className="sm-track">
          {blocks
            .filter((x) => x.beat && x.pages > 0)
            .map((x) => (
              <button
                key={x.id}
                className="sm-beat"
                style={{ left: `${(x.start / span) * 100}%`, width: `${(x.pages / span) * 100}%`, background: beatColor(p, x.beat, s.colorBy) }}
                title={`${beatNumber(p, x.id)}. ${beatName(p, x.id)} – str. ${(x.start + 1).toFixed(0)}, délka ${eighths(x.pages * LINES_PER_PAGE)}`}
                onClick={() => ui({ selected: x.id, multi: [], view: 'script', tab: 'detail' })}
              />
            ))}
          {marks.map((m, i) => (
            <span key={i} className="sm-mark" style={{ left: `${(m.page / span) * 100}%` }}>
              <b>{m.title}</b>
              <small>str. {Math.round(m.page) + 1}</small>
            </span>
          ))}
          {!zoomed && <span className="sm-target" style={{ left: `${(p.targetPages / span) * 100}%` }} title={`Cílová délka: ${p.targetPages} stran`} />}
        </div>
        <div className="sm-ruler">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${(t / span) * 100}%` }}>
              {stepSize < 1 ? eighths(t * LINES_PER_PAGE) : t}
            </span>
          ))}
        </div>
      </div>
      {zoomed && <p className="muted small">Měřítko je přiblížené na napsaný text, protože zatím tvoří méně než 15 % cílové délky. Čísla na ose jsou strany.</p>}

      <h3>Délka částí</h3>
      {total > 0 ? (
        <Bars data={names.map((n, i) => [n || 'Předěl', +(bounds[i + 1] - bounds[i]).toFixed(1)] as [string, number]).filter(([, v]) => v > 0)} />
      ) : (
        <p className="muted">Mapa se naplní, jakmile beaty dostanou text. Zatím je scénář prázdný.</p>
      )}
      <p className="muted small">Barvy beatů se řídí volbou „Barva podle“ na tabuli. Délky jsou odhad z {LINES_PER_PAGE} řádků na stranu.</p>
    </>
  );
}

function Revisions({ p }: { p: Project }) {
  const next = REVISION_COLORS[p.revisions.length % REVISION_COLORS.length];
  const [name, setName] = useState('');
  // Kolik odstavců a scén (beatů) nese značku které revize.
  const counts = new Map<ID, { paras: number; beats: Set<ID> }>();
  for (const id of p.order) {
    for (const x of p.beats[id]?.paras ?? []) {
      const r = revisionMark(p, x);
      if (!r) continue;
      const c = counts.get(r.id) ?? { paras: 0, beats: new Set<ID>() };
      c.paras++;
      c.beats.add(id);
      counts.set(r.id, c);
    }
  }
  return (
    <div className="rev-panel">
      <p className="muted">
        Revize označí hvězdičkou všechny odstavce, které od jejího zahájení změníš nebo přidáš. Každá další sada má vlastní barvu, takže je vidět, co se
        změnilo ve kterém kole přepisu.
      </p>
      <div className="rev-new">
        <i style={{ background: next[1] }} />
        <input value={name} placeholder={`${next[0]} revize`} onChange={(e) => setName(e.target.value)} />
        <button className="primary" onClick={() => (actions.startRevision(name.trim() || `${next[0]} revize`, next[1]), setName(''))}>
          Zahájit novou revizi
        </button>
      </div>
      {p.revisions.length === 0 && <p className="muted">Žádná revize zatím neběží; scénář je v první verzi.</p>}
      <ul className="backup-list">
        {[...p.revisions].reverse().map((r, i) => {
          const c = counts.get(r.id);
          return (
            <li key={r.id}>
              <div>
                <b>
                  <i className="rev-dot" style={{ background: r.color }} /> {r.name}
                  {i === 0 && <span className="tag-now"> probíhá</span>}
                </b>
                <small>
                  zahájena {new Date(r.started).toLocaleString('cs')} · {c ? `${c.paras} změněných odstavců v ${c.beats.size} beatech` : 'zatím beze změn'}
                  {c && `: ${[...c.beats].map((b) => beatNumber(p, b)).join(', ')}`}
                </small>
              </div>
              <button onClick={() => confirm(`Zrušit revizi „${r.name}“? Její značky zmizí, text zůstane.`) && actions.deleteRevision(r.id)}>Zrušit</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TitlePageForm({ p }: { p: Project }) {
  const tp = p.titlePage;
  return (
    <div className="title-form">
      <label>
        Název
        <input value={p.title} onChange={(e) => actions.setTitle(e.target.value)} />
      </label>
      <label>
        Autor
        <input value={tp.author} placeholder="Jméno a příjmení" onChange={(e) => actions.setTitlePage({ author: e.target.value })} />
      </label>
      <label>
        Předloha
        <input value={tp.basedOn} placeholder="Podle románu…" onChange={(e) => actions.setTitlePage({ basedOn: e.target.value })} />
      </label>
      <label>
        Verze a datum
        <input value={tp.draft} placeholder="2. verze, 13. 11. 2026" onChange={(e) => actions.setTitlePage({ draft: e.target.value })} />
      </label>
      <label>
        Kontakt
        <textarea rows={3} value={tp.contact} placeholder="E-mail, telefon, agentura" onChange={(e) => actions.setTitlePage({ contact: e.target.value })} />
      </label>
      <p className="muted small">Titulní strana se vytiskne před scénářem a přenese se do exportu Fountain a Final Draft.</p>
    </div>
  );
}

export function Reports({ s }: { s: State }) {
  const p = s.project;
  const [tab, setTab] = useState<Tab>('stats');
  const sc = useMemo(() => scenes(p), [p]);
  const t = useMemo(() => totals(p, sc), [p, sc]);
  const base = p.title.trim() || 'pribeh';
  const names = (ids: Iterable<ID>, list: { id: ID; name: string }[]) =>
    [...ids].map((id) => list.find((x) => x.id === id)?.name || '?').join(', ');
  const goScene = (beat: ID) => ui({ selected: beat, multi: [], view: 'script', tab: 'detail' });

  return (
    <div className="reports">
      <nav className="rep-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="rep-body">
        <h2 className="rep-print-title">
          {p.title} – {TABS.find(([id]) => id === tab)![1]}
        </h2>

        {tab === 'stats' && (
          <>
            <div className="tiles">
              <Tile label="Stran" value={t.pages < 1 && t.lines ? `${eighths(t.lines)}` : t.pages.toFixed(1).replace('.', ',')} sub={`≈ ${Math.round(t.pages) || (t.lines ? 1 : 0)} min filmu`} />
              <Tile label="Scén" value={t.scenes} sub={t.scenes ? `průměr ${eighths(t.avgSceneLines)} str.` : undefined} />
              <Tile label="Slov" value={num(t.words)} sub={`${num(t.paragraphs)} odstavců`} />
              <Tile label="Beatů" value={t.beats} sub={`${t.written} rozepsáno${t.beatsOff ? ` · ${t.beatsOff} vyřazeno` : ''}`} />
              <Tile label="Dialog" value={pct(t.dialogueShare)} sub="podíl slov v replikách" />
              <Tile label="Kauzálních vazeb" value={t.links} />
              <Tile label="Vulgarismů" value={sc.reduce((n, x) => n + [...x.speakers.values()].reduce((m, e) => m + e.profanity, 0), 0)} sub="v replikách" />
            </div>

            <div className="rep-cols">
              <section>
                <h3>Prvky scénáře (slova)</h3>
                <Bars data={(Object.keys(PARA_LABEL) as ParaType[]).map((k) => [PARA_LABEL[k], t.byType[k].words])} />
                <h3>Interiér / exteriér (scény)</h3>
                <Bars data={Object.entries(t.intExt)} />
                <h3>Den / noc (scény)</h3>
                <Bars data={Object.entries(t.dayNight)} />
              </section>
              <section>
                <h3>Rozpracovanost (beaty)</h3>
                <Bars data={Object.entries(t.byStatus).map(([k, v]) => [STATUS_LABEL[k as keyof typeof STATUS_LABEL], v])} />
                <h3>Extrémy</h3>
                {t.longest ? (
                  <ul className="rep-facts">
                    <li>
                      Nejdelší scéna: <b>{t.longest.n}. {t.longest.heading}</b> ({eighths(t.longest.lines)} str.)
                    </li>
                    <li>
                      Nejkratší scéna: <b>{t.shortest!.n}. {t.shortest!.heading}</b> ({eighths(t.shortest!.lines)} str.)
                    </li>
                    <li>
                      Odhad vychází z {LINES_PER_PAGE} řádků na stranu; skutečné stránkování se může lišit.
                    </li>
                  </ul>
                ) : (
                  <p className="muted">Scénář zatím nemá žádnou scénu s hlavičkou.</p>
                )}
              </section>
            </div>
          </>
        )}

        {tab === 'scenes' && (
          <Table
            name={`${base} – scény`}
            rows={sc}
            onRow={(r) => goScene(r.beats[0])}
            cols={[
              { head: '#', cell: (r) => r.n, value: (r) => r.n, right: true },
              { head: 'Scéna', cell: (r) => r.heading },
              { head: 'Beaty', cell: (r) => r.beats.map((b) => `${beatNumber(p, b)}. ${beatName(p, b)}`).join(' · ') },
              { head: 'Délka (str.)', cell: (r) => eighths(r.lines), value: (r) => r.lines, right: true },
              { head: 'Slov', cell: (r) => r.words, value: (r) => r.words, right: true },
              { head: 'Postavy', cell: (r) => names(r.cast, p.characters) },
              { head: 'Motivy', cell: (r) => names(r.tags, p.tags) },
              { head: 'Napětí', cell: (r) => r.tension, value: (r) => r.tension, right: true },
            ]}
          />
        )}

        {tab === 'locations' && (
          <Table
            name={`${base} – lokace`}
            rows={locations(sc)}
            cols={[
              { head: 'Místo', cell: (r) => r.location },
              { head: 'INT/EXT', cell: (r) => r.intExt.join(', ') },
              { head: 'Denní doby', cell: (r) => r.times.join(', ') },
              { head: 'Počet scén', cell: (r) => r.scenes.length, value: (r) => r.scenes.length, right: true },
              { head: 'Scény č.', cell: (r) => r.scenes.join(', ') },
              { head: 'Délka (str.)', cell: (r) => eighths(r.lines), value: (r) => r.lines, right: true },
            ]}
          />
        )}

        {tab === 'cast' && (
          <Table
            name={`${base} – postavy`}
            rows={cast(p, sc)}
            cols={[
              { head: 'Postava', cell: (r) => r.name },
              { head: 'Role', cell: (r) => r.role },
              { head: 'Scény s replikou', cell: (r) => r.speaking.length, value: (r) => r.speaking.length, right: true },
              { head: 'Scény bez repliky', cell: (r) => r.nonSpeaking.length, value: (r) => r.nonSpeaking.length, right: true },
              { head: 'Replik', cell: (r) => r.speeches, value: (r) => r.speeches, right: true },
              { head: 'Slov v dialogu', cell: (r) => r.words, value: (r) => r.words, right: true },
              { head: 'Podíl dialogu', cell: (r) => pct(r.share), value: (r) => r.share, right: true },
              { head: 'Vulgarismů', cell: (r) => r.profanity, value: (r) => r.profanity, right: true },
              { head: 'Beatů', cell: (r) => r.beats, value: (r) => r.beats, right: true },
              { head: 'Nejčastěji ve scéně s', cell: (r) => r.partners.map((x) => `${x.name} (${x.scenes}×)`).join(', ') },
            ]}
          />
        )}

        {tab === 'tags' && (
          <Table
            name={`${base} – motivy`}
            rows={tagCategories(p).flatMap((cat) => p.tags.filter((x) => x.category === cat))}
            cols={[
              { head: 'Motiv', cell: (r) => r.name || 'Bez názvu' },
              { head: 'Kategorie', cell: (r) => r.category },
              {
                head: 'Výskytů',
                cell: (r) => p.order.filter((id) => p.beats[id]?.tagIds.includes(r.id)).length,
                value: (r) => p.order.filter((id) => p.beats[id]?.tagIds.includes(r.id)).length,
                right: true,
              },
              {
                head: 'V beatech',
                cell: (r) =>
                  p.order
                    .filter((id) => p.beats[id]?.tagIds.includes(r.id))
                    .map((id) => `${beatNumber(p, id)}. ${beatName(p, id)}${r.mode !== 'none' ? ` (${p.beats[id].tagLevels[r.id] ?? 5})` : ''}`)
                    .join(' · '),
              },
            ]}
          />
        )}

        {tab === 'map' && <StoryMap s={s} />}

        {tab === 'notes' && (
          <Table
            name={`${base} – poznámky`}
            rows={p.order.flatMap((id) => (p.beats[id]?.paras ?? []).filter((x) => x.note?.trim()).map((x) => ({ beat: id, para: x })))}
            onRow={(r) => goScene(r.beat)}
            cols={[
              { head: 'Beat', cell: (r) => `${beatNumber(p, r.beat)}. ${beatName(p, r.beat)}`, value: (r) => beatNumber(p, r.beat) },
              { head: 'Prvek', cell: (r) => PARA_LABEL[r.para.type] },
              { head: 'Text', cell: (r) => (r.para.text.length > 70 ? r.para.text.slice(0, 68) + '…' : r.para.text) },
              { head: 'Poznámka', cell: (r) => r.para.note },
            ]}
          />
        )}

        {tab === 'revisions' && <Revisions p={p} />}

        {tab === 'writing' && <Writing p={p} />}
        {tab === 'title' && <TitlePageForm p={p} />}
      </div>
    </div>
  );
}
