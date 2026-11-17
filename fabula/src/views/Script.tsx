import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Beat, ID, Project, Tag } from '../model';
import { pointsOf, storybeatTag, storybeatsOf } from '../dramatica';
import { THROUGHLINE_COLOR } from '../colors';
import { State, actions, getState, ui } from '../store';
import { BeatParas, SegText, useSurface } from '../Surface';
import { ZoomSlider } from '../ZoomSlider';
import { beatWords, hasText } from '../text';
import { PAPERS, Pagination, pageRange, paginate, paperOf } from '../paginate';
import { Pages } from './Pages';
import { PAGE_COLS_MAX, SCRIPT_SHOW_ALL, SCRIPT_SHOW_NONE, SCRIPT_ZOOM, ScriptShow } from '../local';

interface BeatProps {
  beat: Beat;
  n: number;
  laneColor?: string;
  selected: boolean;
  folded: boolean;
  tags: Tag[];
  /** Storybeaty a storypointy scény: řádky „barva|štítek|text|nápověda“. */
  strip: string;
  sceneBase: number;
  /** Strany, na kterých beat leží („12“ nebo „12–13“). */
  pages: string;
  /** Zlomy stran v odstavcích beatu. */
  marks: string;
  show: ScriptShow;
  /** Odstavec s kurzorem a odstavec s otevřenou poznámkou, pokud jsou v tomto beatu. */
  cur: ID | null;
  noteOpen: ID | null;
  onNoteClose: (id: null) => void;
  onFold: (id: ID) => void;
}

/** Jeden beat ve scénáři. Zapamatovaný, aby se při psaní překreslil jen ten, který se mění. */
const ScriptBeat = memo(function ScriptBeat({ beat: b, n, laneColor, selected, folded, tags, strip, sceneBase, pages, marks, show, cur, noteOpen, onNoteClose, onFold }: BeatProps) {
  const id = b.id;
  const pick = () => getState().selected !== id && ui({ selected: id, tab: 'detail' });
  // Bez názvů není čím beat rozbalit, takže se sbalení neuplatní.
  const closed = folded && show.titles;
  const bare = !show.titles && !show.synopsis && !show.tags && !(show.dramatica && strip);
  return (
    <section
      data-script-beat={id}
      data-beat-root={id}
      className={`script-beat${selected ? ' selected' : ''}${b.off ? ' off' : ''}${bare ? ' bare' : ''}`}
      style={{ ['--lane' as string]: laneColor }}
      onClick={pick}
    >
      {show.titles && (
        <div className="script-head">
          <button contentEditable={false} className="script-fold" title={closed ? 'Rozbalit' : 'Sbalit'} onClick={() => onFold(id)}>
            {closed ? '▸' : '▾'}
          </button>
          <span contentEditable={false} className="script-num">
            {n}
          </span>
          <SegText seg="title" beatId={id} text={b.title} className="script-title" ph="Název beatu" />
          {pages && (
            <span contentEditable={false} className="script-pages" title="Strana scénáře">
              str. {pages}
            </span>
          )}
        </div>
      )}
      {show.tags && b.tagIds.length > 0 && (
        <div className="script-tags" contentEditable={false}>
          {tags
            .filter((t) => b.tagIds.includes(t.id))
            .map((t) => (
              <span key={t.id} style={{ background: t.color }} title={t.category}>
                {t.name || 'Bez názvu'}
              </span>
            ))}
        </div>
      )}
      {show.dramatica && strip && !closed && (
        <div className="script-strip" contentEditable={false}>
          {strip.split('\n').map((row) => {
            const [color, tag, label, hint] = row.split('|');
            return (
              <span key={tag + label} title={hint || undefined}>
                {color ? <i style={{ background: color }}>{tag}</i> : <i className="plain">{tag}</i>}
                {label}
              </span>
            );
          })}
        </div>
      )}
      {show.synopsis && !closed && <SegText seg="syn" beatId={id} text={b.synopsis} className="script-syn" ph="Co se tu stane a proč…" />}
      {!closed && <BeatParas beat={b} sceneBase={sceneBase} marks={marks} cur={cur} noteOpen={noteOpen} onNoteClose={onNoteClose} />}
    </section>
  );
});

/** Co scéna nese z Dramatiky, jako text: řetězec se nemění, dokud se nezmění obsah, takže se scéna zbytečně nepřekresluje. */
function stripOf(p: Project, b: Beat): string {
  if (!b.storybeats?.length && !b.points?.length) return '';
  const clean = (t: string) => t.replace(/[|\n]/g, ' ');
  return [
    ...storybeatsOf(p, b).map((x) => `${THROUGHLINE_COLOR[x.throughline]}|${storybeatTag(x)}|${clean(x.fn)}|${clean(x.summary)}`),
    ...pointsOf(p, b).map((x) => `|${x.throughline || 'příběh'}|${clean(`${x.name}: ${x.fn}`)}|${clean(x.summary)}`),
  ].join('\n');
}

