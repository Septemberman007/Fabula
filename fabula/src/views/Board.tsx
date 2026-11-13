import { DragEvent, MouseEvent, PointerEvent, memo, useEffect, useMemo, useRef, useState } from 'react';
import { BoardNote, ID, NOTE_COLORS, Project, STATUS_LABEL, beatName, beatNumber, groupBeats } from '../model';
import { ColorBy, State, actions, ui } from '../store';
import { COLOR_BY_LABEL, beatColor } from '../colors';
import { Issue, brokenLinks } from '../evaluate';
import { beatCharacters } from '../text';
import { BeatEditor } from '../BeatEditor';
import { ZoomSlider, clampZoom } from '../ZoomSlider';

const COL = 208;
const BRK = 46;
const CARD_W = 184;
const CARD_H = 104;
const TOP = 30;
/** Volná plocha pod liniemi pro poznámky. */
const FREE = 150;
const CARD_DX = (COL - CARD_W) / 2;
/** Odsazení karty od horního okraje linie: místo pro popisky skupiny a bloku. */
const CARD_DY = 52;
/** Rozestup karet, které se ve stejné linii dějí souběžně. */
const STACK = CARD_H + 10;
const LANE_PAD = 26;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;

interface Col {
  x: number;
  w: number;
  n?: number;
  /** První beat ve sloupci (souběžné beaty sloupec sdílejí). */
  lead?: boolean;
}

/**
 * Rozmístění tabule.
 * – Souběžný beat sdílí sloupec s předchozím; ve stejné linii se karty skládají pod sebe a linie se zvýší.
 * – Sbalený blok či skupina zabere jediný sloupec (u svého prvního beatu); ostatní jeho beaty se nekreslí.
 */
function layout(p: Project) {
  const cols: Record<ID, Col> = {};
  const slot: Record<ID, number> = {};
  const byId = new Map(p.groups.map((g) => [g.id, g]));
  /** Nejvyšší sbalený předek beatu (blok má přednost před skupinou). */
  const rootOf = (id: ID): ID | null => {
    const g = byId.get(p.beats[id]?.groupId ?? '');
    if (!g) return null;
    const parent = byId.get(g.parentId ?? '');
    return parent?.collapsed ? parent.id : g.collapsed ? g.id : null;
  };
  const rep = new Map<ID, ID>();
  const hidden = new Set<ID>();
  const laneIdx = new Map(p.lanes.map((l, i) => [l.id, i]));
  const stacks = p.lanes.map(() => 1);
  let x = 0;
  let n = 0;
  let prev: ID | null = null;
  let used = new Map<number, number>();
  for (const id of p.order) {
    const b = p.beats[id];
    if (!b) {
      cols[id] = { x, w: BRK };
      x += BRK;
      prev = null;
      continue;
    }
    n++;
    const root = rootOf(id);
    if (root) {
      hidden.add(id);
      const first = rep.get(root);
      if (first) {
        cols[id] = { x: cols[first].x + COL / 2, w: 0, n };
        continue;
      }
      rep.set(root, id);
    }
    const lane = laneIdx.get(b.laneId) ?? 0;
    if (b.concurrent && prev && !root && !hidden.has(prev)) {
      cols[id] = { x: cols[prev].x, w: COL, n };
    } else {
      cols[id] = { x, w: COL, n, lead: true };
      x += COL;
      used = new Map();
    }
    slot[id] = used.get(lane) ?? 0;
    used.set(lane, slot[id] + 1);
    stacks[lane] = Math.max(stacks[lane], slot[id] + 1);
    prev = id;
  }
  const laneH = stacks.map((k) => CARD_DY + CARD_H + (k - 1) * STACK + LANE_PAD);
  const laneTop: number[] = [];
  let y = 0;
  for (const h of laneH) {
    laneTop.push(y);
    y += h;
  }
  return { cols, width: x, rep, hidden, slot, laneTop, laneH, height: y, rootOf };
}

