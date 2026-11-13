import { KeyboardEvent, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Beat, ID, PARA_LABEL, Para, ParaType, Project, Revision, newPara } from './model';
import { actions, getState, useSel } from './store';

/** Prohlížeče s „field-sizing“ umí výšku pole podle obsahu samy; jinde ji dopočítáváme skriptem. */
const AUTO_SIZE = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
import { speakerCharacter } from './text';
import { NEXT_TYPE, SCENE_RE, TYPE_CYCLE, speaker } from './text';

/** Kam má po překreslení skočit kurzor (odstavec a pozice v něm). */
let pendingFocus: { id: ID; pos: number } | null = null;

const TRANSITIONS = ['STŘIH NA:', 'PROLÍNAČKA:', 'ZATMÍVAČKA.', 'ROZTMÍVAČKA:'];
const SCENE_STARTS = ['INT. ', 'EXT. ', 'INT./EXT. '];
const TIMES = ['DEN', 'NOC', 'RÁNO', 'VEČER', 'SVÍTÁNÍ', 'SOUMRAK', 'POZDĚJI', 'NAVAZUJE'];

function suggestions(p: Project, para: Para): string[] {
  const t = para.text;
  const T = t.toLocaleUpperCase('cs');
  const uniq = (xs: string[]) => [...new Set(xs)].filter((x) => x !== T && x.startsWith(T)).slice(0, 6);
  if (para.type === 'character') {
    const used = Object.values(p.beats).flatMap((b) => b.paras.filter((x) => x.type === 'character').map((x) => speaker(x.text)));
    return uniq([...p.characters.map((c) => c.name.toLocaleUpperCase('cs')), ...used].filter(Boolean));
  }
  if (para.type === 'transition') return uniq(TRANSITIONS);
  if (para.type === 'scene') {
    const dash = T.match(/^(.*\s[–-]\s)(\S*)$/);
    if (dash) return TIMES.filter((x) => x.startsWith(dash[2]) && x !== dash[2]).map((x) => dash[1] + x);
    if (!SCENE_RE.test(T)) return uniq(SCENE_STARTS);
    const used = Object.values(p.beats).flatMap((b) => b.paras.filter((x) => x.type === 'scene' && x.id !== para.id).map((x) => x.text.replace(/\s[–-]\s\S*$/, '')));
    return uniq(used);
  }
  return [];
}

interface RowProps {
  beatId: ID;
  para: Para;
  index: number;
  /** Počet odstavců v beatu. */
  count: number;
  sceneNo?: number;
  mark?: string;
  rev?: Revision;
}

/**
 * Jeden odstavec scénáře. Je zapamatovaný (memo) a aktuální data si bere ze stavu až při akci,
 * takže psaní v jednom odstavci nepřekresluje ostatní.
 */
