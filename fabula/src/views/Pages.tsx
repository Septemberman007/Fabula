import { memo } from 'react';
import { ID, Project } from '../model';
import { ui } from '../store';
import { LAYOUT, PAPERS, Pagination } from '../paginate';

/**
 * Scénář rozložený na strany: náhled na obrazovce a zároveň podklad pro tisk.
 * Řádky jsou už zalomené stránkováním, takže se tisknou přesně tak, jak se počítají.
 */
export const Pages = memo(function Pages({ p, pg, zoom, selected }: { p: Project; pg: Pagination; zoom: number; selected: ID | null }) {
  const paper = PAPERS[pg.paper];
  const tp = p.titlePage;
  const changed = (paraId: ID, beatId: ID) => {
    const para = p.beats[beatId]?.paras.find((x) => x.id === paraId);
    return !!para && p.revisions.some((r) => r.base[paraId] !== para.text);
  };
  const size = { width: paper.width, height: paper.height };
  return (
    <div className="sheets" style={zoom !== 1 ? { zoom } : undefined}>
      <style>{`@media print { @page { size: ${paper.css}; margin: 0; } }`}</style>
      <div className="sheet sheet-title" style={size}>
        <h1>{p.title}</h1>
        {tp.author.trim() && (
          <p>
            Napsal
            <br />
            {tp.author}
          </p>
        )}
        {tp.basedOn.trim() && <p>{tp.basedOn}</p>}
        <footer>
          {tp.draft}
          {tp.contact.trim() && <pre>{tp.contact}</pre>}
        </footer>
      </div>
      {pg.pages.map((page) => (
        <div key={page.n} className="sheet" style={size}>
          {page.n > 1 && <div className="sheet-no">{page.n}.</div>}
          <div className="sheet-body">
            {page.items.map((it, i) => {
              const type = it.type === 'more' ? 'character' : it.type;
              const rev = p.revisions.length > 0 && it.type !== 'more' && !it.contd && changed(it.paraId, it.beatId);
              return (
                <div
                  key={i}
                  data-script-beat={it.beatId}
                  className={`sl sl-${it.type}${it.beatId === selected ? ' on' : ''}`}
                  style={{ marginTop: `calc(${it.gap} * var(--sl))`, paddingLeft: `${LAYOUT[type].indent}ch` }}
                  onClick={() => ui({ selected: it.beatId, tab: 'detail' })}
                >
                  {it.sceneNo && <b className="sl-no">{it.sceneNo}</b>}
                  {it.lines.join('\n')}
                  {it.sceneNo && <b className="sl-no right">{it.sceneNo}</b>}
                  {rev && <b className="sl-rev">*</b>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {pg.pages.length === 0 && <p className="muted">Scénář zatím nemá žádný text, takže není co stránkovat.</p>}
    </div>
  );
});
