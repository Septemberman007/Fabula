import { RefObject, useEffect, useRef, useState } from 'react';
import type { ID, Project } from './model';
import { openReport } from './views/Reports';
import { actions } from './store';
import { DEFAULT_CATEGORIES, ensureProduction, findAll, forms, tagText } from './production';
import { tint } from './colors';

/**
 * Zvýraznění produkčních prvků ve scénáři barvou jejich kategorie. Používá CSS Custom Highlight API,
 * takže do upravitelného textu nesahá; prohlížeč, který ho nezná (Safari před 17.2), jen nezvýrazní.
 */
export function useProdHighlight(root: RefObject<HTMLElement>, p: Project, on: boolean, epoch: number) {
  const prod = p.production;
  useEffect(() => {
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (!H || !reg) return;
    const clear = () => {
      for (const k of [...reg.keys()]) if (String(k).startsWith('fab-prod-')) reg.delete(k);
    };
    if (!on || !prod?.elements.length) return clear();
    const t = setTimeout(() => {
      clear();
      const el = root.current;
      if (!el) return;
      const byCat = new Map<ID, Range[]>();
      for (const node of el.querySelectorAll<HTMLElement>('[data-seg="para"]')) {
        if (node.classList.contains('pe-character')) continue;
        const text = node.textContent ?? '';
        if (!text.trim()) continue;
        // Text odstavce bývá v jednom uzlu; pro jistotu se pozice přepočítají přes všechny.
        const parts: { n: Text; from: number }[] = [];
        const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let from = 0;
        for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) parts.push({ n, from }), (from += n.data.length);
        const at = (off: number): [Text, number] => {
          const part = [...parts].reverse().find((x) => x.from <= off) ?? parts[0];
          return [part.n, Math.min(off - part.from, part.n.data.length)];
        };
        for (const x of prod.elements) {
          for (const [a, b] of findAll(text, x)) {
            const r = document.createRange();
            r.setStart(...at(a));
            r.setEnd(...at(b));
            byCat.set(x.categoryId, [...(byCat.get(x.categoryId) ?? []), r]);
          }
        }
      }
      prod.categories.forEach((c, i) => {
        const r = byCat.get(c.id);
        if (r?.length) reg.set(`fab-prod-${i}`, new H(...r));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [prod, p.beats, on, epoch, root]);
  useEffect(() => () => {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (reg) for (const k of [...reg.keys()]) if (String(k).startsWith('fab-prod-')) reg.delete(k);
  }, []);
}

/** Barvy zvýraznění podle kategorií. */
export function ProdStyle({ p }: { p: Project }) {
  const cats = p.production?.categories ?? [];
  return <style>{cats.map((c, i) => `::highlight(fab-prod-${i}) { background-color: ${tint(c.color, 0.28)}; text-decoration: underline 2px ${c.color}; }`).join('\n')}</style>;
}

/** Vybraný text ve scénáři (jen v rámci plochy editoru). */
function selectedText(scope: HTMLElement | null): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !scope || !sel.anchorNode || !scope.contains(sel.anchorNode)) return '';
  return sel.toString().replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Tlačítko „Označit prvek“: vybraný text se zařadí do kategorie jako nový prvek, nebo se přidá
 * k existujícímu jako další tvar. Od té doby se prvek najde ve všech scénách sám.
 */
export function ProdTagButton({ p, scope }: { p: Project; scope: RefObject<HTMLElement> }) {
  const [open, setOpen] = useState<{ sel: string; name: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', close));
  }, [open]);
  const cats = p.production?.categories ?? [];
  const q = open?.name.toLocaleLowerCase('cs') ?? '';
  const similar = q
    ? (p.production?.elements ?? []).filter((x) => forms(x).some((f) => f.toLocaleLowerCase('cs').replace(/\*$/, '').startsWith(q.slice(0, Math.max(3, q.length - 3))))).slice(0, 6)
    : [];
  const done = (fn: (d: Project) => void) => {
    actions.editScript((d) => {
      ensureProduction(d);
      fn(d);
    });
    setOpen(null);
  };
  /** Kategorie se pozná podle id, u projektu bez produkce (výchozí kategorie teprve vzniknou) podle názvu. */
  const create = (category: string) =>
    done((d) => {
      const prod = ensureProduction(d);
      const categoryId = (prod.categories.find((c) => c.id === category) ?? prod.categories.find((c) => c.name === category))?.id;
      if (!categoryId) return;
      const id = tagText(d, open!.name, categoryId);
      // Vybraný tvar („pistolí“) se přidá k základnímu jménu („pistole“), aby se našel i on.
      if (id && open!.sel && open!.sel !== open!.name) tagText(d, open!.sel, categoryId, id);
    });
  return (
    <span className="prod-tag-wrap">
      <button
        className="read-btn"
        title="Označí vybraný text jako produkční prvek (rekvizita, kostým, komparz…); pak se najde ve všech scénách"
        onMouseDown={(e) => {
          // Výběr v textu musí zůstat: tlačítko si ho přečte dřív, než by zmizel.
          e.preventDefault();
          const sel = selectedText(scope.current);
          setOpen(open ? null : { sel, name: sel });
        }}
      >
        Označit prvek
      </button>
      {open && (
        <div className="prod-pop" ref={box}>
          {!open.sel && <p className="muted small">Ve scénáři vyber slovo nebo spojení (třeba „pistole“), nebo název napiš sem.</p>}
          <input autoFocus value={open.name} placeholder="Název prvku" onChange={(e) => setOpen({ ...open, name: e.target.value })} />
          {open.name.trim() && (
            <>
              {similar.length > 0 && (
                <>
                  <small>Přidat jako další tvar k prvku</small>
                  <div className="prod-pop-list">
                    {similar.map((x) => {
                      const c = cats.find((k) => k.id === x.categoryId);
                      return (
                        <button key={x.id} onClick={() => done((d) => void tagText(d, open.sel || open.name, x.categoryId, x.id))}>
                          <i style={{ background: c?.color }} />
                          {x.name} <small>{c?.name}</small>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <small>Nový prvek v kategorii</small>
              <div className="prod-pop-cats">
                {(cats.length ? cats : DEFAULT_CATEGORIES.map(([name, color]) => ({ id: name, name, color }))).map((c) => (
                  <button key={c.id} style={{ borderColor: c.color }} onClick={() => create(c.id)}>
                    <i style={{ background: c.color }} />
                    {c.name}
                  </button>
                ))}
              </div>
              {open.sel && findAll(open.sel, { name: open.name, aliases: '' }).length === 0 && open.sel !== open.name && (
                <p className="muted small">Tvar „{open.sel}“ se k prvku přidá, aby se našel i on.</p>
              )}
            </>
          )}
          <button className="linklike" onClick={() => (setOpen(null), openReport('production'))}>
            Produkční rozpis →
          </button>
        </div>
      )}
    </span>
  );
}
