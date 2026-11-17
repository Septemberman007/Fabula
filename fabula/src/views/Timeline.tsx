import { MouseEvent, PointerEvent, ReactNode, memo, useEffect, useMemo, useRef, useState } from 'react';
import { CharRole, Character, Group, ID, ROLE_LABEL, TAG_CATEGORIES, TAG_MODE_LABEL, Tag, beatName, groupBeats, tagCategories } from '../model';
import { hasText } from '../text';
import { ColorBy, State, actions, setZoom, toggleZoomLink, ui } from '../store';
import { detectedCharacters } from '../text';
import { beatPages } from '../paginate';
import { derivedTension, heat, heatColor, tagTension } from '../tension';
import { COLOR_BY_LABEL, beatColor } from '../colors';
import { THROUGHLINES, storybeatTag, weave } from '../dramatica';
import { ZoomSlider } from '../ZoomSlider';
import { TIMELINE_COL, TIMELINE_ZOOM, fitZoom, registerFit } from '../zoom';

const W = TIMELINE_COL;
const BW = 22;
const PAGE_W = 110;
const HEAD = 34;
const CURVE = 150;
const ROW = 30;
const BEAT_ROW = 40;
const TAG_ROW = 58;
const HEAT = 26;
const SECTION = 24;
const PAD = 14;
/** Volné místo za posledním beatem. */
const EXTRA = 40;

interface Row {
  key: string;
  h: number;
  label: ReactNode;
  content: ReactNode;
  /** Typ řádku: určuje vzhled popisku i obsahu. */
  kind?: 'head' | 'section';
}

const sceneLabel = (text: string) => text.replace(/^(INT|EXT)[^\s]*\s*/i, '').replace(/\s[–-]\s\S+$/, '');

