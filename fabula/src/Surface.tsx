import { CSSProperties, ClipboardEvent, Fragment, KeyboardEvent, ReactNode, RefObject, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Beat, ID, PARA_LABEL, Para, ParaType, Project, Revision } from './model';
import { actions, getState, ui, useSel } from './store';
import { tint } from './colors';
import { SCENE_RE, TYPE_CYCLE, speaker, speakerCharacter } from './text';
import { Caret, Pos, Seg, copyAcross, deleteAcross, deleteRange, detectScene, editField, insertText, paste, segText, splitPara } from './edit';

/**
 * Souvislá psací plocha scénáře. Jedna plocha může obsahovat jeden beat (panel u tabule) nebo celý
 * scénář včetně názvů a synopsí beatů; výběr, mazání, kopírování a vkládání pak fungují přes všechno.
 *
 * Plochu tvoří „úseky“ (název, synopse, odstavec), označené atributem data-seg. Běžné psaní uvnitř
 * úseku nechává na prohlížeči (kvůli diakritice psané mrtvými klávesami a kontrole pravopisu) a text
 * si z plochy přečte zpět; vše, co mění stavbu, provádí nad daty.
 */

/** Kam má po překreslení skočit kurzor. */
let pendingCaret: (Caret & { root: HTMLElement }) | null = null;

const TRANSITIONS = ['STŘIH NA:', 'PROLÍNAČKA:', 'ZATMÍVAČKA.', 'ROZTMÍVAČKA:'];
const SCENE_STARTS = ['INT. ', 'EXT. ', 'INT./EXT. '];
const TIMES = ['DEN', 'NOC', 'RÁNO', 'VEČER', 'SVÍTÁNÍ', 'SOUMRAK', 'POZDĚJI', 'NAVAZUJE'];

function suggestions(p: Project, para: Para): string[] {
  const T = para.text.toLocaleUpperCase('cs');
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

// ---------- Převod mezi daty a plochou ----------

/** Text tak, jak má být v ploše: koncový ruční řádek potřebuje zarážku, jinak by nebyl vidět. */
const domText = (text: string) => (text.endsWith('\n') ? text + '\n' : text);
const readText = (el: Element) => (el.textContent ?? '').replace(/ /g, ' ').replace(/\n$/, '');
const segOf = (el: HTMLElement): Seg => ({ beatId: el.dataset.beat!, kind: el.dataset.seg as Seg['kind'], paraId: el.dataset.para });
const findSeg = (root: HTMLElement, s: Seg) =>
  root.querySelector<HTMLElement>(s.kind === 'para' ? `[data-para="${CSS.escape(s.paraId!)}"]` : `[data-seg="${s.kind}"][data-beat="${CSS.escape(s.beatId)}"]`);

interface Hit {
  el: HTMLElement;
  off: number;
}

/** Poloha v ploše (uzel a posun) jako úsek a znak v něm. */
function hit(root: HTMLElement, node: Node, offset: number): Hit | null {
  const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest<HTMLElement>('[data-seg]');
  if (el && root.contains(el)) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, offset);
    return { el, off: Math.min(r.toString().length, readText(el).length) };
  }
  if (!(node instanceof HTMLElement) || !root.contains(node)) return null;
  // Kurzor mezi úseky: patří na začátek následujícího, případně na konec předchozího.
  const segIn = (n: Node | undefined, lastOne: boolean) => {
    if (!(n instanceof HTMLElement)) return null;
    if (n.dataset.seg) return n;
    const all = n.querySelectorAll<HTMLElement>('[data-seg]');
    return all.length ? all[lastOne ? all.length - 1 : 0] : null;
  };
  const next = segIn(node.childNodes[offset], false);
  if (next) return { el: next, off: 0 };
  const prev = segIn(node.childNodes[offset - 1], true);
  return prev ? { el: prev, off: readText(prev).length } : null;
}

