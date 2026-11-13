import type { BeatStatus, ID, Project } from './model';
import { beatCharacters } from './text';

export interface Filter {
  chars: ID[];
  tags: ID[];
  lanes: ID[];
  status: BeatStatus | '';
}

export const EMPTY_FILTER: Filter = { chars: [], tags: [], lanes: [], status: '' };

export const filterActive = (f: Filter) => f.chars.length + f.tags.length + f.lanes.length > 0 || f.status !== '';

/** Beaty vyhovující filtru; null, když žádný filtr není zapnutý. Uvnitř kategorie platí „nebo“, mezi kategoriemi „a zároveň“. */
export function filterMatches(p: Project, f: Filter): Set<ID> | null {
  if (!filterActive(f)) return null;
  const out = new Set<ID>();
  for (const b of Object.values(p.beats)) {
    if (f.lanes.length && !f.lanes.includes(b.laneId)) continue;
    if (f.status && b.status !== f.status) continue;
    if (f.tags.length && !f.tags.some((t) => b.tagIds.includes(t))) continue;
    if (f.chars.length) {
      const cast = beatCharacters(p, b);
      if (!f.chars.some((c) => cast.includes(c))) continue;
    }
    out.add(b.id);
  }
  return out;
}

export interface Hit {
  kind: 'beat' | 'script' | 'research' | 'note';
  id: ID;
  label: string;
  snippet: string;
}

const norm = (s: string) => s.toLocaleLowerCase('cs').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function snippet(text: string, q: string): string {
  const i = norm(text).indexOf(q);
  const start = Math.max(0, i - 24);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 46).replace(/\s+/g, ' ') + (i + q.length + 46 < text.length ? '…' : '');
}

/** Hledá v názvech, synopsích, textu scén, rešerších a poznámkách; bez ohledu na velikost písmen a diakritiku. */
export function search(p: Project, query: string): Hit[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  let n = 0;
  for (const bid of p.order) {
    const b = p.beats[bid];
    if (!b) continue;
    n++;
    const label = `${n}. ${b.title.trim() || 'Bez názvu'}`;
    if (norm(b.title).includes(q)) hits.push({ kind: 'beat', id: bid, label, snippet: b.synopsis });
    else if (norm(b.synopsis).includes(q)) hits.push({ kind: 'beat', id: bid, label, snippet: snippet(b.synopsis, q) });
    const para = b.paras.find((x) => norm(x.text).includes(q));
    if (para) hits.push({ kind: 'script', id: bid, label, snippet: snippet(para.text, q) });
    const noted = b.paras.find((x) => x.note && norm(x.note).includes(q));
    if (noted) hits.push({ kind: 'script', id: bid, label: `${label} – poznámka`, snippet: snippet(noted.note!, q) });
  }
  for (const r of p.research) {
    const inTitle = norm(r.title).includes(q);
    if (inTitle || norm(r.text).includes(q)) hits.push({ kind: 'research', id: r.id, label: r.title.trim() || 'Bez názvu', snippet: inTitle ? r.text.slice(0, 70) : snippet(r.text, q) });
  }
  for (const note of p.notes) if (norm(note.text).includes(q)) hits.push({ kind: 'note', id: note.id, label: 'Poznámka na tabuli', snippet: snippet(note.text, q) });
  return hits.slice(0, 14);
}