/** Mezera mezi listy v náhledu stran (px, stejná jako v CSS). */
const SHEET_GAP = 18;

/** Zlomy stran v odstavcích jednoho beatu jako text (viz BeatEditor). */
function beatMarks(pg: Pagination, b: Beat): string {
  const out: string[] = [];
  for (const para of b.paras) {
    const at = pg.para.get(para.id);
    if (!at) continue;
    if (at.breakBefore) out.push(`${para.id}>${at.page}`);
    for (const x of at.splits) out.push(`${para.id}@${x.after}>${x.page}`);
  }
  return out.join('|');
}

/** Text beatu tak, jak se má přečíst: jméno mluvčího se ohlásí, poznámky v závorce se vynechají. */
function spokenLines(paras: { type: string; text: string }[]): string[] {
  return paras
    .filter((x) => x.text.trim() && x.type !== 'paren' && x.type !== 'transition')
    .map((x) => (x.type === 'character' ? `${x.text.replace(/\(.*?\)/g, '').trim()}:` : x.text.trim()));
}

export function Script({ s, matches, zoomable, onHide }: { s: State; matches: Set<ID> | null; zoomable?: boolean; onHide?: () => void }) {
  const p = s.project;
  const [reading, setReading] = useState(false);
  // Při tisku se místo editoru vykreslí hotové strany, aby tisk přesně odpovídal stránkování.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!zoomable) return;
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => {
      window.removeEventListener('beforeprint', on);
      window.removeEventListener('afterprint', off);
    };
  }, [zoomable]);
  const paged = !!zoomable && s.paged;
  // Náhled stran se na úzkém displeji zmenší tak, aby se list vešel na šířku.
  const box = useRef<HTMLDivElement>(null);
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWinW(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  // Více stran vedle sebe: velikost se řídí jen jejich počtem, aby se na šířku vešly všechny.
  const cols = paged ? s.pageCols : 1;
  const sheetW = PAPERS[paperOf(s.project)].px + 2;
  const sheetFit = Math.min(1, winW / (cols * sheetW + (cols - 1) * SHEET_GAP));
  const show = s.scriptShow;
  const root = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sf = useSurface(root, wrap, true);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  /** Čte scénář nahlas od vybraného beatu; vybraný beat se posouvá s četbou. */
  const read = () => {
    const ids = p.order.filter((id) => p.beats[id] && !p.beats[id].off && (!matches || matches.has(id)));
    const queue = ids.slice(Math.max(0, s.selected ? ids.indexOf(s.selected) : 0));
    const synth = window.speechSynthesis;
    synth.cancel();
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('cs'));
    const next = () => {
      const id = queue.shift();
      if (!id) return setReading(false);
      const lines = spokenLines(p.beats[id].paras);
      if (!lines.length) return next();
      ui({ selected: id, multi: [] });
      const u = new SpeechSynthesisUtterance(lines.join('\n'));
      u.lang = 'cs-CZ';
      if (voice) u.voice = voice;
      u.onend = next;
      u.onerror = () => setReading(false);
      synth.speak(u);
    };
    setReading(true);
    next();
  };
  const stop = () => {
    window.speechSynthesis.cancel();
    setReading(false);
  };
  /** Beaty sbalené na pouhý název. */
  const [folded, setFolded] = useState<Set<ID>>(new Set());
  const fold = useCallback(
    (id: ID) =>
      setFolded((f) => {
        const next = new Set(f);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      }),
    [],
  );
  const hiddenCount = matches ? Object.keys(p.beats).length - matches.size : 0;

  // Beat vybraný jinde (hledání, problémy, časová osa) posuneme do zorného pole.
  useEffect(() => {
    if (s.selected) document.querySelector(`[data-script-beat="${s.selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [s.selected]);
  const beats = p.order.filter((id) => p.beats[id] && !p.beats[id].off).map((id) => p.beats[id]);
  const laneColor = new Map(p.lanes.map((l) => [l.id, l.color]));
  const sceneCount = p.order.reduce((k, id) => k + (p.beats[id]?.paras.filter((x) => x.type === 'scene' && x.text.trim()).length ?? 0), 0);
  let sceneBase = 0;
  const words = beats.reduce((n, b) => n + beatWords(b), 0);
  const pg = paginate(p);
  const pages = pg.pages.length;
  let n = 0;

  return (
    <div className="script">
      <div className="script-stats">
        <span className="script-count">
        {beats.filter(hasText).length} z {beats.length} beatů rozepsáno · {sceneCount} scén · {words} slov · {pages} str. (≈ {pages} min)
        {hiddenCount > 0 && <b> · {hiddenCount} beatů skryto filtrem</b>}
        </span>
        {canSpeak && (
          <button className="read-btn" onClick={reading ? stop : read} title="Přečte scénář nahlas od vybraného beatu">
            {reading ? 'Zastavit čtení' : 'Číst nahlas'}
          </button>
        )}
        <details className="show-menu">
          <summary title="Co se kromě textu scénáře zobrazuje">{Object.values(show).some(Boolean) ? 'Zobrazit' : 'Čistý scénář'}</summary>
          <div>
            {(
              [
                ['titles', 'Názvy beatů'],
                ['synopsis', 'Synopse'],
                ['tags', 'Motivy'],
                ['breaks', 'Předěly'],
                ['dramatica', 'Storybeaty a storypointy'],
                ['pages', 'Čísla a zlomy stran'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <input type="checkbox" checked={show[k]} onChange={(e) => ui({ scriptShow: { ...show, [k]: e.target.checked } })} />
                {label}
              </label>
            ))}
            <button onClick={() => ui({ scriptShow: SCRIPT_SHOW_NONE })}>Jen čistý scénář</button>
            <button onClick={() => ui({ scriptShow: SCRIPT_SHOW_ALL })}>Zobrazit vše</button>
          </div>
        </details>
        {zoomable && (
          <span className="seg">
            <button className={paged ? '' : 'on'} onClick={() => ui({ paged: false })} title="Psaní po beatech se značkami zlomů stran">
              Psaní
            </button>
            <button className={paged ? 'on' : ''} onClick={() => ui({ paged: true })} title="Náhled scénáře po stranách, jak se vytiskne">
              Strany
            </button>
          </span>
        )}
        {zoomable && (
          <select className="paper-select" value={pg.paper} title="Formát papíru pro stránkování a tisk" onChange={(e) => actions.setPaper(e.target.value as 'a4' | 'letter')}>
            {(['a4', 'letter'] as const).map((k) => (
              <option key={k} value={k}>
                {PAPERS[k].label}
              </option>
            ))}
          </select>
        )}
        {paged && (
          <select className="paper-select" value={cols} title="Kolik stran je vedle sebe" onChange={(e) => ui({ pageCols: +e.target.value })}>
            {Array.from({ length: PAGE_COLS_MAX }, (_, i) => i + 1).map((k) => (
              <option key={k} value={k}>
                {k === 1 ? '1 strana' : k < 5 ? `${k} strany vedle sebe` : `${k} stran vedle sebe`}
              </option>
            ))}
          </select>
        )}
        {onHide && (
          <button className="read-btn" onClick={onHide} title="Schová okno se scénářem; zůstane časová osa a tabule">
            Skrýt scénář
          </button>
        )}
        {zoomable && cols === 1 && <ZoomSlider value={s.scriptZoom} min={SCRIPT_ZOOM.min} max={SCRIPT_ZOOM.max} what="scénář" onChange={(z) => ui({ scriptZoom: z })} />}
      </div>
      <div className="script-scroll" ref={box}>
      {(paged || printing) && <Pages p={p} pg={pg} zoom={printing ? 1 : cols > 1 ? sheetFit : s.scriptZoom * sheetFit} cols={printing ? 1 : cols} selected={s.selected} />}
      {!paged && (
      <div className="page beat-editor" ref={wrap} style={zoomable && s.scriptZoom !== 1 ? { zoom: s.scriptZoom } : undefined} {...sf.focus}>
        <div key={sf.epoch} ref={root} className="surface" {...sf.host}>
        {p.order.map((id) => {
          const brk = p.breaks[id];
          if (brk) {
            return (
              show.breaks && (
                <h2 key={id} contentEditable={false} className="script-break" onClick={() => ui({ selected: id, tab: 'detail' })}>
                  {brk.title || 'Předěl'}
                </h2>
              )
            );
          }
          const b = p.beats[id];
          n++;
          const base = sceneBase;
          sceneBase += b.paras.filter((x) => x.type === 'scene' && x.text.trim()).length;
          if (matches && !matches.has(id)) return null;
          return (
            <ScriptBeat
              key={id}
              beat={b}
              n={n}
              laneColor={laneColor.get(b.laneId)}
              selected={s.selected === id || s.multi.includes(id)}
              folded={folded.has(id)}
              tags={p.tags}
              strip={stripOf(p, b)}
              sceneBase={base}
              pages={show.pages ? pageRange(pg.beat.get(id)) : ''}
              marks={show.pages ? beatMarks(pg, b) : ''}
              show={show}
              cur={sf.cur?.beatId === id ? sf.cur.paraId : null}
              noteOpen={sf.noteOpen && b.paras.some((x) => x.id === sf.noteOpen) ? sf.noteOpen : null}
              onNoteClose={sf.setNoteOpen}
              onFold={fold}
            />
          );
        })}
        {p.order.length === 0 && <p className="muted" contentEditable={false}>Příběh zatím nemá žádné beaty. Přidej první tlačítkem „+ Beat“.</p>}
        </div>
        {sf.overlay}
      </div>
      )}
      </div>
    </div>
  );
}
