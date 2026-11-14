import { TextareaHTMLAttributes, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Beat, ID, Tag } from '../model';
import { State, actions, getState, ui } from '../store';
import { BeatEditor } from '../BeatEditor';
import { ZoomSlider } from '../ZoomSlider';
import { beatWords, hasText } from '../text';
import { PAPERS, Pagination, pageRange, paginate } from '../paginate';
import { Pages } from './Pages';

const AUTO_SIZE = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/** Textové pole, které roste s obsahem. */
export function AutoText(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (AUTO_SIZE) return;
    const el = ref.current!;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

interface BeatProps {
  beat: Beat;
  n: number;
  laneColor?: string;
  selected: boolean;
  folded: boolean;
  tags: Tag[];
  sceneBase: number;
  /** Strany, na kterých beat leží („12“ nebo „12–13“). */
  pages: string;
  /** Zlomy stran v odstavcích beatu. */
  marks: string;
  onFold: (id: ID) => void;
}

/** Jeden beat ve scénáři. Zapamatovaný, aby se při psaní překreslil jen ten, který se mění. */
const ScriptBeat = memo(function ScriptBeat({ beat: b, n, laneColor, selected, folded, tags, sceneBase, pages, marks, onFold }: BeatProps) {
  const id = b.id;
  const pick = () => getState().selected !== id && ui({ selected: id, tab: 'detail' });
  return (
    <section
      data-script-beat={id}
      className={`script-beat${selected ? ' selected' : ''}${b.off ? ' off' : ''}`}
      style={{ ['--lane' as string]: laneColor }}
      onFocus={pick}
      onClick={pick}
    >
      <div className="script-meta">
        <div className="script-head">
          <button className="script-fold" title={folded ? 'Rozbalit' : 'Sbalit'} onClick={() => onFold(id)}>
            {folded ? '▸' : '▾'}
          </button>
          <span className="script-num">{n}</span>
          <input
            className="script-title"
            value={b.title}
            placeholder="Název beatu"
            title={b.off ? 'Vyřazeno ze scénáře' : undefined}
            onChange={(e) => actions.updateBeat(id, { title: e.target.value }, 'title')}
          />
          {pages && <span className="script-pages" title="Strana scénáře">str. {pages}</span>}
        </div>
        {b.tagIds.length > 0 && (
          <div className="script-tags">
            {tags
              .filter((t) => b.tagIds.includes(t.id))
              .map((t) => (
                <span key={t.id} style={{ background: t.color }} title={t.category}>
                  {t.name || 'Bez názvu'}
                </span>
              ))}
          </div>
        )}
        {!folded && (
          <AutoText
            className="script-syn"
            value={b.synopsis}
            placeholder="Co se tu stane a proč…"
            onChange={(e) => actions.updateBeat(id, { synopsis: e.target.value }, 'synopsis')}
          />
        )}
      </div>
      {!folded && <BeatEditor beat={b} sceneBase={sceneBase} marks={marks} />}
    </section>
  );
});

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

export function Script({ s, matches, zoomable }: { s: State; matches: Set<ID> | null; zoomable?: boolean }) {
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
        {beats.filter(hasText).length} z {beats.length} beatů rozepsáno · {sceneCount} scén · {words} slov · {pages} str. (≈ {pages} min)
        {hiddenCount > 0 && <b> · {hiddenCount} beatů skryto filtrem</b>}
        {canSpeak && (
          <button className="read-btn" onClick={reading ? stop : read} title="Přečte scénář nahlas od vybraného beatu">
            {reading ? 'Zastavit čtení' : 'Číst nahlas'}
          </button>
        )}
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
        {zoomable && <ZoomSlider value={s.scriptZoom} min={0.6} max={2} what="scénář" onChange={(z) => ui({ scriptZoom: z })} />}
      </div>
      {(paged || printing) && <Pages p={p} pg={pg} zoom={s.scriptZoom} selected={s.selected} />}
      {!paged && (
      <div className="page" style={zoomable && s.scriptZoom !== 1 ? { zoom: s.scriptZoom } : undefined}>
        {p.order.map((id) => {
          const brk = p.breaks[id];
          if (brk) {
            return (
              <h2 key={id} className="script-break" onClick={() => ui({ selected: id, tab: 'detail' })}>
                {brk.title || 'Předěl'}
              </h2>
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
              selected={s.selected === id}
              folded={folded.has(id)}
              tags={p.tags}
              sceneBase={base}
              pages={pageRange(pg.beat.get(id))}
              marks={beatMarks(pg, b)}
              onFold={fold}
            />
          );
        })}
        {p.order.length === 0 && <p className="muted">Příběh zatím nemá žádné beaty. Přidej první tlačítkem „+ Beat“.</p>}
      </div>
      )}
    </div>
  );
}
