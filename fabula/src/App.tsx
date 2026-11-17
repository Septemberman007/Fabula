import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { BeatStatus, ID, STATUS_LABEL } from './model';
import { State, View, actions, getState, ui, useStore } from './store';
import { evaluate } from './evaluate';
import { download, exportFdx, exportFountain, exportOutline, importCau, importFdx, importFountain, normalize } from './io';
import { EMPTY_FILTER, Filter, Hit, filterActive, filterMatches, search } from './filter';
import { Board } from './views/Board';
import { Script } from './views/Script';
import { Timeline } from './views/Timeline';
import { Research } from './views/Research';
import { Reports } from './views/Reports';
import { Backup, PANES_DEFAULT, Panes, loadBackups } from './local';
import { Splitter } from './Splitter';
import { loadNewVersion, useNewVersion } from './version';
import { Bundle, bundleFromNcp, csvStoryformId, exportDramatica, exportSources, importDramatica, isNcp, mergeDramatica, storybeatsFromCsv, storybeatsFromJson } from './dramatica';
import { chooseFolder, listSaved, saveNow, setMinutes, turnOff, unlock, useSaveState } from './autosave';
import { Inspector } from './Inspector';

const VIEWS: [View, string][] = [
  ['board', 'Tabule'],
  ['script', 'Scénář'],
  ['timeline', 'Časová osa'],
  ['all', 'Vše'],
  ['reports', 'Reporty'],
  ['research', 'Rešerše'],
];

const HIT_LABEL: Record<Hit['kind'], string> = { beat: 'Beat', script: 'Scénář', research: 'Rešerše', note: 'Poznámka' };