const ParaRow = memo(function ParaRow({ beatId, para, index, count, sceneNo, mark, rev }: RowProps) {
  const [noteOpen, setNoteOpen] = useState(!!para.note);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    if (AUTO_SIZE) return;
    const el = ref.current!;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [para.text, para.type]);

  useEffect(() => {
    if (pendingFocus?.id === para.id) {
      const el = ref.current!;
      el.focus();
      el.setSelectionRange(pendingFocus.pos, pendingFocus.pos);
      pendingFocus = null;
    }
  });

  const sugg = focused ? suggestions(getState().project, para) : [];
  const edit = (fn: (paras: Para[]) => void, key?: string) => actions.editParas(beatId, fn, key);
  const setText = (text: string) => {
    edit((ps) => {
      const x = ps[index];
      x.text = text;
      // „int. “ na začátku akce z ní udělá hlavičku scény. Verzálky řeší zobrazení a export, text zůstává, jak byl napsán.
      if (x.type === 'action' && SCENE_RE.test(text) && !text.includes('\n')) x.type = 'scene';
    }, 'text');
  };
  const setType = (type: ParaType) =>
    edit((ps) => void (ps[index].type = type));
  const accept = (s: string) => {
    pendingFocus = { id: para.id, pos: s.length };
    edit((ps) => void (ps[index].text = s));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = el;
    const paras = getState().project.beats[beatId].paras;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (sugg.length && !e.shiftKey) return accept(sugg[0]);
      const i = TYPE_CYCLE.indexOf(para.type);
      setType(TYPE_CYCLE[(i + (e.shiftKey ? TYPE_CYCLE.length - 1 : 1)) % TYPE_CYCLE.length]);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!para.text.trim() && para.type !== 'action') return setType('action');
      const next = newPara(NEXT_TYPE[para.type], para.text.slice(b));
      pendingFocus = { id: next.id, pos: 0 };
      edit((ps) => {
        ps[index].text = para.text.slice(0, a);
        ps.splice(index + 1, 0, next);
      });
    } else if (e.key === 'Backspace' && a === 0 && b === 0 && index > 0) {
      e.preventDefault();
      const prev = paras[index - 1];
      pendingFocus = { id: prev.id, pos: prev.text.length };
      edit((ps) => {
        ps[index - 1].text += para.text;
        ps.splice(index, 1);
      });
    } else if (e.key === 'ArrowUp' && a === 0 && b === 0 && index > 0) {
      e.preventDefault();
      focusPara(el, -1);
    } else if (e.key === 'ArrowDown' && a === para.text.length && index < paras.length - 1) {
      e.preventDefault();
      focusPara(el, 1);
    }
  };

  return (
    <div className={`para para-${para.type}${focused ? ' focused' : ''}`}>
      <span className="para-gutter">
        {sceneNo && <b className="scene-no">{sceneNo}</b>}
        <button
          className={`note-btn${para.note ? ' has' : ''}`}
          tabIndex={-1}
          title={para.note ? 'Poznámka ke scénáři' : 'Přidat poznámku ke scénáři'}
          onClick={() => setNoteOpen(!noteOpen || !!para.note)}
        >
          P
        </button>
        <select
          value={para.type}
          tabIndex={-1}
          title="Typ odstavce (Tab přepíná)"
          onChange={(e) => {
            pendingFocus = { id: para.id, pos: para.text.length };
            setType(e.target.value as ParaType);
          }}
        >
          {(Object.keys(PARA_LABEL) as ParaType[]).map((t) => (
            <option key={t} value={t}>
              {PARA_LABEL[t]}
            </option>
          ))}
        </select>
      </span>
      <div className="para-body" style={mark ? { background: `color-mix(in srgb, ${mark} 22%, transparent)`, boxShadow: `-6px 0 0 color-mix(in srgb, ${mark} 22%, transparent), 6px 0 0 color-mix(in srgb, ${mark} 22%, transparent)` } : undefined}>
        <textarea
          ref={ref}
          rows={1}
          value={para.text}
          placeholder={index === 0 && count === 1 ? 'Text scény – Tab mění typ odstavce, Enter přidá další' : PARA_LABEL[para.type]}
          spellCheck
          data-para={para.id}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {rev && (
          <b className="rev-mark" style={{ color: rev.color }} title={`Změněno v revizi „${rev.name}“`}>
            *
          </b>
        )}
        {(noteOpen || para.note) && (
          <textarea
            className="para-note"
            rows={Math.max(1, (para.note ?? '').split('\n').length)}
            value={para.note ?? ''}
            placeholder="Poznámka ke scénáři (netiskne se)"
            onChange={(e) => edit((ps) => void (e.target.value ? (ps[index].note = e.target.value) : delete ps[index].note), 'note')}
            onBlur={() => !para.note && setNoteOpen(false)}
          />
        )}
        {sugg.length > 0 && (
          <ul className="suggest">
            {sugg.map((s, i) => (
              <li key={s} className={i === 0 ? 'top' : ''} onMouseDown={(e) => (e.preventDefault(), accept(s))}>
                {s}
                {i === 0 && <kbd>Tab</kbd>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

/** Přesune kurzor do sousedního odstavce (i přes hranici beatu). */
function focusPara(from: HTMLTextAreaElement, dir: 1 | -1) {
  const all = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[data-para]')];
  const next = all[all.indexOf(from) + dir];
  if (!next) return;
  next.focus();
  const pos = dir === 1 ? 0 : next.value.length;
  next.setSelectionRange(pos, pos);
}

/**
 * Editor textu jednoho beatu. `sceneBase` je počet scén před tímto beatem (pro číslování hlaviček).
 * Překreslí se jen při změně svého beatu, postav, revizí nebo zvýraznění.
 */
export const BeatEditor = memo(function BeatEditor({ beat, sceneBase }: { beat: Beat; sceneBase: number }) {
  const characters = useSel((s) => s.project.characters);
  const revisions = useSel((s) => s.project.revisions);
  const highlight = useSel((s) => s.highlight);
  // Barva zvýraznění: replika patří postavě z nejbližší hlavičky mluvčího nad ní.
  let who: ID | undefined;
  let scene = sceneBase;
  const rows = beat.paras.map((para) => {
    if (para.type === 'character') who = highlight.length ? speakerCharacter({ characters } as Project, para.text) : undefined;
    else if (para.type !== 'dialogue' && para.type !== 'paren') who = undefined;
    let rev: Revision | undefined;
    if (para.text.trim()) for (let i = revisions.length - 1; i >= 0 && !rev; i--) if (revisions[i].base[para.id] !== para.text) rev = revisions[i];
    return {
      mark: who && highlight.includes(who) ? characters.find((c) => c.id === who)?.color : undefined,
      rev,
      sceneNo: para.type === 'scene' && para.text.trim() ? ++scene : undefined,
    };
  });
  return (
    <div className="beat-editor">
      {beat.paras.map((para, i) => (
        <ParaRow key={para.id} beatId={beat.id} para={para} index={i} count={beat.paras.length} {...rows[i]} />
      ))}
    </div>
  );
});
