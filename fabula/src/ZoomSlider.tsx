import { clampZoom } from './zoom';

interface Props {
  value: number;
  min: number;
  max: number;
  onChange: (zoom: number) => void;
  /** Co se přibližuje – do popisků (např. „tabuli“). */
  what: string;
  /** Úzká podoba bez tlačítek − a +. */
  compact?: boolean;
  /** Propojení s druhým posuvníkem: stav a přepnutí. Bez něj se tlačítko nezobrazí. */
  linked?: boolean;
  onLink?: () => void;
  /** Oddálí tak, aby se celý příběh vešel na šířku okna. */
  onFit?: () => void;
}

const STEPS = 1000;

/**
 * Posuvník přiblížení. Je logaritmický: stejný posun znamená stejnou poměrnou změnu,
 * takže jde jemně ladit i u velkého oddálení. Kliknutí na číslo vrátí 100 %.
 */
export function ZoomSlider({ value, min, max, onChange, what, compact, linked, onLink, onFit }: Props) {
  const set = (z: number) => onChange(clampZoom(z, min, max));
  const span = Math.log(max / min);
  const pos = Math.round((Math.log(Math.max(min, Math.min(max, value)) / min) / span) * STEPS);
  const pct = value * 100;
  return (
    <span className={`zoom-slider${compact ? ' compact' : ''}`}>
      {!compact && (
        <button onClick={() => set(value / 1.15)} disabled={value <= min} title={`Oddálit ${what}`}>
          −
        </button>
      )}
      <input
        type="range"
        min={0}
        max={STEPS}
        value={pos}
        onChange={(e) => set(min * Math.exp((+e.target.value / STEPS) * span))}
        title={`Přiblížení: ${Math.round(pct)} %`}
        aria-label={`Přiblížit nebo oddálit ${what}`}
      />
      {!compact && (
        <button onClick={() => set(value * 1.15)} disabled={value >= max} title={`Přiblížit ${what}`}>
          +
        </button>
      )}
      <button className="zoom-val" onClick={() => set(1)} title="Vrátit na 100 %">
        {pct < 10 ? pct.toFixed(1).replace('.', ',') : Math.round(pct)} %
      </button>
      {onFit && (
        <button className="zoom-fit" onClick={onFit} title="Zobrazit celý příběh na šířku okna">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M2 4v8M14 4v8M4.5 8h7M6.5 5.8L4.3 8l2.2 2.2M9.5 5.8L11.7 8 9.5 10.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {onLink && (
        <button
          className={`zoom-link${linked ? ' on' : ''}`}
          onClick={onLink}
          aria-pressed={linked}
          title={linked ? 'Tabule a časová osa se přibližují společně – kliknutím rozpojíš' : 'Propojit přiblížení tabule a časové osy'}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M6.5 9.5l3-3M7 4.8l1.2-1.2a2.6 2.6 0 013.7 3.7L10.7 8.5M9 11.2l-1.2 1.2a2.6 2.6 0 01-3.7-3.7L5.3 7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}
