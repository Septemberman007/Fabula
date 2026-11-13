import type { Beat, Project } from './model';
import type { ColorBy } from './store';

const STATUS_COLOR = { idea: '#8a8073', draft: '#b45309', done: '#3f6212' } as const;
const NEUTRAL = '#a39a8c';

export const COLOR_BY_LABEL: Record<ColorBy, string> = { lane: 'linie', tag: 'motivu', status: 'stavu' };

/** Barva beatu podle zvoleného režimu: linie, první přiřazený motiv, nebo stav rozpracovanosti. */
export function beatColor(p: Project, b: Beat, mode: ColorBy): string {
  if (mode === 'status') return STATUS_COLOR[b.status];
  if (mode === 'tag') return p.tags.find((t) => b.tagIds.includes(t.id))?.color ?? NEUTRAL;
  return p.lanes.find((l) => l.id === b.laneId)?.color ?? NEUTRAL;
}
