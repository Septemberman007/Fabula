import { RESEARCH_FOLDERS, beatName, beatNumber } from '../model';
import { State, actions, ui } from '../store';

/** Rešerše: podklady, nápady a odložené scény, volitelně navázané na beaty. */
export function Research({ s }: { s: State }) {
  const p = s.project;
  const folders = [...new Set([...RESEARCH_FOLDERS, ...p.research.map((r) => r.folder.trim()).filter(Boolean)])];
  const item = p.research.find((r) => r.id === s.research) ?? null;
  const beats = p.order.filter((id) => p.beats[id]);

  return (
    <div className="research">
      <aside className="res-list">
        {folders.map((f) => {
          const items = p.research.filter((r) => (r.folder.trim() || RESEARCH_FOLDERS[0]) === f);
          return (
            <section key={f}>
              <h4>
                {f} <small>{items.length || ''}</small>
                <button title={`Nová položka ve složce ${f}`} onClick={() => actions.addResearch(f)}>
                  +
                </button>
              </h4>
              {items.map((r) => (
                <button key={r.id} className={`res-item${r.id === s.research ? ' on' : ''}`} onClick={() => ui({ research: r.id })}>
                  <b>{r.title.trim() || 'Bez názvu'}</b>
                  <span>{r.text.slice(0, 60)}</span>
                </button>
              ))}
            </section>
          );
        })}
      </aside>

      <div className="res-doc">
        {item ? (
          <>
            <input className="res-title" value={item.title} placeholder="Název" onChange={(e) => actions.updateResearch(item.id, { title: e.target.value }, 'title')} />
            <div className="res-meta">
              <label>
                Složka
                <input list="res-folders" value={item.folder} onChange={(e) => actions.updateResearch(item.id, { folder: e.target.value }, 'folder')} />
                <datalist id="res-folders">
                  {folders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </label>
              <label className="grow">
                Odkaz
                <input value={item.url} placeholder="https://…" onChange={(e) => actions.updateResearch(item.id, { url: e.target.value }, 'url')} />
              </label>
              {/^https?:\/\//.test(item.url) && (
                <a href={item.url} target="_blank" rel="noreferrer">
                  Otevřít ↗
                </a>
              )}
            </div>
            <textarea
              className="res-text"
              value={item.text}
              placeholder="Poznámky, fakta, citace, nápady…"
              onChange={(e) => actions.updateResearch(item.id, { text: e.target.value }, 'text')}
            />
            <div className="res-beats">
              <h4>Souvisí s beaty</h4>
              <div className="chips">
                {item.beatIds
                  .filter((id) => p.beats[id])
                  .map((id) => (
                    <span key={id} className="chip on-soft">
                      <button className="linklike" onClick={() => ui({ selected: id, multi: [], view: 'board', tab: 'detail' })}>
                        {beatNumber(p, id)}. {beatName(p, id)}
                      </button>
                      <button className="x" title="Odebrat" onClick={() => actions.updateResearch(item.id, { beatIds: item.beatIds.filter((b) => b !== id) })}>
                        ×
                      </button>
                    </span>
                  ))}
                <select value="" onChange={(e) => e.target.value && actions.updateResearch(item.id, { beatIds: [...item.beatIds, e.target.value] })}>
                  <option value="">+ Připojit beat…</option>
                  {beats
                    .filter((id) => !item.beatIds.includes(id))
                    .map((id) => (
                      <option key={id} value={id}>
                        {beatNumber(p, id)}. {beatName(p, id)}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <button className="danger" onClick={() => actions.deleteResearch(item.id)}>
              Smazat položku
            </button>
          </>
        ) : (
          <p className="muted">Vyber položku vlevo, nebo založ novou tlačítkem „+“ u složky. Rešerši můžeš připojit k beatům a najdeš ji pak i v jejich detailu.</p>
        )}
      </div>
    </div>
  );
}
