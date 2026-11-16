import { PointerEvent, useRef } from 'react';

interface Props {
  /** Vlastnost CSS na rodiči, která nese podíl okna (např. „--p-script“). */
  name: string;
  min: number;
  max: number;
  /** Podíl patří oknu za táhlem (pod ním nebo vpravo od něj). */
  after?: boolean;
  what: string;
  onChange: (share: number) => void;
  onReset: () => void;
}

/**
 * Táhlo mezi dvěma okny: tažením se jedno zvětšuje a druhé zmenšuje. Směr se řídí tím, jak rodič okna skládá
 * (vedle sebe, nebo pod sebe). Během tažení se mění jen vlastnost CSS na rodiči, aby se aplikace nepřekreslovala
 * s každým pohybem; výsledek se uloží až po puštění. Dvojklik vrátí výchozí velikost.
 */
export function Splitter({ name, min, max, after, what, onChange, onReset }: Props) {
  const last = useRef<number | null>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const box = e.currentTarget.parentElement!;
    const r = box.getBoundingClientRect();
    const column = getComputedStyle(box).flexDirection.startsWith('column');
    const at = column ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    const share = Math.min(max, Math.max(min, after ? 1 - at : at));
    last.current = share;
    box.style.setProperty(name, String(share));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    e.currentTarget.classList.remove('dragging');
    if (last.current !== null) onChange(last.current);
    last.current = null;
  };
  return (
    <div
      className="splitter"
      role="separator"
      title={`Tažením změníš velikost (${what}); dvojklik vrátí výchozí`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.classList.add('dragging');
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
    />
  );
}