export const Timeline = memo(function Timeline({ s, matches }: { s: State; matches: Set<ID> | null }) {
  const p = s.project;
  const scroller = useRef<HTMLDivElement>(null);
  /** Šířka beatu při 100 %: pevná, nebo podle délky textu. */
  const baseWidth = (id: ID) => (s.byLength ? Math.max(48, beatPages(p.beats[id]) * PAGE_W) : W);
  // Při velkém oddálení se zúží i předěly, jinak by zabraly víc místa než beaty.
  /** Hustý režim: sloupce jsou tak úzké, že se do nich nevejdou čísla ani mezery mezi bloky. */
  const dense = W * s.tlZoom < 20;
  const gap = dense ? 0 : 2;
  const breakW = Math.max(6, Math.min(BW, BW * s.tlZoom * 2));
  const { xs, ws, width } = useMemo(() => {
    const xs: Record<ID, number> = {};
    const ws: Record<ID, number> = {};
    let x = 0;
    for (const id of p.order) {
      xs[id] = x;
      ws[id] = p.beats[id] ? baseWidth(id) * s.tlZoom : breakW;
      x += ws[id];
    }
    return { xs, ws, width: x };
  }, [p, s.byLength, s.tlZoom]);

  const beats = p.order.filter((id) => p.beats[id]);
  const breaks = p.order.filter((id) => p.breaks[id]);
  const detected = useMemo(() => new Map(beats.map((id) => [id, detectedCharacters(p, p.beats[id])])), [p]);
  const derived = useMemo(() => derivedTension(p), [p]);
  const heatMap = useMemo(() => heat(p), [p]);
  const weaveData = useMemo(() => weave(p), [p]);
  const cx = (id: ID) => xs[id] + ws[id] / 2;
  const ty = (t: number) => PAD + ((10 - t) / 10) * (CURVE - 2 * PAD);
  const ly = (v: number) => 9 + ((10 - v) / 10) * (TAG_ROW - 18);
  const pts = beats.map((id) => `${cx(id)},${ty(p.beats[id].tension)}`);
  const area = beats.length ? `M ${cx(beats[0])},${CURVE} L ${pts.join(' L ')} L ${cx(beats.at(-1)!)},${CURVE} Z` : '';

  // Gesto roztažení na trackpadu (nebo kolečko s Ctrl či ⌘) osu přibližuje a oddaluje.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      // Gesto přibližuje po desetině současné hodnoty.
      setZoom('timeline', s.tlZoom * (acc < 0 ? 1.1 : 1 / 1.1));
      acc = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [s.tlZoom]);

  // Společný kurzor: vybraný beat posuneme do viditelné části osy.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !s.selected || xs[s.selected] === undefined) return;
    const x = xs[s.selected];
    const w = ws[s.selected];
    if (x < el.scrollLeft || x + w > el.scrollLeft + el.clientWidth) el.scrollTo({ left: Math.max(0, x + w / 2 - el.clientWidth / 2), behavior: 'smooth' });
  }, [s.selected]);

  const dragTension = (id: ID) => (e: PointerEvent<SVGCircleElement>) => {
    if (!(e.buttons & 1)) return;
    const svg = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const t = Math.round(10 - ((e.clientY - svg.top - PAD) / (CURVE - 2 * PAD)) * 10);
    const tension = Math.max(0, Math.min(10, t));
    if (tension !== p.beats[id].tension) actions.updateBeat(id, { tension }, 'tension');
  };

  /** Bod motivu: tažením se mění úroveň, pouhým kliknutím se výskyt odebere. */
  const tagDrag = useRef<{ y: number; moved: boolean } | null>(null);
  const tagDot = (beat: ID, tag: ID) => ({
    onPointerDown: (e: PointerEvent<SVGCircleElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      tagDrag.current = { y: e.clientY, moved: false };
    },
    onPointerMove: (e: PointerEvent<SVGCircleElement>) => {
      const d = tagDrag.current;
      if (!d || !(e.buttons & 1)) return;
      if (Math.abs(e.clientY - d.y) > 3) d.moved = true;
      if (!d.moved) return;
      const svg = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
      const v = Math.max(0, Math.min(10, Math.round(10 - ((e.clientY - svg.top - 9) / (TAG_ROW - 18)) * 10)));
      if (v !== (p.beats[beat].tagLevels[tag] ?? 5)) actions.setTagLevel(beat, tag, v, 'taglevel');
    },
    onPointerUp: () => {
      if (tagDrag.current && !tagDrag.current.moved) actions.toggleTag(beat, tag);
      tagDrag.current = null;
    },
  });

  /** Oddálí tak, aby se celý příběh vešel na šířku okna. */
  const fitValue = (): number | null => {
    const el = scroller.current;
    const total = beats.reduce((n, id) => n + baseWidth(id), 0);
    if (!el || !total) return null;
    // Šířka předělu závisí na přiblížení (6 px až BW), proto tři případy.
    const avail = el.clientWidth - EXTRA - 16;
    const n = breaks.length;
    const mid = avail / (total + 2 * BW * n);
    const z = mid >= 0.5 ? (avail - BW * n) / total : mid * 2 * BW <= 6 ? (avail - 6 * n) / total : mid;
    return Math.min(1, z);
  };
  useEffect(() => registerFit('timeline', fitValue));
  const fit = () => {
    const f = fitZoom('timeline', s.zoomLink);
    if (f) setZoom(f.which, f.value);
  };
  const picked = new Set(s.multi.length ? s.multi : s.selected ? [s.selected] : []);
  /** Právě skončilo tažení výběru: následné kliknutí se nepočítá. */
  const dragged = useRef(false);
  /**
   * Výběr beatu. S ⌘ nebo Ctrl se beat k výběru přidá či z něj odebere, se Shiftem se vybere
   * celý úsek od naposledy vybraného beatu. Výběr je společný s tabulí i scénářem.
   */
  const sel = (id: ID, e?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (dragged.current) return;
    if (e?.shiftKey && s.selected && p.beats[s.selected] && s.selected !== id) {
      const [a, b] = [beats.indexOf(s.selected), beats.indexOf(id)].sort((x, y) => x - y);
      const base = s.multi.length ? s.multi : [s.selected];
      const next = [...new Set([...base, ...beats.slice(a, b + 1)])];
      return ui({ multi: next, selected: id, tab: 'detail' });
    }
    if (e?.metaKey || e?.ctrlKey) {
      const base = s.multi.length ? s.multi : s.selected && p.beats[s.selected] ? [s.selected] : [];
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      return ui({ multi: next.length > 1 ? next : [], selected: next.at(-1) ?? null, tab: 'detail' });
    }
    ui({ selected: id, multi: [], tab: 'detail' });
  };
  /** Tažením po beatech se vybere úsek osy. */
  const [band, setBand] = useState<{ x0: number; x1: number } | null>(null);
  const startBand = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || !(e.target as HTMLElement).closest('.tl-beat, .tl-col, .tl-num')) return;
    const canvas = e.currentTarget;
    const at = (ev: { clientX: number }) => ev.clientX - canvas.getBoundingClientRect().left;
    const x0 = at(e);
    let moved = false;
    const move = (ev: globalThis.MouseEvent) => {
      if (!moved && Math.abs(at(ev) - x0) < 6) return;
      moved = true;
      ev.preventDefault();
      setBand({ x0, x1: at(ev) });
    };
    const up = (ev: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setBand(null);
      if (!moved) return;
      const [l, r] = [x0, at(ev)].sort((a, b) => a - b);
      const ids = beats.filter((id) => xs[id] < r && xs[id] + ws[id] > l);
      dragged.current = true;
      setTimeout(() => (dragged.current = false));
      ui({ multi: ids.length > 1 ? ids : [], selected: ids.at(-1) ?? null, tab: 'detail' });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  /** Beat, do jehož sloupce se kliklo (řádek má jedinou klikací vrstvu přes celou šířku). */
  const beatAt = (e: MouseEvent<HTMLElement>) => {
    const x = e.nativeEvent.offsetX;
    return beats.find((id) => x >= xs[id] && x < xs[id] + ws[id]);
  };
  const hit = (title: string, onBeat: (id: ID) => void) => (
    <div
      className="tl-hit"
      title={title}
      onClick={(e) => {
        const id = beatAt(e);
        if (id) onBeat(id);
      }}
    />
  );
  const isOpen = (key: string) => !s.collapsed.includes(key);
  const toggle = (key: string) => ui({ collapsed: isOpen(key) ? [...s.collapsed, key] : s.collapsed.filter((k) => k !== key) });
  const heatStops = beats.map((id) => `${heatColor(heatMap.get(id) ?? 0)} ${Math.round(cx(id))}px`);
  let n = 0;

  /** Po přidání řádku se vpravo otevře jeho nastavení, kde dostane jméno a barvu. */
  const added = (key: string) => ui({ tab: 'cast', inspector: true, collapsed: s.collapsed.filter((k) => k !== key) });
  const addTag = (cat: string) => {
    actions.addTag(cat, TAG_CATEGORIES.find(([name]) => name === cat)?.[1] ?? 'change');
    added(`tag:${cat}`);
  };
  const section = (key: string, title: string, count: number, onAdd?: () => void): Row => ({
    key,
    h: SECTION,
    kind: 'section',
    label: (
      <>
        <button onClick={() => toggle(key)} aria-expanded={isOpen(key)} title={isOpen(key) ? 'Sbalit' : 'Rozbalit'}>
          {isOpen(key) ? '▾' : '▸'} {title} <small>{count}</small>
        </button>
        {onAdd && (
          <button className="tl-add" onClick={onAdd} title={`Přidat řádek do oddílu ${title}`}>
            +
          </button>
        )}
      </>
    ),
    content: null,
  });

  /** Motiv bez úrovní (mini-zápletka, téma): rovná nit s výskyty. */
  const threadRow = (t: Tag): Row => {
    const used = beats.filter((id) => p.beats[id].tagIds.includes(t.id));
    return {
      key: t.id,
      h: ROW,
      label: (
        <>
          <i className="tag-dot" style={{ borderColor: t.color }} />
          <span className="tl-name">{t.name || 'Bez názvu'}</span>
        </>
      ),
      content: (
        <>
          {used.length > 1 && <span className="tl-thread" style={{ left: cx(used[0]), width: cx(used.at(-1)!) - cx(used[0]), background: t.color }} />}
          {hit(`Kliknutím do sloupce beatu přidáš nebo odebereš „${t.name}“`, (id) => actions.toggleTag(id, t.id))}
          {used.map((id) => (
            <i key={id} className="tl-mark tag on" style={{ left: cx(id), color: t.color }} />
          ))}
        </>
      ),
    };
  };

  /** Motiv s úrovní: křivka, tažitelné body a záře napětí. */
  const curveRow = (t: Tag): Row => {
    const used = beats.filter((id) => p.beats[id].tagIds.includes(t.id));
    const lvl = (id: ID) => p.beats[id].tagLevels[t.id] ?? 5;
    const tens = tagTension(p, t);
    return {
      key: t.id,
      h: TAG_ROW,
      label: (
        <>
          <i className="tag-dot" style={{ borderColor: t.color }} />
          <span className="tl-name">{t.name || 'Bez názvu'}</span>
          <small>{TAG_MODE_LABEL[t.mode]}</small>
        </>
      ),
      content: (
        <>
          {hit(`Kliknutím do sloupce beatu přidáš „${t.name}“`, (id) => !used.includes(id) && actions.toggleTag(id, t.id))}
          <svg className="tl-tagsvg" width={width + EXTRA} height={TAG_ROW}>
            {used.slice(1).map((id, i) => {
              const a = used[i];
              const seg = { x1: cx(a), y1: ly(lvl(a)), x2: cx(id), y2: ly(lvl(id)) };
              // Záři kreslíme po úsecích mezi sousedními beaty, aby odpovídala napětí v daném místě.
              const span = beats.slice(beats.indexOf(a), beats.indexOf(id) + 1);
              const at = (b: ID) => seg.y1 + ((cx(b) - seg.x1) / (seg.x2 - seg.x1)) * (seg.y2 - seg.y1);
              return (
                <g key={id}>
                  {span.slice(1).map((b, j) => {
                    const glow = tens.get(b) ?? 0;
                    return glow > 0.05 ? (
                      <line key={b} x1={cx(span[j])} y1={at(span[j])} x2={cx(b)} y2={at(b)} className="tl-glow" strokeWidth={4 + 16 * glow} opacity={0.25 + 0.55 * glow} />
                    ) : null;
                  })}
                  <line {...seg} stroke={t.color} strokeWidth={2} />
                </g>
              );
            })}
            {used.map((id) => (
              <circle key={id} cx={cx(id)} cy={ly(lvl(id))} r={5.5} fill={t.color} className="tl-tagdot" {...tagDot(id, t.id)}>
                <title>
                  {t.name} v „{beatName(p, id)}“: úroveň {lvl(id)}/10 – táhni pro změnu, klikni pro odebrání
                </title>
              </circle>
            ))}
          </svg>
        </>
      ),
    };
  };

  const charRow = (c: Character): Row => ({
    key: c.id,
    h: ROW,
    label: (
      <>
        <i style={{ background: c.color }} />
        <span className="tl-name">{c.name || 'Bez jména'}</span>
      </>
    ),
    content: (
      <>
        {hit(`Kliknutím do sloupce beatu přiřadíš nebo odebereš postavu ${c.name}`, (id) => actions.toggleCharacter(id, c.id))}
        {beats.map((id) => {
          const manual = p.beats[id].characterIds.includes(c.id);
          if (!manual && !detected.get(id)!.has(c.id)) return null;
          return <i key={id} className={`tl-mark ${manual ? 'on' : 'auto'}`} style={{ left: cx(id), color: c.color }} title={manual ? undefined : 'Rozpoznáno z textu'} />;
        })}
      </>
    ),
  });

  const span = (g: Group) => {
    const members = groupBeats(p, g.id);
    if (!members.length) return null;
    const left = Math.min(...members.map((id) => xs[id]));
    return { g, left, width: Math.max(...members.map((id) => xs[id] + ws[id])) - left };
  };
  const blocks = p.groups.filter((g) => !g.parentId).map(span).filter((x) => x !== null);
  const subgroups = p.groups.filter((g) => g.parentId).map(span).filter((x) => x !== null);

  // Scéna začíná hlavičkou a trvá přes další rozepsané beaty, dokud nepřijde nová hlavička nebo prázdný beat.
  const scenes: { first: ID; last: ID; heading: string; count: number }[] = [];
  let open: (typeof scenes)[number] | null = null;
  for (const id of beats) {
    const heading = p.beats[id].paras.find((x) => x.type === 'scene' && x.text.trim())?.text;
    if (heading) scenes.push((open = { first: id, last: id, heading, count: 1 }));
    else if (open && hasText(p.beats[id])) {
      open.last = id;
      open.count++;
    } else open = null;
  }

  const rows: Row[] = [
    {
      key: 'head',
      h: HEAD,
      kind: 'head',
      label: (
        <ZoomSlider compact value={s.tlZoom} min={TIMELINE_ZOOM.min} max={TIMELINE_ZOOM.max} what="časovou osu" onChange={(z) => setZoom('timeline', z)} linked={s.zoomLink} onLink={toggleZoomLink} onFit={fit} />
      ),
      content: p.order.map((id) =>
        p.beats[id] ? (
          <span key={id} className="tl-num" style={{ left: xs[id], width: ws[id] }} title={p.beats[id].concurrent ? `${p.beats[id].title} – souběžně s předchozím beatem` : p.beats[id].title}>
            {p.beats[id].concurrent && <i className="tl-conc">∥</i>}
            {++n}
          </span>
        ) : (
          <span key={id} className="tl-break-name" style={{ left: xs[id] + breakW }}>
            {p.breaks[id].title}
          </span>
        ),
      ),
    },
    {
      key: 'scenes',
      h: ROW,
      label: (
        <>
          Scény
          <label className="check tl-bylen" title="Šířka beatu podle odhadované délky textu">
            <input type="checkbox" checked={s.byLength} onChange={(e) => ui({ byLength: e.target.checked })} /> podle délky
          </label>
        </>
      ),
      content: scenes.map((sc) => (
        <span
          key={sc.first}
          className="tl-scene"
          style={{ left: xs[sc.first] + gap, width: Math.max(1, xs[sc.last] + ws[sc.last] - xs[sc.first] - 2 * gap - (dense ? 1 : 0)) }}
          title={`${sc.heading.toLocaleUpperCase('cs')}${sc.count > 1 ? ` – ${sc.count} beaty` : ''}`}
          onClick={() => sel(sc.first)}
        >
          {sceneLabel(sc.heading)}
        </span>
      )),
    },
    {
      key: 'beats',
      h: BEAT_ROW,
      label: (
        <>
          Beaty
          <select className="tl-colorby" value={s.colorBy} title="Podle čeho se barví beaty" onChange={(e) => ui({ colorBy: e.target.value as ColorBy })}>
            {(Object.keys(COLOR_BY_LABEL) as ColorBy[]).map((k) => (
              <option key={k} value={k}>
                podle {COLOR_BY_LABEL[k]}
              </option>
            ))}
          </select>
        </>
      ),
      content: beats.map((id) => (
        <span
          key={id}
          className="tl-beat"
          style={{ left: xs[id] + gap, width: Math.max(1, ws[id] - 2 * gap - (dense ? 0.5 : 0)), background: beatColor(p, p.beats[id], s.colorBy) }}
          title={`${beatName(p, id)}${p.beats[id].synopsis ? ' – ' + p.beats[id].synopsis : ''}`}
          onClick={(e) => sel(id, e)}
        >
          {beatName(p, id)}
        </span>
      )),
    },
    {
      key: 'tension',
      h: CURVE,
      label: (
        <>
          Napětí
          <small>táhni body nahoru a dolů{derived && ' · čárkovaně: odvozené z motivů'}</small>
        </>
      ),
      content: (
        <svg className="tl-curve" width={width + EXTRA} height={CURVE}>
          {[0, 5, 10].map((t) => (
            <line key={t} x1={0} x2={width} y1={ty(t)} y2={ty(t)} className="tl-grid" />
          ))}
          {area && <path d={area} className="tl-area" />}
          {derived && beats.length > 1 && <polyline points={beats.map((id) => `${cx(id)},${ty(derived.get(id)! * 10)}`).join(' ')} className="tl-derived" />}
          {pts.length > 1 && <polyline points={pts.join(' ')} className="tl-line" />}
          {beats.map((id) => (
            <circle
              key={id}
              cx={cx(id)}
              cy={ty(p.beats[id].tension)}
              r={s.selected === id ? 8 : 6}
              className={`tl-dot${s.selected === id ? ' selected' : ''}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                sel(id);
              }}
              onPointerMove={dragTension(id)}
            >
              <title>
                {beatName(p, id)} – napětí {p.beats[id].tension}/10
              </title>
            </circle>
          ))}
        </svg>
      ),
    },
    {
      key: 'heat',
      h: HEAT,
      label: <span title="Ruční napětí zprůměrované s napětím z motivů">Heat mapa</span>,
      content: beats.length > 0 && (
        <div className="tl-heat" style={{ width, background: beats.length > 1 ? `linear-gradient(to right, ${heatStops.join(', ')})` : heatColor(heatMap.get(beats[0]) ?? 0) }} />
      ),
    },
  ];

  for (const [key, label, items] of [
    ['blocks', 'Bloky', blocks],
    ['subgroups', 'Skupiny', subgroups],
  ] as const) {
    if (!items.length) continue;
    rows.push({
      key,
      h: ROW,
      label,
      content: items.map(({ g, left, width }) => (
        <span key={g.id} className={`tl-group${key === 'blocks' ? ' solid' : ''}`} style={{ left: left + gap, width: Math.max(2, width - 2 * gap), borderColor: g.color, color: g.color }} title={g.title}>
          {g.title}
        </span>
      )),
    });
  }

  // Splétání: čtyři throughlines v čase. Pruh ukazuje, kde leží Signpost; šrafa, kde throughline dlouho mlčí.
  if (p.storyform?.beats.length) {
    const w = weaveData;
    rows.push(section('weave', 'Splétání', 4));
    if (isOpen('weave')) {
      for (const t of THROUGHLINES) {
        const total = p.storyform.beats.filter((x) => x.throughline === t.key).length;
        const placed = [...w.rows[t.key].values()].reduce((k, list) => k + list.length, 0);
        rows.push({
          key: `weave:${t.key}`,
          h: ROW,
          label: (
            <>
              <i style={{ background: t.color }} />
              <span className="tl-name" title={`${placed} z ${total} storybeatů je ve scénách`}>
                {t.name} <small>{placed}/{total}</small>
              </span>
            </>
          ),
          content: (
            <>
              {w.spans
                .filter((x) => x.throughline === t.key && xs[x.first] !== undefined && xs[x.last] !== undefined)
                .map((x) => (
                  <span key={`s${x.signpost}`} className="tl-sp" style={{ left: xs[x.first], width: xs[x.last] + ws[x.last] - xs[x.first], borderColor: t.color, color: t.color }}>
                    S{x.signpost}
                  </span>
                ))}
              {w.gaps
                .filter((x) => x.throughline === t.key && xs[x.from] !== undefined && xs[x.to] !== undefined)
                .map((x) => (
                  <span key={`g${x.from}`} className="tl-gap" style={{ left: xs[x.from] + ws[x.from], width: xs[x.to] - xs[x.from] - ws[x.from] }} title={`${t.name} tu ${x.scenes} scén mlčí`} />
                ))}
              {[...w.rows[t.key]].map(
                ([id, list]) =>
                  xs[id] !== undefined && (
                    <span key={id} className="tl-weave" style={{ left: cx(id), background: t.color }} title={list.map((x) => `${storybeatTag(x)} ${x.fn}${x.summary ? ' – ' + x.summary : ''}`).join('\n')}>
                      {storybeatTag(list[0]).split(' ')[1]}
                      {list.length > 1 && `+${list.length - 1}`}
                    </span>
                  ),
              )}
            </>
          ),
        });
      }
    }
  }

  for (const cat of tagCategories(p)) {
    const tags = p.tags.filter((t) => t.category === cat);
    if (!tags.length) continue;
    const key = `tag:${cat}`;
    rows.push(section(key, cat, tags.length, () => addTag(cat)));
    if (isOpen(key)) for (const t of tags) rows.push(t.mode === 'none' ? threadRow(t) : curveRow(t));
  }
  for (const role of Object.keys(ROLE_LABEL) as CharRole[]) {
    const chars = p.characters.filter((c) => c.role === role);
    if (!chars.length) continue;
    const key = `role:${role}`;
    rows.push(section(key, ROLE_LABEL[role], chars.length, () => (actions.addCharacter(role), added(key))));
    if (isOpen(key)) for (const c of chars) rows.push(charRow(c));
  }
  // Nový sledovací řádek: motiv v kterékoli kategorii (i nové) nebo postava.
  rows.push({
    key: 'add-row',
    h: ROW,
    label: (
      <select
        className="tl-add-row"
        value=""
        title="Přidá na osu další řádek ke sledování: motiv, téma, rekvizitu, minizápletku nebo postavu"
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'char') return actions.addCharacter(), added('role:main');
          const cat = v === 'new' ? prompt('Název nové kategorie řádků (např. Rekvizity, Místa, Symboly):')?.trim() : v;
          if (cat) addTag(cat);
        }}
      >
        <option value="">+ Přidat řádek…</option>
        <optgroup label="Motiv v kategorii">
          {tagCategories(p).map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
          <option value="new">Nová kategorie…</option>
        </optgroup>
        <option value="char">Postava</option>
      </select>
    ),
    content: null,
  });

  return (
    <div className={`timeline${dense ? ' tl-dense' : ''}`}>
      <div className="tl-labels">
        {rows.map((r) => (
          <div key={r.key} className={r.kind === 'section' ? 'tl-section tl-sec' : r.kind === 'head' ? 'tl-opts' : 'tl-label'} style={{ height: r.h }}>
            {r.label}
          </div>
        ))}
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-canvas" style={{ width: width + EXTRA }} onMouseDown={startBand}>
          {band && <div className="band" style={{ left: Math.min(band.x0, band.x1), width: Math.abs(band.x1 - band.x0), top: 0, bottom: 0 }} />}
          {beats.map((id) => (
            <div
              key={id}
              className={`tl-col${picked.has(id) ? ' selected' : ''}${matches && !matches.has(id) ? ' out' : ''}`}
              style={{ left: xs[id], width: ws[id] }}
              onClick={(e) => sel(id, e)}
            />
          ))}
          {breaks.map((id) => (
            <div key={id} className="tl-break" style={{ left: xs[id] + breakW / 2 }} title={p.breaks[id].title} />
          ))}
          {rows.map((r) => (
            <div key={r.key} className={r.kind === 'section' ? 'tl-row tl-section' : r.kind === 'head' ? 'tl-row tl-head' : 'tl-row'} style={{ height: r.h }}>
              {r.content}
            </div>
          ))}
          {beats.length === 0 && <p className="muted tl-empty">Časová osa se naplní, jakmile přidáš beaty.</p>}
        </div>
      </div>
    </div>
  );
});