function Note({ note, zoom }: { note: BoardNote; zoom: number }) {
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  return (
    <div className="note" style={{ left: note.x, top: note.y, background: note.color }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div
        className="note-bar"
        title="Táhni pro přesun"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { px: e.clientX, py: e.clientY, x: note.x, y: note.y };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || !(e.buttons & 1)) return;
          actions.updateNote(note.id, { x: Math.max(0, Math.round(s.x + (e.clientX - s.px) / zoom)), y: Math.max(TOP, Math.round(s.y + (e.clientY - s.py) / zoom)) }, 'move');
        }}
        onPointerUp={() => (start.current = null)}
      >
        <button
          className="note-color"
          title="Změnit barvu"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => actions.updateNote(note.id, { color: NOTE_COLORS[(NOTE_COLORS.indexOf(note.color) + 1) % NOTE_COLORS.length] })}
        />
        <button className="x" title="Smazat poznámku" onPointerDown={(e) => e.stopPropagation()} onClick={() => actions.deleteNote(note.id)}>
          ×
        </button>
      </div>
      <textarea value={note.text} placeholder="Poznámka…" data-note={note.id} onChange={(e) => actions.updateNote(note.id, { text: e.target.value }, 'text')} />
    </div>
  );
}

export const Board = memo(function Board({ s, issues, matches, noSplit }: { s: State; issues: Issue[]; matches: Set<ID> | null; noSplit?: boolean }) {
  const p = s.project;
  const zoom = s.zoom;
  const { cols, width, rep, hidden, slot, laneTop, laneH, height, rootOf } = useMemo(() => layout(p), [p]);
  /** Počet scén před vybraným beatem – pro číslování hlaviček v panelu s textem. */
  const sceneBase = useMemo(() => {
    let k = 0;
    for (const id of p.order) {
      if (id === s.selected) break;
      k += p.beats[id]?.paras.filter((x) => x.type === 'scene' && x.text.trim()).length ?? 0;
    }
    return k;
  }, [p, s.selected]);
  const canvas = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<ID | null>(null);
  const [drop, setDrop] = useState<{ index: number; lane: number; x: number } | null>(null);
  /** Tažení šipky z karty: odkud a kde je právě ukazatel (souřadnice plátna). */
  const [wire, setWire] = useState<{ from: ID; x: number; y: number; moved: boolean } | null>(null);
  const wireStart = useRef({ x: 0, y: 0 });
  /** Výběr tažením obdélníku po prázdné ploše. */
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const banded = useRef(false);

  const laneIndex = new Map(p.lanes.map((l, i) => [l.id, i]));
  const laneOf = (id: ID) => laneIndex.get(p.beats[id].laneId) ?? 0;
  const broken = useMemo(() => brokenLinks(p, issues), [p, issues]);
  const errorBeats = new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.beatIds));
  const selectedBeat = s.selected ? p.beats[s.selected] : null;
  const picked = new Set(s.multi.length ? s.multi : s.selected ? [s.selected] : []);
  const dragIds = dragId && s.multi.length > 1 && s.multi.includes(dragId) ? s.multi : dragId ? [dragId] : [];

  // Při vybraném beatu ztlumíme vše, co s ním není kauzálně spojené.
  const related = useMemo(() => {
    if (s.multi.length > 1 || !s.selected || !p.beats[s.selected]) return null;
    const set = new Set<ID>([s.selected]);
    for (const l of p.links) {
      if (l.from === s.selected) set.add(l.to);
      if (l.to === s.selected) set.add(l.from);
    }
    return set.size > 1 ? set : null;
  }, [p, s.selected, s.multi]);

  /** Přepočet souřadnic okna na souřadnice plátna (bez přiblížení). */
  const toCanvas = (clientX: number, clientY: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
  };
  const locate = (clientX: number, clientY: number, skip: ID[]) => {
    const { x: px, y } = toCanvas(clientX, clientY);
    const items = p.order.filter((id) => !skip.includes(id));
    const index = items.filter((id) => cols[id].x + cols[id].w / 2 < px).length;
    const lane = Math.max(0, laneTop.filter((t) => y - TOP >= t).length - 1);
    const x = index < items.length ? cols[items[index]].x : width;
    return { index, lane, x };
  };

  const onDragOver = (e: DragEvent) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const d = locate(e.clientX, e.clientY, dragIds);
    if (!drop || drop.index !== d.index || drop.lane !== d.lane) setDrop(d);
  };
  const onDrop = (e: DragEvent) => {
    if (!dragId) return;
    e.preventDefault();
    const d = locate(e.clientX, e.clientY, dragIds);
    const lane = p.lanes[d.lane].id;
    if (dragIds.length > 1) {
      // Skupina karet mění linii jen tehdy, když byly všechny ve stejné.
      const sameLane = new Set(dragIds.map((id) => p.beats[id]?.laneId)).size === 1;
      actions.moveItems(dragIds, d.index, sameLane ? lane : undefined);
    } else {
      // S klávesou Alt se beat položí souběžně s tím, za který ho pouštíš.
      actions.moveItem(dragId, d.index, lane, e.altKey);
    }
    setDragId(null);
    setDrop(null);
  };
  const onDoubleClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).dataset.bg) return;
    const d = locate(e.clientX, e.clientY, []);
    actions.addBeat(p.lanes[d.lane].id, d.index);
  };

  const clickBeat = (id: ID, e: MouseEvent) => {
    if (s.linkFrom && s.linkFrom !== id) {
      actions.addLink(s.linkFrom, id);
      ui({ linkFrom: null, selected: s.linkFrom });
    } else if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const base = s.multi.length ? s.multi : s.selected && p.beats[s.selected] ? [s.selected] : [];
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      ui({ multi: next.length > 1 ? next : [], selected: next.at(-1) ?? null, tab: 'detail', linkFrom: null });
    } else {
      ui({ selected: id, multi: [], tab: 'detail', linkFrom: null });
    }
  };

  // Tažení šipky myší z úchytu „→“; pouhé kliknutí zapne režim „klikni na následek“.
  const wireDown = (id: ID) => (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    wireStart.current = { x: e.clientX, y: e.clientY };
    setWire({ from: id, ...toCanvas(e.clientX, e.clientY), moved: false });
  };
  const wireMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!wire) return;
    const moved = wire.moved || Math.hypot(e.clientX - wireStart.current.x, e.clientY - wireStart.current.y) > 6;
    setWire({ ...wire, ...toCanvas(e.clientX, e.clientY), moved });
  };
  const wireUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (!wire) return;
    const from = wire.from;
    setWire(null);
    if (!wire.moved) return ui({ linkFrom: s.linkFrom === from ? null : from, selected: from, multi: [] });
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-beat]')?.dataset.beat;
    if (target && target !== from) {
      actions.addLink(from, target);
      ui({ selected: from, multi: [], linkFrom: null, tab: 'detail' });
    }
  };

  const cardBox = (id: ID) => {
    const b = p.beats[id];
    if (hidden.has(id)) {
      // Beat ve sbalené sekvenci: vazby míří na kartu sekvence.
      const root = rootOf(id)!;
      const lanes = groupBeats(p, root).map(laneOf);
      const left = cols[rep.get(root)!].x + CARD_DX;
      const top = TOP + laneTop[Math.min(...lanes)] + CARD_DY;
      const bottom = TOP + laneTop[Math.max(...lanes)] + CARD_DY + CARD_H;
      return { left, top, right: left + CARD_W, mid: (top + bottom) / 2, cx: left + CARD_W / 2, bottom };
    }
    const left = cols[id].x + CARD_DX;
    const top = TOP + laneTop[laneOf(id)] + CARD_DY + (slot[id] ?? 0) * STACK;
    return { left, top, right: left + CARD_W, mid: top + CARD_H / 2, cx: left + CARD_W / 2, bottom: top + CARD_H };
  };

  // Společný kurzor: beat vybraný v jiném panelu posuneme do viditelné části tabule.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !s.selected || !p.beats[s.selected]) return;
    const box = cardBox(s.selected);
    const heads = 140 * zoom;
    const left = heads + box.left * zoom;
    const right = heads + box.right * zoom;
    const top = box.top * zoom;
    const bottom = box.bottom * zoom;
    const outX = left < el.scrollLeft + heads || right > el.scrollLeft + el.clientWidth;
    const outY = top < el.scrollTop || bottom > el.scrollTop + el.clientHeight;
    if (outX || outY) {
      el.scrollTo({
        left: outX ? Math.max(0, (left + right) / 2 - heads / 2 - el.clientWidth / 2) : el.scrollLeft,
        top: outY ? Math.max(0, (top + bottom) / 2 - el.clientHeight / 2) : el.scrollTop,
        behavior: 'smooth',
      });
    }
  }, [s.selected]);
  const cursorId = s.selected && p.beats[s.selected] ? (hidden.has(s.selected) ? rep.get(rootOf(s.selected)!)! : s.selected) : null;

  const linkGeometry = (from: ID, to: ID, bad: boolean) => {
    const a = cardBox(from);
    const b = cardBox(to);
    const lo = Math.min(cols[from].x, cols[to].x);
    const hi = Math.max(cols[from].x, cols[to].x);
    const blocked =
      a.top === b.top &&
      Object.values(p.beats).some((x) => x.laneId === p.beats[from].laneId && cols[x.id].w > 0 && cols[x.id].x > lo && cols[x.id].x < hi);
    if (bad || blocked) {
      // Oblouk pod kartami: zpětná vazba, nebo vazba přes karty ve stejné linii.
      const dip = 22 + Math.min(14, Math.abs(b.cx - a.cx) / 40);
      return {
        d: `M ${a.cx} ${a.bottom} C ${a.cx} ${a.bottom + dip}, ${b.cx} ${b.bottom + dip}, ${b.cx} ${b.bottom + 3}`,
        lx: (a.cx + b.cx) / 2,
        ly: (a.bottom + b.bottom) / 2 + dip * 0.75 + 12,
      };
    }
    const dx = Math.max(24, (b.left - a.right) / 2);
    return {
      d: `M ${a.right} ${a.mid} C ${a.right + dx} ${a.mid}, ${b.left - dx} ${b.mid}, ${b.left - 3} ${b.mid}`,
      lx: (a.right + b.left) / 2,
      ly: (a.mid + b.mid) / 2 - 6,
    };
  };

  const members = (gid: ID) => groupBeats(p, gid);
  const collapsedAbove = (g: { collapsed: boolean; parentId: ID | null }) => g.collapsed || !!p.groups.find((x) => x.id === g.parentId)?.collapsed;
  // Rozbalené bloky a skupiny: rámeček kolem všech členských karet. Blok obepíná i své skupiny, proto má větší okraj.
  const groupBoxes = p.groups
    .filter((g) => !collapsedAbove(g))
    .map((g) => {
      const boxes = members(g.id).map(cardBox);
      if (!boxes.length) return null;
      const outer = p.groups.some((x) => x.parentId === g.id);
      const pad = outer ? 16 : 8;
      const left = Math.min(...boxes.map((b) => b.left)) - pad;
      const top = Math.min(...boxes.map((b) => b.top)) - (outer ? 46 : 22);
      return { g, outer, left, top, width: Math.max(...boxes.map((b) => b.right)) + pad - left, height: Math.max(...boxes.map((b) => b.bottom)) + pad - top };
    })
    .filter((x) => x !== null)
    .sort((a, b) => Number(b.outer) - Number(a.outer));

  /** Gesto přibližuje po desetině současné hodnoty, aby bylo stejně citlivé u malého i velkého přiblížení. */
  const zoomStep = (dir: 1 | -1) => ui({ zoom: clampZoom(zoom * (dir > 0 ? 1.1 : 1 / 1.1), ZOOM_MIN, ZOOM_MAX) });

  // Gesto roztažení na trackpadu (nebo kolečko s Ctrl či ⌘) tabuli přibližuje a oddaluje.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      zoomStep(acc < 0 ? 1 : -1);
      acc = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  const bandDown = (e: PointerEvent) => {
    if (e.button !== 0 || !(e.target as HTMLElement).dataset.bg) return;
    const c = toCanvas(e.clientX, e.clientY);
    setBand({ x0: c.x, y0: c.y, x1: c.x, y1: c.y });
  };
  const bandMove = (e: PointerEvent) => {
    if (!band) return;
    if (!(e.buttons & 1)) return setBand(null);
    const c = toCanvas(e.clientX, e.clientY);
    setBand({ ...band, x1: c.x, y1: c.y });
  };
  const bandUp = () => {
    if (!band) return;
    const r = { l: Math.min(band.x0, band.x1), r: Math.max(band.x0, band.x1), t: Math.min(band.y0, band.y1), b: Math.max(band.y0, band.y1) };
    setBand(null);
    if (r.r - r.l < 8 && r.b - r.t < 8) return;
    const ids = p.order.filter((id) => {
      if (!p.beats[id] || hidden.has(id)) return false;
      const c = cardBox(id);
      return c.left < r.r && c.right > r.l && c.top < r.b && c.bottom > r.t;
    });
    banded.current = true;
    ui({ multi: ids.length > 1 ? ids : [], selected: ids[0] ?? null, tab: 'detail', linkFrom: null });
  };
  const bgClick = (e: MouseEvent) => {
    if (banded.current) return void (banded.current = false);
    if ((e.target as HTMLElement).dataset.bg) ui({ selected: null, multi: [], linkFrom: null });
  };

  const addNote = () => {
    const el = scroller.current!;
    const id = actions.addNote(Math.round(el.scrollLeft / zoom + 40), TOP + height + 14);
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-note="${id}"]`)?.focus(), 30);
  };

  const band_ = band && { left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) };

  return (
    <div className="board">
      <div className="board-bar">
        {s.linkFrom ? (
          <span className="banner">
            Klikni na beat, který je následkem „{beatName(p, s.linkFrom)}“.
            <button onClick={() => ui({ linkFrom: null })}>Zrušit (Esc)</button>
          </span>
        ) : s.multi.length > 1 ? (
          <span>
            <b>Vybráno {s.multi.length} beatů</b> <span className="muted">· hromadné úpravy jsou vpravo, tažením přesuneš všechny</span>
          </span>
        ) : (
          <span className="muted">Dvojklik přidá beat · tažením „→“ vznikne vazba · Shift+klik nebo tažení po ploše vybere víc karet</span>
        )}
        <span className="board-tools">
          <select className="colorby" value={s.colorBy} title="Podle čeho se barví karty" onChange={(e) => ui({ colorBy: e.target.value as ColorBy })}>
            {(Object.keys(COLOR_BY_LABEL) as ColorBy[]).map((k) => (
              <option key={k} value={k}>
                Barva podle {COLOR_BY_LABEL[k]}
              </option>
            ))}
          </select>
          <button onClick={addNote}>+ Poznámka</button>
          <ZoomSlider value={zoom} min={ZOOM_MIN} max={ZOOM_MAX} what="tabuli" onChange={(z) => ui({ zoom: z })} />
          {!noSplit && (
          <label className="check">
            <input type="checkbox" checked={s.split} onChange={(e) => ui({ split: e.target.checked })} /> Text scény pod tabulí
          </label>
          )}
        </span>
      </div>

      <div className="board-scroll" ref={scroller}>
        <div className="board-zoom" style={{ zoom }}>
          <div className="lane-heads" style={{ paddingTop: TOP }}>
            {p.lanes.map((l, i) => (
              <div key={l.id} className="lane-head" style={{ height: laneH[i], borderLeftColor: l.color }}>
                <span>{l.name || 'Bez názvu'}</span>
                <small>{p.order.filter((id) => p.beats[id]?.laneId === l.id).length} beatů</small>
              </div>
            ))}
            <div className="lane-head free" style={{ height: FREE }}>
              <small>Poznámky</small>
            </div>
          </div>

          <div
            ref={canvas}
            data-bg="1"
            className="canvas"
            style={{ width: width + 260, height: TOP + height + FREE }}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}
            onDoubleClick={onDoubleClick}
            onClick={bgClick}
            onPointerDown={bandDown}
            onPointerMove={bandMove}
            onPointerUp={bandUp}
          >
            {p.lanes.map((l, i) => (
              <div key={l.id} data-bg="1" className="lane-row" style={{ top: TOP + laneTop[i], height: laneH[i] }} />
            ))}

            {cursorId && <div className="cursor-col" style={{ left: cols[cursorId].x, width: COL, height: TOP + height }} />}

            {groupBoxes.map(({ g, outer, ...box }) => (
              <div key={g.id} className={`group-box${outer ? ' outer' : ''}`} style={{ ...box, borderColor: g.color, background: g.color + (outer ? '0d' : '14') }}>
                <button style={{ color: g.color }} title="Sbalit do jedné karty" onClick={(e) => (e.stopPropagation(), actions.updateGroup(g.id, { collapsed: true }))}>
                  ▾ {g.title || (outer ? 'Blok' : 'Skupina')}
                </button>
              </div>
            ))}

            {p.order.map((id) =>
              p.beats[id] ? (
                cols[id].lead && (
                  <div key={id} className="col-num" style={{ left: cols[id].x, width: COL }}>
                    {(hidden.has(id) ? members(rootOf(id)!) : p.order.filter((m) => p.beats[m] && !hidden.has(m) && cols[m].x === cols[id].x)).map((m) => cols[m].n).join(', ')}
                  </div>
                )
              ) : (
                <div
                  key={id}
                  className={`break-col${s.selected === id ? ' selected' : ''}`}
                  style={{ left: cols[id].x, width: BRK, height: TOP + height }}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(id);
                  }}
                  onDragEnd={() => (setDragId(null), setDrop(null))}
                  onClick={(e) => (e.stopPropagation(), ui({ selected: id, multi: [], tab: 'detail' }))}
                  title="Předěl – přetáhni pro přesun"
                >
                  <span>{p.breaks[id].title || 'Předěl'}</span>
                </div>
              ),
            )}

            <svg className="links" width={width + 260} height={TOP + height}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" className="arrow-ok" />
                </marker>
                <marker id="arrow-bad" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" className="arrow-bad" />
                </marker>
              </defs>
              {p.links.map((l) => {
                // Vazby uvnitř jedné sbalené sekvence nekreslíme.
                if (hidden.has(l.from) && hidden.has(l.to) && rootOf(l.from) === rootOf(l.to)) return null;
                const bad = broken.has(l.id);
                const active = s.selected === l.from || s.selected === l.to;
                const out = matches && !(matches.has(l.from) && matches.has(l.to));
                const geo = linkGeometry(l.from, l.to, bad);
                return (
                  <g key={l.id} className={(related && !active) || out ? 'dim' : ''}>
                    <path d={geo.d} className={`link${bad ? ' bad' : ''}${active ? ' active' : ''}`} markerEnd={`url(#${bad ? 'arrow-bad' : 'arrow'})`} />
                    {active && l.note.trim() && (
                      <text x={geo.lx} y={geo.ly} className="link-note" textAnchor="middle">
                        {l.note.length > 38 ? l.note.slice(0, 36) + '…' : l.note}
                      </text>
                    )}
                  </g>
                );
              })}
              {wire?.moved && (
                <path d={`M ${cardBox(wire.from).right} ${cardBox(wire.from).mid} L ${wire.x} ${wire.y}`} className="link wire" markerEnd="url(#arrow)" />
              )}
            </svg>

            {p.groups
              .filter((g) => rep.has(g.id))
              .map((g) => {
                const ids = members(g.id);
                const box = cardBox(rep.get(g.id)!);
                const anyPicked = ids.some((id) => picked.has(id));
                return (
                  <div
                    key={g.id}
                    className={`card group-card${anyPicked ? ' selected' : ''}${matches && !ids.some((id) => matches.has(id)) ? ' out' : ''}`}
                    style={{ left: box.left, top: box.top, width: CARD_W, height: box.bottom - box.top, borderColor: g.color, background: `color-mix(in srgb, ${g.color} 9%, var(--surface))` }}
                    onClick={(e) => (e.stopPropagation(), ui({ multi: ids.length > 1 ? ids : [], selected: ids[0], tab: 'detail' }))}
                    onDoubleClick={(e) => (e.stopPropagation(), actions.updateGroup(g.id, { collapsed: false }))}
                    title="Sbalená sekvence – dvojklikem rozbalíš"
                  >
                    <button className="group-open" style={{ color: g.color }} onClick={(e) => (e.stopPropagation(), actions.updateGroup(g.id, { collapsed: false }))}>
                      ▸ {g.title || 'Sekvence'}
                    </button>
                    <ol>
                      {ids.map((id) => (
                        <li key={id} value={cols[id].n}>
                          {beatName(p, id)}
                        </li>
                      ))}
                    </ol>
                    {ids.some((id) => errorBeats.has(id)) && <span className="card-err" title="Logická chyba – viz Problémy" />}
                  </div>
                );
              })}

            {p.order
              .filter((id) => p.beats[id] && !hidden.has(id))
              .map((id) => {
                const b = p.beats[id];
                const box = cardBox(id);
                const color = beatColor(p, b, s.colorBy);
                const linking = s.linkFrom || wire?.moved;
                const cls = [
                  'card',
                  picked.has(id) && 'selected',
                  (s.linkFrom === id || wire?.from === id) && 'link-source',
                  linking && s.linkFrom !== id && wire?.from !== id && 'link-target',
                  dragIds.includes(id) && 'dragging',
                  related && !related.has(id) && !wire && 'dim',
                  matches && !matches.has(id) && 'out',
                  b.off && 'off',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div
                    key={id}
                    data-beat={id}
                    className={cls}
                    style={{
                      left: box.left,
                      top: box.top,
                      width: CARD_W,
                      height: CARD_H,
                      borderTopColor: color,
                      background: s.colorBy === 'lane' ? undefined : `color-mix(in srgb, ${color} 13%, var(--surface))`,
                    }}
                    draggable={!wire}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(id);
                    }}
                    onDragEnd={() => (setDragId(null), setDrop(null))}
                    onClick={(e) => (e.stopPropagation(), clickBeat(id, e))}
                  >
                    <div className="card-title">{b.title || <em>Bez názvu</em>}</div>
                    <div className="card-syn">{b.synopsis}</div>
                    <div className="card-foot">
                      <span className="dots">
                        {beatCharacters(p, b).map((c) => {
                          const ch = p.characters.find((x) => x.id === c)!;
                          return <i key={c} style={{ background: ch.color }} title={ch.name} />;
                        })}
                        {b.tagIds.map((t) => {
                          const tag = p.tags.find((x) => x.id === t);
                          return tag ? <i key={t} className="tag-dot" style={{ borderColor: tag.color }} title={`Motiv: ${tag.name}`} /> : null;
                        })}
                      </span>
                      <span className={`status ${b.status}`}>{STATUS_LABEL[b.status]}</span>
                    </div>
                    {errorBeats.has(id) && <span className="card-err" title="Logická chyba – viz Problémy" />}
                    <button
                      className="card-link"
                      title="Vede k… – táhni na jinou kartu, nebo klikni a pak vyber následek"
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerDown={wireDown(id)}
                      onPointerMove={wireMove}
                      onPointerUp={wireUp}
                      onClick={(e) => e.stopPropagation()}
                    >
                      →
                    </button>
                  </div>
                );
              })}

            {p.notes.map((n) => (
              <Note key={n.id} note={n} zoom={zoom} />
            ))}

            {band_ && <div className="band" style={band_} />}
            {drop && <div className="drop-mark" style={{ left: drop.x - 2, top: TOP + laneTop[drop.lane] + 8, height: laneH[drop.lane] - 16 }} />}
            {p.order.length === 0 && <div className="empty-hint">Dvojklikem do linie vytvoříš první beat.</div>}
          </div>
        </div>
      </div>

      {s.split && !noSplit && (
        <div className="board-split">
          {selectedBeat ? (
            <>
              <div className="split-head">
                <b>
                  {beatNumber(p, selectedBeat.id)}. {beatName(p, selectedBeat.id)}
                </b>
                <span className="muted">{selectedBeat.synopsis}</span>
              </div>
              <div className="split-page">
                <BeatEditor beat={selectedBeat} sceneBase={sceneBase} />
              </div>
            </>
          ) : (
            <p className="muted">Vyber beat na tabuli a jeho text se zobrazí tady.</p>
          )}
        </div>
      )}
    </div>
  );
});
