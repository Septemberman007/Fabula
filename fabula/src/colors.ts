import type { Beat, Project } from './model';
import type { ColorBy } from './store';

const STATUS_COLOR = { idea: '#8a8073', draft: '#b45309', done: '#3f6212' } as const;
const NEUTRAL = '#a39a8c';

export const COLOR_BY_LABEL: Record<ColorBy, string> = { lane: 'linie', tag: 'motivu', status: 'stavu', throughline: 'throughline' };
/** Barvy throughlines z Dramatiky. */
export const THROUGHLINE_COLOR = { OS: '#b45309', MC: '#1d4ed8', IC: '#be185d', RS: '#0f766e' } as const;

/** Barva beatu podle zvoleného režimu: linie, první přiřazený motiv, nebo stav rozpracovanosti. */
export function beatColor(p: Project, b: Beat, mode: ColorBy): string {
  if (mode === 'status') return STATUS_COLOR[b.status];
  if (mode === 'throughline') {
    const first = b.storybeats?.[0]?.split('/')[0] as keyof typeof THROUGHLINE_COLOR | undefined;
    return (first && THROUGHLINE_COLOR[first]) ?? NEUTRAL;
  }
  if (mode === 'tag') return p.tags.find((t) => b.tagIds.includes(t.id))?.color ?? NEUTRAL;
  return p.lanes.find((l) => l.id === b.laneId)?.color ?? NEUTRAL;
}

/**
 * Barva zprůhledněná na daný podíl (0–1). Píše se jako osmimístný hex, protože funkci color-mix
 * starší prohlížeče (Safari do verze 16.1) neznají.
 */
export function tint(color: string, share: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return `color-mix(in srgb, ${color} ${Math.round(share * 100)}%, transparent)`;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return `#${full}${Math.round(share * 255).toString(16).padStart(2, '0')}`;
}
/** Plocha lehce podbarvená danou barvou. */
export const tinted = (color: string, share: number) => `linear-gradient(${tint(color, share)}, ${tint(color, share)}), var(--surface)`;
