interface Props {
  value: number;
  min: number;
  max: number;
  onChange: (zoom: number) => void;
  /** Co se přibližuje – do popisků (např. „tabuli“). */
  what: string;
  /** Úzká podoba bez tlačítek − a +. */
  compact?: boolean;
}

export const clampZoom = (z: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, z)) * 100) / 100;

/** Posuvník přiblížení s tlačítky po 10 % a návratem na 100 % kliknutím na číslo. */
export function ZoomSlider({ value, min, max, onChange, what, compact }: Props) {
  const set = (z: number) => onChange(clampZoom(z, min, max));
  return (
    <span className={`zoom-slider${compact ? ' compact' : ''}`}>
      {!compact && (
        <button onClick={() => set(value - 0.1)} disabled={value <= min} title={`Oddálit ${what}`}>
          −
        </button>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => set(+e.target.value)}
        title={`Přiblížení: ${Math.round(value * 100)} %`}
        aria-label={`Přiblížit nebo oddálit ${what}`}
      />
      {!compact && (
        <button onClick={() => set(value + 0.1)} disabled={value >= max} title={`Přiblížit ${what}`}>
          +
        </button>
      )}
      <button className="zoom-val" onClick={() => onChange(1)} title="Vrátit na 100 %">
        {Math.round(value * 100)} %
      </button>
    </span>
  );
}