function setCaret(el: HTMLElement, off: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = off;
  let placed = false;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (left <= n.length) {
      r.setStart(n, left);
      placed = true;
      break;
    }
    left -= n.length;
  }
  if (!placed) r.setStart(el, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Posun kurzoru uvnitř úseku, pokud v něm kurzor je. */
function caretIn(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed || !sel.anchorNode || !el.contains(sel.anchorNode)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length;
}

// ---------- Úsek ----------

interface SegProps {
  seg: Seg['kind'];
  beatId: ID;
  paraId?: ID;
  text: string;
  className: string;
  /** Nápověda v prázdném úseku. */
  ph?: string;
  scene?: number;
  page?: number;
  /** První zlom strany uvnitř odstavce ve tvaru „řádek:strana“. */
  split?: string;
  mark?: string;
  rev?: string;
  indent?: string;
}

/**
 * Jeden úsek plochy. React mu spravuje jen obal; text zapisuje sám a jen tehdy, když se liší od toho,
 * co v ploše už je. Díky tomu psaní neposkakuje s kurzorem.
 */
export const SegText = memo(function SegText({ seg, beatId, paraId, text, className, ph, scene, page, split, mark, rev, indent }: SegProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const want = domText(text);
    if (el.textContent === want && el.firstChild) return;
    const off = caretIn(el);
    el.textContent = want;
    if (!want) el.appendChild(document.createElement('br'));
    if (off !== null && !pendingCaret) setCaret(el, Math.min(off, text.length));
  });
  const [after, splitPage] = split ? split.split(':') : [];
  const shadows = [rev && `inset -3px 0 0 ${rev}`, mark && `-6px 0 0 ${tint(mark, 0.22)}`].filter(Boolean).join(', ');
  const style = {
    ...(indent ? { '--in': indent } : null),
    ...(after ? { '--split': after } : null),
    ...(mark ? { background: tint(mark, 0.22) } : null),
    ...(shadows ? { boxShadow: shadows } : null),
  } as CSSProperties;
  return (
    <div
      ref={ref}
      data-seg={seg}
      data-beat={beatId}
      data-para={paraId}
      className={className}
      data-scene={scene}
      data-page={page}
      data-split={page ? undefined : splitPage}
      data-ph={text ? undefined : ph}
      title={rev ? 'Změněno v revizi' : undefined}
      style={style}
    />
  );
});

const INDENT: Record<ParaType, string> = { scene: '0ch', action: '0ch', character: '22ch', dialogue: '10ch', paren: '16ch', transition: '0ch' };

interface ParasProps {
  beat: Beat;
  /** Počet scén před tímto beatem (pro číslování hlaviček). */
  sceneBase: number;
  /** Zlomy stran ve tvaru „odstavec>strana“ nebo „odstavec@řádek>strana“ oddělené svislítkem. */
  marks?: string;
  /** Odstavec s kurzorem, pokud je v tomto beatu. */
  cur: ID | null;
  /** Odstavec s právě otevřenou poznámkou, pokud je v tomto beatu. */
  noteOpen: ID | null;
  onNoteClose: (id: null) => void;
}

