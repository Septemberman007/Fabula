import type { ID, Project, Tag } from './model';

const beatsInOrder = (p: Project) => p.order.filter((id) => p.beats[id]);
const level = (p: Project, beat: ID, tag: ID) => p.beats[beat].tagLevels[tag] ?? 5;

/** Úroveň, kterou měl motiv při posledním výskytu před daným beatem (5, pokud se ještě neobjevil). */
export function carriedLevel(p: Project, tagId: ID, beatId: ID): number {
  let last = 5;
  for (const id of beatsInOrder(p)) {
    if (id === beatId) break;
    if (p.beats[id].tagIds.includes(tagId)) last = level(p, id, tagId);
  }
  return last;
}

/**
 * Kolik napětí (0–1) motiv vnáší do každého beatu.
 * „rising“: napětí odpovídá úrovni a trvá, dokud se úroveň nezmění.
 * „change“: napětí vzniká skokem úrovně a v dalších beatech doznívá.
 */
export function tagTension(p: Project, tag: Tag): Map<ID, number> {
  const out = new Map<ID, number>();
  let prev: number | null = null;
  let echo = 0;
  for (const id of beatsInOrder(p)) {
    const on = p.beats[id].tagIds.includes(tag.id);
    const cur: number | null = on ? level(p, id, tag.id) : prev;
    let t = 0;
    if (tag.mode === 'rising') t = cur === null ? 0 : cur / 10;
    else if (tag.mode === 'change') {
      if (on) echo = prev === null ? 0.3 : Math.min(1, Math.abs(cur! - prev) / 6);
      else echo *= 0.5;
      t = echo;
    }
    out.set(id, t);
    prev = cur;
  }
  return out;
}

/** Napětí odvozené ze všech motivů dohromady (0–1); null, když žádný motiv napětí nevytváří. */
export function derivedTension(p: Project): Map<ID, number> | null {
  const active = p.tags.filter((t) => t.mode !== 'none' && beatsInOrder(p).some((id) => p.beats[id].tagIds.includes(t.id)));
  if (!active.length) return null;
  const series = active.map((t) => tagTension(p, t));
  const out = new Map<ID, number>();
  // Nejsilnější motiv určuje základ, ostatní ho přiživují.
  for (const id of beatsInOrder(p)) {
    const vals = series.map((s) => s.get(id) ?? 0).sort((a, b) => b - a);
    out.set(id, Math.min(1, vals[0] + vals.slice(1).reduce((n, v) => n + v, 0) * 0.25));
  }
  return out;
}

/** Celkové „teplo“ beatu (0–1): ruční napětí zprůměrované s napětím z motivů. */
export function heat(p: Project): Map<ID, number> {
  const derived = derivedTension(p);
  const out = new Map<ID, number>();
  for (const id of beatsInOrder(p)) {
    const manual = p.beats[id].tension / 10;
    out.set(id, derived ? (manual + derived.get(id)!) / 2 : manual);
  }
  return out;
}

/** Barva heat mapy: od chladné modré přes žlutou po červenou. */
const HEAT_STOPS: [number, number[]][] = [
  [0, [38, 64, 150]],
  [0.35, [92, 84, 170]],
  [0.6, [240, 170, 20]],
  [1, [214, 40, 28]],
];
export function heatColor(v: number): string {
  const x = Math.max(0, Math.min(1, v));
  const i = Math.max(1, HEAT_STOPS.findIndex(([t]) => t >= x));
  const [t0, a] = HEAT_STOPS[i - 1];
  const [t1, b] = HEAT_STOPS[i];
  const k = (x - t0) / (t1 - t0);
  return `rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * k)).join(', ')})`;
}