function Search({ s }: { s: State }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (open ? search(s.project, q) : []), [s.project, q, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (h: Hit) => {
    setOpen(false);
    input.current?.blur();
    if (h.kind === 'research') ui({ view: 'research', research: h.id });
    else if (h.kind === 'note') {
      ui({ view: 'board' });
      setTimeout(() => {
        const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-note="${h.id}"]`);
        el?.scrollIntoView({ block: 'center', inline: 'center' });
        el?.focus();
      }, 60);
    } else ui({ selected: h.id, multi: [], tab: 'detail', view: h.kind === 'script' || s.view === 'research' ? 'script' : s.view });
  };

  return (
    <div className="search">
      <input
        ref={input}
        type="search"
        value={q}
        placeholder="Hledat… (⌘F)"
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) go(hits[0]);
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
      {open && q.trim().length >= 2 && (
        <ul className="search-hits">
          {hits.length === 0 && <li className="muted">Nic nenalezeno.</li>}
          {hits.map((h, i) => (
            <li key={h.kind + h.id + i} onMouseDown={(e) => (e.preventDefault(), go(h))}>
              <small>{HIT_LABEL[h.kind]}</small>
              <b>{h.label}</b>
              <span>{h.snippet}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterBar({ s, count }: { s: State; count: number }) {
  const p = s.project;
  const f = s.filter;
  const toggle = (key: 'chars' | 'tags' | 'lanes', id: ID) =>
    ui({ filter: { ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] } as Filter });
  const group = (label: string, key: 'chars' | 'tags' | 'lanes', items: { id: ID; name: string; color: string }[]) =>
    items.length > 0 && (
      <span className="filter-group">
        <small>{label}</small>
        {items.map((it) => {
          const on = f[key].includes(it.id);
          return (
            <button key={it.id} className={`chip${on ? ' on' : ''}`} style={on ? { background: it.color, borderColor: it.color } : undefined} onClick={() => toggle(key, it.id)}>
              {it.name || 'Bez názvu'}
            </button>
          );
        })}
      </span>
    );
  return (
    <div className="filterbar">
      {group('Postavy', 'chars', p.characters)}
      {group('Motivy', 'tags', p.tags)}
      {group('Linie', 'lanes', p.lanes)}
      <span className="filter-group">
        <small>Stav</small>
        <select value={f.status} onChange={(e) => ui({ filter: { ...f, status: e.target.value as BeatStatus | '' } })}>
          <option value="">všechny</option>
          {(Object.keys(STATUS_LABEL) as BeatStatus[]).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]}
            </option>
          ))}
        </select>
      </span>
      <span className="filter-result">
        {filterActive(f) ? (
          <>
            odpovídá {count} z {Object.keys(p.beats).length} beatů <button onClick={() => ui({ filter: EMPTY_FILTER })}>Zrušit filtr</button>
          </>
        ) : (
          <span className="muted">Vyber, co chceš vidět – ostatní beaty se ztlumí a ve scénáři skryjí.</span>
        )}
      </span>
    </div>
  );
}

/** Posune kurzor na předchozí nebo další beat v pořadí vyprávění. */
function step(dir: 1 | -1) {
  const { project: p, selected } = getState();
  const beats = p.order.filter((id) => p.beats[id]);
  if (!beats.length) return;
  const i = selected ? beats.indexOf(selected) : -1;
  const next = beats[Math.max(0, Math.min(beats.length - 1, i < 0 ? (dir === 1 ? 0 : beats.length - 1) : i + dir))];
  ui({ selected: next, multi: [], tab: 'detail' });
}

const clock = (t: number) => new Date(t).toLocaleTimeString('cs', { hour: '2-digit', minute: '2-digit' });

/** Nastavení automatického ukládání do složky na disku. */
function AutosaveDialog({ onClose }: { onClose: () => void }) {
  const st = useSaveState();
  const [files, setFiles] = useState<Awaited<ReturnType<typeof listSaved>> | null>(null);
  useEffect(() => {
    if (st.status === 'on') void listSaved().then(setFiles);
    else setFiles(null);
  }, [st.status, st.lastSaved]);

  const open = async (f: { name: string; read: () => Promise<string> }) => {
    try {
      const project = normalize(JSON.parse(await f.read()));
      if (!project) throw new Error('format');
      if (confirm(`Otevřít „${f.name}“? Současný příběh se předtím zazálohuje.`)) {
        actions.loadProject(project);
        onClose();
      }
    } catch {
      alert('Soubor se nepodařilo načíst.');
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Automatické ukládání na disk</h3>
        {!st.supported ? (
          <p className="notice">
            Tento prohlížeč neumí zapisovat do složky na disku. Funguje to v Chromu, Edgi a dalších prohlížečích na Chromiu; v Safari a Firefoxu používej Soubor → Uložit
            projekt.
          </p>
        ) : (
          <>
            <p className="muted small">
              Zvol složku – třeba na iCloud Drive – a příběh se do ní bude sám ukládat jako „název.fabula.json“. Každou půlhodinu práce navíc přibude kopie v podsložce
              „zalohy“ (posledních 12).
            </p>
            <div className="save-row">
              <div>
                <small>Složka</small>
                <b>{st.folder || 'nezvolena'}</b>
              </div>
              <button className={st.status === 'off' ? 'primary' : ''} onClick={() => void chooseFolder()}>
                {st.status === 'off' ? 'Zvolit složku…' : 'Změnit…'}
              </button>
            </div>
            {st.embedded && st.status === 'off' && (
              <p className="notice">
                Tohle je vestavěný náhled, ve kterém výběr složky nefunguje: okno se otevře, ale zvolená složka se sem nevrátí. Otevři adresu <b>{location.origin}</b> v Chromu
                a zapni ukládání tam. Příběh si tam přeneseš přes Soubor → Uložit projekt a v Chromu Soubor → Otevřít.
              </p>
            )}
            {st.status === 'off' && st.error && <p className="notice">{st.error}</p>}
            {st.status === 'locked' && (
              <p className="notice">
                Prohlížeč po znovunačtení stránky potřebuje přístup ke složce potvrdit. <button onClick={() => void unlock()}>Povolit ukládání</button>
              </p>
            )}
            {st.status !== 'off' && (
              <>
                <div className="save-row">
                  <div>
                    <small>Ukládat po</small>
                    <select value={st.minutes} onChange={(e) => setMinutes(+e.target.value)}>
                      {[1, 2, 5, 10, 15].map((m) => (
                        <option key={m} value={m}>
                          {m} {m === 1 ? 'minutě' : 'minutách'} od změny
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="save-status">
                    {st.lastSaved ? `Naposledy uloženo ${clock(st.lastSaved)}` : 'Zatím neuloženo'}
                    {st.dirty && ' · čekají změny'}
                  </div>
                  <button disabled={st.status !== 'on'} onClick={() => void saveNow()}>
                    Uložit teď
                  </button>
                </div>
                {st.error && <p className="notice">Uložení se nepovedlo: {st.error}</p>}
                {files && files.length > 0 && (
                  <>
                    <h4>Ve složce</h4>
                    <ul className="backup-list">
                      {files.slice(0, 20).map((f) => (
                        <li key={(f.backup ? 'z/' : '') + f.name}>
                          <div>
                            <b>{f.name.replace(/\.fabula\.json$/, '')}</b>
                            <small>
                              {f.backup ? 'záloha · ' : ''}
                              {new Date(f.modified).toLocaleString('cs')}
                            </small>
                          </div>
                          <button onClick={() => void open(f)}>Otevřít</button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <button className="danger" onClick={() => void turnOff()}>
                  Vypnout ukládání na disk
                </button>
              </>
            )}
          </>
        )}
        <p>
          <button onClick={onClose}>Zavřít</button>
        </p>
      </div>
    </div>
  );
}

export function App() {
  const s = useStore();
  const p = s.project;
  const issues = useMemo(() => evaluate(p), [p]);
  // V pohledu Vše se tabule a osa při psaní nepřekreslují s každým úhozem, ale až po krátké pauze;
  // u dlouhého scénáře by jinak psaní drhlo. Výběr beatu a ostatní změny se projeví hned.
  const [slow, setSlow] = useState(s);
  useEffect(() => {
    if (s.view !== 'all' || s.project === slow.project) return setSlow(s);
    const t = setTimeout(() => setSlow(s), 350);
    return () => clearTimeout(t);
  }, [s]);
  const matches = useMemo(() => filterMatches(p, s.filter), [p, s.filter]);
  // Vstupy pro odložené panely se počítají z odloženého stavu, aby jim zůstaly stejné, dokud se píše.
  const slowIssues = useMemo(() => evaluate(slow.project), [slow.project]);
  const slowMatches = useMemo(() => filterMatches(slow.project, slow.filter), [slow.project, slow.filter]);
  const file = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [saveDlg, setSaveDlg] = useState(false);
  const save = useSaveState();
  const newVersion = useNewVersion();
  const pane = (patch: Partial<Panes>) => ui({ panes: { ...getState().panes, ...patch } });
  const side = s.view !== 'research' && s.view !== 'reports';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? actions.redo() : actions.undo();
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Escape') {
        const st = getState();
        if (st.linkFrom) ui({ linkFrom: null });
        else if (st.multi.length) ui({ multi: [] });
        setMenu(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Nový beat nebo předěl vložíme hned za vybranou položku, jinak na konec. */
  const insertIndex = () => {
    const i = s.selected ? p.order.indexOf(s.selected) : -1;
    return i >= 0 ? i + 1 : undefined;
  };
  const addBeat = () => {
    const sel = s.selected ? p.beats[s.selected] : null;
    actions.addBeat(sel?.laneId, insertIndex());
    if (!side) ui({ view: 'board' });
  };

  const base = p.title.trim() || 'pribeh';
  const run = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  const print = () => {
    ui({ view: 'script' });
    setTimeout(() => window.print(), 150);
  };

  const only = (storybeats: Bundle['storybeats'], storyformId?: string): Bundle => ({ storybeats, moments: [], drivers: [], players: [], notes: [], storyformId });
  /** Podklady z Dramatiky: do příběhu ze stejného storyformu se jen doplní; jinak z nich vznikne nový příběh. */
  const openDramatica = (bundle: Bundle, fileName: string) => {
    if (!bundle.storybeats.length && !bundle.moments.length)
      return alert('V souboru jsem nenašel žádné storybeaty. Potřebuju sloupce s throughline, úrovní (Signpost, Progression, Event) a pořadím.');
    const sf = p.storyform;
    // Starší importy měly storybeaty jako karty; ty se nahradí novým rozložením.
    const legacy = Object.values(p.beats).some((b) => 'dramatica' in b);
    const same = !!sf?.beats.length && !legacy && (!sf.id || !bundle.storyformId || sf.id === bundle.storyformId);
    if (same) {
      let res = { added: 0, updated: 0, conflicts: 0 };
      actions.editScript((draft) => void (res = mergeDramatica(draft, bundle)));
      alert(
        `Z Dramatiky doplněno: ${res.added} nových položek, ${res.updated} změněných storybeatů.` +
          (res.conflicts ? ` U ${res.conflicts} storybeatů se text změnil tady i v Dramatice: zůstalo znění z Fabuly.` : '') +
          ' Scény, jejich pořadí ani text scénáře se nezměnily; krok lze vrátit přes Zpět.',
      );
    } else {
      if (sf?.beats.length && !legacy && !confirm('Soubor patří k jinému storyformu než otevřený příběh. Otevřít ho jako nový příběh? Současný se předtím zazálohuje.')) return;
      actions.loadProject(importDramatica(bundle, bundle.title ?? fileName.replace(/\.(csv|json)$/i, '').replace(/-ncp$/i, '')));
    }
    ui({ view: 'board' });
  };

  /** Otevře projekt Fabula, dokument Causality (.cau), Final Draft (.fdx) nebo scénář Fountain. */
  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (ext === 'csv') return openDramatica(only(storybeatsFromCsv(text), csvStoryformId(text)), f.name);
      if (ext === 'fdx' || text.trimStart().startsWith('<')) return actions.loadProject(importFdx(text, f.name));
      if (ext === 'fountain' || ext === 'txt') return actions.loadProject(importFountain(text, f.name));
      const data = JSON.parse(text);
      const project = normalize(data);
      if (project) return actions.loadProject(project);
      if (isNcp(data)) return openDramatica(bundleFromNcp(data), f.name);
      const beats = storybeatsFromJson(data);
      if (beats.length) return openDramatica(only(beats), f.name);
      actions.loadProject(importCau(data, f.name));
    } catch (e) {
      console.error(e);
      alert(`Soubor „${f.name}“ se nepodařilo načíst (${e instanceof Error ? e.message : String(e)}). Otevřít lze projekt Fabula (.fabula.json), dokument Causality (.cau), Final Draft (.fdx), scénář Fountain (.fountain) storybeaty z Dramatiky (.csv) nebo její storyform (NCP .json).`);
    }
  };
  const newProject = () => {
    if (confirm('Začít nový prázdný příběh? Ten současný si můžeš předtím uložit do souboru; krok lze vrátit přes Zpět.')) actions.newProject();
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Fabula</span>
        <input className="project-title" value={p.title} onChange={(e) => actions.setTitle(e.target.value)} aria-label="Název příběhu" />
        <nav className="views">
          {VIEWS.map(([id, label]) => (
            <button key={id} className={s.view === id ? 'on' : ''} onClick={() => ui({ view: id, linkFrom: null, multi: id === 'board' || id === 'all' || id === 'timeline' || id === 'script' ? s.multi : [] })}>
              {label}
            </button>
          ))}
        </nav>
        <span className="stepper">
          <button onClick={() => step(-1)} title="Předchozí beat (⌥←)">
            ◂
          </button>
          <button onClick={() => step(1)} title="Další beat (⌥→)">
            ▸
          </button>
        </span>
        <Search s={s} />
        <button className={`filter-btn${filterActive(s.filter) ? ' active' : ''}`} onClick={() => ui({ filterOpen: !s.filterOpen })} aria-expanded={s.filterOpen}>
          Filtr{matches ? ` (${matches.size})` : ''}
        </button>
        <div className="tools">
          <button className="primary" onClick={addBeat}>
            + Beat
          </button>
          <button onClick={() => actions.addBreak(insertIndex())}>+ Předěl</button>
          <span className="sep" />
          <button onClick={actions.undo} disabled={!s.past.length} title="Zpět (⌘Z)">
            Zpět
          </button>
          <button onClick={actions.redo} disabled={!s.future.length} title="Znovu (⇧⌘Z)">
            Znovu
          </button>
          <span className="sep" />
          <button className={s.inspector ? 'pressed' : ''} onClick={() => ui({ inspector: !s.inspector })} title="Zobrazit nebo skrýt pravý panel" aria-pressed={s.inspector}>
            Detail
          </button>
          <button onClick={() => actions.setTheme(s.theme === 'dark' ? 'light' : 'dark')} title={s.theme === 'dark' ? 'Přepnout na světlý vzhled' : 'Přepnout na tmavý vzhled'}>
            {s.theme === 'dark' ? 'Světlý' : 'Tmavý'}
          </button>
          <button
            className={`save-chip ${save.status}${save.error ? ' err' : ''}`}
            onClick={() => (save.status === 'locked' ? void unlock() : setSaveDlg(true))}
            title="Automatické ukládání do složky na disku"
          >
            {save.status === 'off'
              ? 'Neukládá se na disk'
              : save.status === 'locked'
                ? 'Povolit ukládání'
                : save.error
                  ? 'Uložení selhalo'
                  : save.dirty
                    ? 'Neuložené změny'
                    : save.lastSaved
                      ? `Uloženo ${clock(save.lastSaved)}`
                      : 'Ukládání zapnuto'}
          </button>
          <div className="menu-wrap">
            <button onClick={() => setMenu(!menu)} aria-expanded={menu}>
              Soubor ▾
            </button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={run(() => file.current?.click())}>
                  Otevřít…<small>Fabula, Causality (.cau), Final Draft (.fdx), Fountain, Dramatica (.csv, NCP .json)</small>
                </button>
                <button onClick={run(() => download(`${base}.fabula.json`, JSON.stringify(p, null, 2), 'application/json'))}>Uložit projekt</button>
                <button onClick={run(() => setSaveDlg(true))}>
                  Automatické ukládání na disk…<small>do složky podle tvého výběru, např. iCloud Drive</small>
                </button>
                <hr />
                <button onClick={run(() => download(`${base}.fdx`, exportFdx(p), 'application/xml'))}>
                  Export do Final Draftu (.fdx)<small>scénář včetně názvů a synopsí scén</small>
                </button>
                <button onClick={run(() => download(`${base}.fountain`, exportFountain(p)))}>
                  Export scénáře (Fountain)<small>otevře Highland, Fade In, Slugline…</small>
                </button>
                <button onClick={run(() => download(`${base} – osnova.txt`, exportOutline(p)))}>
                  Export osnovy (text)<small>beaty s příčinami slovy</small>
                </button>
                {(p.storyform?.beats.length ?? 0) > 0 && (
                  <button onClick={run(() => download(`${base} – dramatica.json`, JSON.stringify({ storybeats: exportDramatica(p), scenes: exportSources(p) }, null, 2), 'application/json'))}>
                    Export pro Dramaticu (.json)<small>synopse, Storytelling a pořadí scén k zápisu zpět</small>
                  </button>
                )}
                <button onClick={run(print)}>
                  Tisk / PDF scénáře<small>v dialogu tisku zvol „Uložit jako PDF“</small>
                </button>
                <hr />
                <button onClick={run(() => void loadBackups().then(setBackups))}>
                  Obnovit ze zálohy…<small>průběžné zálohy v tomto prohlížeči</small>
                </button>
                <button onClick={run(newProject)}>Nový příběh</button>
                <small className="menu-version">Verze z {new Date(__BUILD__).toLocaleString('cs', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
              </div>
            )}
          </div>
          <input ref={file} type="file" accept=".json,.cau,.fdx,.fountain,.txt,.csv,application/json,text/csv" hidden onChange={openFile} />
        </div>
      </header>
      {newVersion && (
        <div className="new-version">
          Je k dispozici nová verze Fabuly. Tvůj příběh zůstane, jak je.
          <button className="primary" onClick={loadNewVersion}>
            Načíst novou verzi
          </button>
        </div>
      )}
      {s.saveError && <div className="save-error">Projekt se nepodařilo uložit do prohlížeče ({s.saveError}). Ulož ho přes Soubor → Uložit projekt, ať o práci nepřijdeš.</div>}
      {saveDlg && <AutosaveDialog onClose={() => setSaveDlg(false)} />}
      {backups && (
        <div className="modal-back" onClick={() => setBackups(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Zálohy</h3>
            <p className="muted small">Záloha vzniká nejvýše jednou za pět minut práce a před otevřením jiného projektu. Uchovává se posledních šest, jen v tomto prohlížeči.</p>
            {backups.length === 0 && <p className="muted">Zatím žádná záloha neexistuje.</p>}
            <ul className="backup-list">
              {backups.map((b) => (
                <li key={b.time}>
                  <div>
                    <b>{b.title || 'Bez názvu'}</b>
                    <small>
                      {new Date(b.time).toLocaleString('cs')} · {b.beats} beatů · {b.reason}
                    </small>
                  </div>
                  <button
                    onClick={() => {
                      const project = normalize(b.project);
                      if (project && confirm('Nahradit současný příběh touto zálohou? Současný stav se předtím také zazálohuje.')) {
                        actions.loadProject(project);
                        setBackups(null);
                      }
                    }}
                  >
                    Obnovit
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => setBackups(null)}>Zavřít</button>
          </div>
        </div>
      )}
      {s.filterOpen && side && <FilterBar s={s} count={matches?.size ?? 0} />}
      <main className="main">
        <div className="view">
          {s.view === 'board' && <Board s={s} issues={issues} matches={matches} />}
          {s.view === 'script' && <Script s={s} matches={matches} zoomable />}
          {s.view === 'timeline' && <Timeline s={s} matches={matches} />}
          {s.view === 'all' && (
            <div className="all" style={{ ['--p-script' as string]: s.panes.script, ['--p-tl' as string]: s.panes.timeline }}>
              {s.panes.scriptOff ? (
                <button className="all-show" onClick={() => pane({ scriptOff: false })} title="Zobrazit okno se scénářem">
                  <span>Scénář ▸</span>
                </button>
              ) : (
                <>
                  <div className="all-script compact">
                    <Script s={s} matches={matches} onHide={() => pane({ scriptOff: true })} />
                  </div>
                  <Splitter name="--p-script" min={0.15} max={0.8} what="scénář" onChange={(script) => pane({ script })} onReset={() => pane({ script: PANES_DEFAULT.script })} />
                </>
              )}
              <div className="all-right">
                <div className="all-timeline">
                  <Timeline s={slow} matches={slowMatches} />
                </div>
                <Splitter name="--p-tl" min={0.12} max={0.85} what="časová osa a tabule" onChange={(timeline) => pane({ timeline })} onReset={() => pane({ timeline: PANES_DEFAULT.timeline })} />
                <div className="all-board">
                  <Board s={slow} issues={slowIssues} matches={slowMatches} noSplit />
                </div>
              </div>
            </div>
          )}
          {s.view === 'reports' && <Reports s={s} />}
          {s.view === 'research' && <Research s={s} />}
        </div>
        {side && s.inspector && <Inspector s={s} issues={issues} />}
      </main>
    </div>
  );
}