/** Odstavce jednoho beatu a poznámky k nim. Patří dovnitř plochy. */
export const BeatParas = memo(function BeatParas({ beat, sceneBase, marks, cur, noteOpen, onNoteClose }: ParasProps) {
  const characters = useSel((s) => s.project.characters);
  const revisions = useSel((s) => s.project.revisions);
  const highlight = useSel((s) => s.highlight);
  const pageBefore = new Map<ID, number>();
  const inside = new Map<ID, string>();
  for (const m of marks ? marks.split('|') : []) {
    const [key, page] = m.split('>');
    const [pid, after] = key.split('@');
    if (after === undefined) pageBefore.set(pid, +page);
    else if (!inside.has(pid)) inside.set(pid, `${after}:${page}`);
  }
  // Barva zvýraznění: replika patří postavě z nejbližší hlavičky mluvčího nad ní.
  let who: ID | undefined;
  let scene = sceneBase;
  return (
    <>
      {beat.paras.map((para, i) => {
        if (para.type === 'character') who = highlight.length ? speakerCharacter({ characters } as Project, para.text) : undefined;
        else if (para.type !== 'dialogue' && para.type !== 'paren') who = undefined;
        let rev: Revision | undefined;
        if (para.text.trim()) for (let k = revisions.length - 1; k >= 0 && !rev; k--) if (revisions[k].base[para.id] !== para.text) rev = revisions[k];
        return (
          <Fragment key={para.id}>
            <SegText
              seg="para"
              beatId={beat.id}
              paraId={para.id}
              text={para.text}
              className={`pe pe-${para.type}${para.id === cur ? ' cur' : ''}`}
              ph={PARA_LABEL[para.type]}
              scene={para.type === 'scene' && para.text.trim() ? ++scene : undefined}
              page={pageBefore.get(para.id)}
              split={inside.get(para.id)}
              mark={who && highlight.includes(who) ? characters.find((c) => c.id === who)?.color : undefined}
              rev={rev?.color}
              indent={INDENT[para.type]}
            />
            {(para.note || noteOpen === para.id) && (
              <div className="pe-note" contentEditable={false}>
                <textarea
                  rows={Math.max(1, (para.note ?? '').split('\n').length)}
                  value={para.note ?? ''}
                  placeholder="Poznámka ke scénáři (netiskne se)"
                  autoFocus={noteOpen === para.id && !para.note}
                  onChange={(e) => actions.editParas(beat.id, (ps) => void (e.target.value ? (ps[i].note = e.target.value) : delete ps[i].note), 'note')}
                  onBlur={() => !para.note && onNoteClose(null)}
                />
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
});

// ---------- Ovládání plochy ----------

interface Cur {
  beatId: ID;
  paraId: ID;
}

/**
 * Připojí k ploše psaní, mazání, schránku a nástroje u odstavce s kurzorem.
 * `root` je upravitelný prvek, `wrap` jeho obal s `position: relative`, ve kterém se kreslí nástroje.
 * S `follow` se podle kurzoru vybírá beat v aplikaci.
 */
export function useSurface(root: RefObject<HTMLDivElement>, wrap: RefObject<HTMLElement>, follow: boolean) {
  const [cur, setCur] = useState<Cur | null>(null);
  const [noteOpen, setNoteOpen] = useState<ID | null>(null);
  const [focused, setFocused] = useState(false);
  const [box, setBox] = useState<{ top: number; height: number; left: number; gutter: number } | null>(null);
  /** Nouzové překreslení celé plochy, kdyby se její stavba rozešla s daty. */
  const [epoch, setEpoch] = useState(0);

  const project = () => getState().project;
  /** Výběr v ploše jako dvojice poloh seřazená od začátku. */
  const selection = (): { a: Hit; b: Hit } | null => {
    const sel = window.getSelection();
    const el = root.current;
    if (!el || !sel?.rangeCount || !sel.anchorNode || !sel.focusNode || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return null;
    const x = hit(el, sel.anchorNode, sel.anchorOffset);
    const y = hit(el, sel.focusNode, sel.focusOffset);
    if (!x || !y) return null;
    const forward = x.el === y.el ? x.off <= y.off : !!(x.el.compareDocumentPosition(y.el) & Node.DOCUMENT_POSITION_FOLLOWING);
    return forward ? { a: x, b: y } : { a: y, b: x };
  };
  /** Úseky od prvního po poslední včetně, v pořadí na ploše. */
  const between = (a: HTMLElement, b: HTMLElement): Seg[] => {
    const all = [...root.current!.querySelectorAll<HTMLElement>('[data-seg]')];
    return all.slice(all.indexOf(a), all.indexOf(b) + 1).map(segOf);
  };
  /** Provede úpravu nad daty a nechá kurzor skočit tam, kam úprava ukáže. */
  const run = (fn: (p: Project) => Caret, key?: string) =>
    actions.editScript((p) => {
      pendingCaret = { ...fn(p), root: root.current! };
    }, key);
  /** Úprava odstavců jednoho beatu, s polohou kurzoru jako pořadím odstavce a znakem. */
  const inBeat = (beatId: ID, fn: (ps: Para[]) => Pos) => (p: Project): Caret => {
    const ps = p.beats[beatId].paras;
    const c = fn(ps);
    const q = ps[Math.min(c.i, ps.length - 1)];
    return { beatId, kind: 'para', paraId: q.id, off: Math.min(c.off, q.text.length) };
  };
  const index = (s: Seg) => project().beats[s.beatId].paras.findIndex((x) => x.id === s.paraId);
  /** Vloží text na polohu kurzoru vrácenou předchozím krokem úpravy. */
  const insertAt = (p: Project, c: Caret, text: string, multi: boolean): Caret => {
    if (c.kind !== 'para') return editField(p, c, c.off, c.off, text);
    const ps = p.beats[c.beatId].paras;
    const at = { i: ps.findIndex((x) => x.id === c.paraId), off: c.off };
    return inBeat(c.beatId, (d) => (multi ? paste(d, at, text) : insertText(d, at, text)))(p);
  };

  const setType = (c: Cur, type: ParaType) => {
    const el = root.current && findSeg(root.current, { beatId: c.beatId, kind: 'para', paraId: c.paraId });
    const off = el ? caretIn(el) : null;
    run(
      inBeat(c.beatId, (ps) => {
        const i = ps.findIndex((x) => x.id === c.paraId);
        ps[i].type = type;
        return { i, off: off ?? ps[i].text.length };
      }),
    );
    root.current?.focus();
  };
  const accept = (c: Cur, text: string) =>
    run(
      inBeat(c.beatId, (ps) => {
        const i = ps.findIndex((x) => x.id === c.paraId);
        ps[i].text = text;
        return { i, off: text.length };
      }),
    );

  // Po každém překreslení: kurzor na místo určené poslední úpravou a nástroje k aktuálnímu odstavci.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (pendingCaret?.root === el) {
      const target = findSeg(el, pendingCaret);
      if (target) {
        if (document.activeElement !== el) el.focus();
        setCaret(target, pendingCaret.off);
        target.scrollIntoView({ block: 'nearest' });
      }
      pendingCaret = null;
    }
    const at = cur ? findSeg(el, { ...cur, kind: 'para' }) : null;
    let next: typeof box = null;
    if (at) {
      next = { top: 0, height: at.offsetHeight, left: 0, gutter: 0 };
      for (let n: HTMLElement | null = at; n && n !== wrap.current; n = n.offsetParent as HTMLElement | null) {
        next.top += n.offsetTop;
        next.left += n.offsetLeft;
      }
      // Nástroje stojí vždy u levého okraje sloupce akce, i když je odstavec odsazený.
      next.gutter = next.left - (parseFloat(getComputedStyle(at).marginLeft) || 0);
    }
    if (next?.top !== box?.top || next?.height !== box?.height || next?.left !== box?.left) setBox(next);
  });

  // Vstup z klávesnice, schránky a diktování přichází jako „beforeinput“ s popisem záměru.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onBefore = (e: InputEvent) => {
      if (e.target !== el) return;
      const t = e.inputType;
      if (t === 'historyUndo' || t === 'historyRedo') {
        e.preventDefault();
        return t === 'historyUndo' ? actions.undo() : actions.redo();
      }
      if (t.startsWith('format') || t === 'deleteByDrag' || t === 'insertFromDrop') return e.preventDefault();
      if (e.isComposing || t === 'insertCompositionText') return;
      const sel = selection();
      // Kurzor mimo úseky (například na okraji stránky): psaní by rozbilo stavbu plochy.
      if (!sel) return e.preventDefault();
      const { a, b } = sel;
      const sa = segOf(a.el);
      const act = (fn: (p: Project) => Caret, key?: string) => {
        e.preventDefault();
        run(fn, key);
      };
      const clip = () => (e.dataTransfer?.getData('text/plain') ?? e.data ?? '').replace(/\r\n?/g, '\n');

      // Výběr přes více úseků: nejdřív ho smažeme, pak případně vložíme nový text na jeho začátek.
      if (a.el !== b.el) {
        const segs = between(a.el, b.el);
        const cut = (p: Project) => deleteAcross(p, segs, a.off, b.off);
        if (t.startsWith('delete')) return act(cut);
        if (t === 'insertParagraph') return act((p) => {
          const c = cut(p);
          if (c.kind !== 'para') return c;
          const ps = p.beats[c.beatId].paras;
          return inBeat(c.beatId, (d) => splitPara(d, { i: ps.findIndex((x) => x.id === c.paraId), off: c.off }))(p);
        });
        if (t === 'insertFromPaste' || t === 'insertFromYank') return act((p) => insertAt(p, cut(p), clip(), true));
        if (t === 'insertLineBreak') return act((p) => insertAt(p, cut(p), '\n', false));
        if (t.startsWith('insert')) return act((p) => insertAt(p, cut(p), e.data ?? '', false), `text:${sa.beatId}`);
        return e.preventDefault();
      }

      const text = segText(project(), sa);
      const atStart = a.off === 0 && b.off === 0;
      const atEnd = a.off === text.length && b.off === text.length;

      // Název a synopse: jednoduchá textová pole uvnitř plochy.
      if (sa.kind !== 'para') {
        if (t === 'insertParagraph' || t === 'insertLineBreak') {
          if (sa.kind === 'syn') return act((p) => editField(p, sa, a.off, b.off, '\n'));
          e.preventDefault();
          const all = [...el.querySelectorAll<HTMLElement>('[data-seg]')];
          const next = all[all.indexOf(a.el) + 1];
          if (next) setCaret(next, 0);
          return;
        }
        if (t === 'insertFromPaste' || t === 'insertFromYank') return act((p) => editField(p, sa, a.off, b.off, clip()));
        // Mazání na okraji by v ploše slilo sousední úseky.
        if (t.startsWith('delete') && ((t.includes('Backward') && atStart) || (t.includes('Forward') && atEnd))) e.preventDefault();
        return;
      }

      const beatId = sa.beatId;
      const i = index(sa);
      const from: Pos = { i, off: a.off };
      const to: Pos = { i, off: b.off };
      const n = project().beats[beatId].paras.length;
      if (t === 'insertParagraph') return act(inBeat(beatId, (d) => splitPara(d, deleteRange(d, from, to))));
      if (t === 'insertLineBreak') return act(inBeat(beatId, (d) => insertText(d, deleteRange(d, from, to), '\n')));
      if (t === 'insertFromPaste' || t === 'insertFromYank') return act(inBeat(beatId, (d) => paste(d, deleteRange(d, from, to), clip())));
      if (t.startsWith('delete')) {
        // Na okraji odstavce mazání spojuje se sousedem ve stejném beatu; uvnitř ho necháme na prohlížeči.
        if (t.includes('Backward') && atStart) {
          e.preventDefault();
          if (i > 0) run(inBeat(beatId, (d) => deleteRange(d, { i: i - 1, off: d[i - 1].text.length }, from)));
        } else if (t.includes('Forward') && atEnd) {
          e.preventDefault();
          if (i < n - 1) run(inBeat(beatId, (d) => deleteRange(d, from, { i: i + 1, off: 0 })));
        }
      }
    };

    /** Po zásahu prohlížeče přečteme text úseků dotčeného beatu zpět do dat. */
    const onInput = (e: Event) => {
      if (e.target !== el) return;
      const sel = window.getSelection();
      const at = sel?.focusNode ? hit(el, sel.focusNode, sel.focusOffset) : null;
      if (!at) return;
      const beatId = at.el.dataset.beat!;
      const scope = at.el.closest<HTMLElement>('[data-beat-root]') ?? el;
      const els = [...scope.querySelectorAll<HTMLElement>('[data-seg]')].filter((x) => x.dataset.beat === beatId);
      const beat = project().beats[beatId];
      const paraEls = els.filter((x) => x.dataset.seg === 'para');
      if (paraEls.length && (paraEls.length !== beat.paras.length || paraEls.some((x, i) => x.dataset.para !== beat.paras[i].id))) return setEpoch((n) => n + 1);
      const changed = els.map((x) => ({ seg: segOf(x), text: readText(x) })).filter((x) => x.text !== segText(project(), x.seg));
      if (!changed.length) return;
      actions.editScript((p) => {
        for (const { seg, text } of changed) {
          if (seg.kind !== 'para') {
            editField(p, seg, 0, segText(p, seg).length, text);
            continue;
          }
          const para = p.beats[seg.beatId].paras.find((x) => x.id === seg.paraId);
          if (!para) continue;
          para.text = text;
          detectScene(para);
        }
      }, `text:${beatId}`);
    };
    const onCompose = () => {
      // Skládaný znak (háček, čárka) patří do jednoho úseku: výběr přes více úseků nejdřív zrušíme.
      const sel = selection();
      if (sel && sel.a.el !== sel.b.el) window.getSelection()?.collapseToEnd();
    };
    const onDrag = (e: Event) => e.preventDefault();
    el.addEventListener('beforeinput', onBefore);
    el.addEventListener('input', onInput);
    el.addEventListener('compositionstart', onCompose);
    el.addEventListener('dragstart', onDrag);
    return () => {
      el.removeEventListener('beforeinput', onBefore);
      el.removeEventListener('input', onInput);
      el.removeEventListener('compositionstart', onCompose);
      el.removeEventListener('dragstart', onDrag);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, root.current]);

  // Úsek s kurzorem sledujeme jen u plochy, která má fokus.
  useEffect(() => {
    if (!focused) return;
    const onSel = () => {
      const sel = window.getSelection();
      const el = root.current;
      if (!el || !sel?.focusNode || !el.contains(sel.focusNode)) return;
      const at = hit(el, sel.focusNode, sel.focusOffset);
      if (!at) return;
      const s = segOf(at.el);
      setCur((c) => (s.kind !== 'para' ? null : c?.paraId === s.paraId ? c : { beatId: s.beatId, paraId: s.paraId! }));
      if (!follow) return;
      // Výběr textu přes několik beatů je zároveň výběrem těch beatů na tabuli a časové ose.
      const beatOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-script-beat]') ?? null;
      const [a, b] = [beatOf(sel.anchorNode), beatOf(sel.focusNode)];
      let span: string[] = [];
      if (a && b && a !== b && el.contains(a)) {
        const all = [...el.querySelectorAll<HTMLElement>('[data-script-beat]')];
        const [i, j] = [all.indexOf(a), all.indexOf(b)].sort((x, y) => x - y);
        span = all.slice(i, j + 1).map((x) => x.dataset.scriptBeat!);
      }
      const st = getState();
      if (st.selected !== s.beatId || span.join() !== st.multi.join()) ui({ selected: s.beatId, multi: span, tab: 'detail' });
    };
    document.addEventListener('selectionchange', onSel);
    onSel();
    return () => document.removeEventListener('selectionchange', onSel);
  }, [focused, follow, root]);

  const curPara = cur ? project().beats[cur.beatId]?.paras.find((x) => x.id === cur.paraId) : undefined;
  const sugg = cur && curPara && focused ? suggestions(project(), curPara) : [];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== root.current || e.key !== 'Tab') return;
    e.preventDefault();
    const sel = selection();
    if (!sel) return;
    const s = segOf(sel.b.el);
    if (s.kind !== 'para') {
      // Z názvu a synopse Tab přejde na další úsek.
      const all = [...root.current.querySelectorAll<HTMLElement>('[data-seg]')];
      const next = all[all.indexOf(sel.b.el) + (e.shiftKey ? -1 : 1)];
      if (next) setCaret(next, 0);
      return;
    }
    const c = { beatId: s.beatId, paraId: s.paraId! };
    if (sugg.length && !e.shiftKey && cur?.paraId === c.paraId) return accept(c, sugg[0]);
    const type = project().beats[s.beatId].paras[index(s)].type;
    const k = TYPE_CYCLE.indexOf(type);
    setType(c, TYPE_CYCLE[(k + (e.shiftKey ? TYPE_CYCLE.length - 1 : 1)) % TYPE_CYCLE.length]);
  };

  /** Výběr přes více úseků kopírujeme jako scénář (Fountain), aby se dal vložit zpět se zachováním typů. */
  const onClip = (e: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    if (e.target instanceof HTMLTextAreaElement) return;
    const sel = selection();
    if (!sel || sel.a.el === sel.b.el) return;
    e.preventDefault();
    const segs = between(sel.a.el, sel.b.el);
    e.clipboardData.setData('text/plain', copyAcross(project(), segs, sel.a.off, sel.b.off));
    if (cut) run((p) => deleteAcross(p, segs, sel.a.off, sel.b.off));
  };

  const overlay: ReactNode = cur && curPara && box && (
    <>
      <div className="pe-tools" style={{ top: box.top, right: `calc(100% - ${box.gutter}px + 40px)` }}>
        <select value={curPara.type} tabIndex={-1} title="Typ odstavce (Tab přepíná)" onChange={(e) => setType(cur, e.target.value as ParaType)}>
          {(Object.keys(PARA_LABEL) as ParaType[]).map((t) => (
            <option key={t} value={t}>
              {PARA_LABEL[t]}
            </option>
          ))}
        </select>
        <button
          className={`note-btn${curPara.note ? ' has' : ''}`}
          tabIndex={-1}
          title={curPara.note ? 'Poznámka ke scénáři' : 'Přidat poznámku ke scénáři'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setNoteOpen(noteOpen === cur.paraId ? null : cur.paraId)}
        >
          P
        </button>
      </div>
      {sugg.length > 0 && (
        <ul className="suggest" style={{ top: box.top + box.height, left: box.left }}>
          {sugg.map((s, i) => (
            <li key={s} className={i === 0 ? 'top' : ''} onMouseDown={(e) => (e.preventDefault(), accept(cur, s))}>
              {s}
              {i === 0 && <kbd>Tab</kbd>}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return {
    cur,
    noteOpen,
    setNoteOpen,
    epoch,
    overlay,
    /** Vlastnosti upravitelného prvku plochy. */
    host: {
      contentEditable: true,
      suppressContentEditableWarning: true,
      spellCheck: true,
      role: 'textbox',
      'aria-multiline': true,
      'aria-label': 'Text scénáře',
      onKeyDown,
      onCopy: (e: ClipboardEvent<HTMLDivElement>) => onClip(e, false),
      onCut: (e: ClipboardEvent<HTMLDivElement>) => onClip(e, true),
    } as const,
    /** Vlastnosti obalu: sledují, jestli má plocha fokus. */
    focus: {
      onFocus: () => setFocused(true),
      onBlur: (e: { relatedTarget: EventTarget | null }) => {
        if (wrap.current?.contains(e.relatedTarget as Node)) return;
        setFocused(false);
        setCur(null);
      },
    },
  };
}
