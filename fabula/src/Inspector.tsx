import { BeatStatus, CharRole, ID, Link, STATUS_LABEL, TAG_CATEGORIES, TAG_MODE_LABEL, TagMode, beatName, beatNumber, groupBeats, groupLabel, tagCategories } from './model';
import { State, Tab, actions, ui } from './store';
import { Issue } from './evaluate';
import { detectedCharacters, unknownSpeakers } from './text';
import { eighths, pageRange, paginate } from './paginate';
import { useState } from 'react';
import { THROUGHLINES, appendDraft, assignStorybeats, pointId, pointsOf, sceneFromStorybeats, sceneOf, scenesOfPoint, storybeatTag, throughlinesOf, togglePoint, unassignStorybeat, unassigned } from './dramatica';
import { THROUGHLINE_COLOR } from './colors';
import type { StoryBeat, Throughline } from './model';
import { layout, pinSlot, structureOf } from './structures';

const SEVERITY_LABEL = { error: 'Chyba', warn: 'Varování', tip: 'Tip' } as const;

export function Inspector({ s, issues }: { s: State; issues: Issue[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const tabs: [Tab, string][] = [
    ['detail', 'Detail'],
    ['cast', 'Obsazení'],
    ['issues', `Problémy${issues.length ? ` (${issues.length})` : ''}`],
  ];
  const sf = s.project.storyform;
  if (sf?.beats.length) tabs.push(['beats', `Storybeaty${unassigned(s.project).length ? ` (${unassigned(s.project).length})` : ''}`]);
  if (sf && sf.points.length + sf.dynamics.length > 0) tabs.push(['storyform', 'Storyform']);
  const tab = tabs.some(([id]) => id === s.tab) ? s.tab : 'detail';
  return (
    <aside className="inspector">
      <nav className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={`${tab === id ? 'on' : ''}${id === 'issues' && errors ? ' has-error' : ''}`} onClick={() => ui({ tab: id })}>
            {label}
          </button>
        ))}
      </nav>
      <div className="insp-body">
        {tab === 'detail' && <Detail s={s} issues={issues} />}
        {tab === 'cast' && <Cast s={s} />}
        {tab === 'issues' && <Issues s={s} issues={issues} />}
        {tab === 'storyform' && <StoryformPanel s={s} />}
        {tab === 'beats' && <StorybeatTray s={s} />}
      </div>
    </aside>
  );
}

/** Mime typ pro tažení storybeatů ze zásobníku na scénu. */
export const STORYBEAT_MIME = 'application/x-fabula-storybeats';

const Chip = ({ sb }: { sb: StoryBeat }) => (
  <span className="card-tl" style={{ background: THROUGHLINE_COLOR[sb.throughline] }}>
    {storybeatTag(sb)}
  </span>
);

/** Připíše rozepsaný text na konec scény jako odstavce scénáře; původní text zůstává a krok jde vrátit. */
function DraftButton({ id, text }: { id: ID; text: string }) {
  return (
    <button
      className="draft-btn"
      title="Text se rozdělí na hlavičky, akci a repliky a připíše se na konec scény. Původní text tu zůstane; krok vrátíš přes Zpět."
      onClick={() => {
        let n = 0;
        actions.editScript((draft) => void (n = appendDraft(draft, id, text)));
        if (!n) alert('V textu jsem nenašel nic, co by šlo převést.');
      }}
    >
      Převést do scénáře
    </button>
  );
}

/** Storybeaty, které scéna nese: jejich znění, úprava Storytellingu, vyjmutí a přidání dalšího. */
function SceneStorybeats({ s, id }: { s: State; id: ID }) {
  const p = s.project;
  const b = p.beats[id];
  const mine = (b.storybeats ?? []).map((k) => p.storyform!.beats.find((x) => x.key === k)).filter((x): x is StoryBeat => !!x);
  const free = unassigned(p);
  const setText = (key: string, value: string) =>
    actions.editScript((draft) => {
      const sb = draft.storyform?.beats.find((x) => x.key === key);
      if (sb) sb.storytelling = value;
    }, `storytelling:${key}`);
  return (
    <div className="scene-beats">
      <div className="insp-kicker">Storybeaty scény</div>
      {mine.length === 0 && <p className="muted small">Scéna zatím nenese žádný storybeat. Přetáhni ho sem ze záložky Storybeaty, nebo ho vyber níže.</p>}
      {mine.map((sb) => (
        <div className="scene-beat" key={sb.key}>
          <div className="scene-beat-head">
            <Chip sb={sb} />
            <b>{sb.fn}</b>
            <button className="x" title="Vyjmout storybeat ze scény" onClick={() => actions.editScript((draft) => unassignStorybeat(draft, sb.key))}>
              ×
            </button>
          </div>
          {sb.summary && <p>{sb.summary}</p>}
          <textarea rows={4} value={sb.storytelling} placeholder="Storytelling: jak se storybeat ve scéně odehraje" onChange={(e) => setText(sb.key, e.target.value)} />
          {sb.storytelling.trim() && <DraftButton id={id} text={sb.storytelling} />}
        </div>
      ))}
      {pointsOf(p, b).length > 0 && (
        <>
          <div className="insp-kicker">Storypointy scény</div>
          {pointsOf(p, b).map((x) => (
            <div className="scene-beat" key={pointId(x)}>
              <div className="scene-beat-head">
                <b>
                  {x.throughline && `${x.throughline} `}
                  {x.name}
                </b>
                <span className="muted">{x.fn}</span>
                <button className="x" title="Odepnout storypoint od scény" onClick={() => actions.editScript((draft) => togglePoint(draft, id, pointId(x)))}>
                  ×
                </button>
              </div>
              {x.summary && <p>{x.summary}</p>}
            </div>
          ))}
        </>
      )}
      {free.length > 0 && (
        <select value="" onChange={(e) => e.target.value && actions.editScript((draft) => assignStorybeats(draft, id, [e.target.value]))}>
          <option value="">+ Přidat storybeat…</option>
          {THROUGHLINES.map((t) => (
            <optgroup key={t.key} label={t.name}>
              {free
                .filter((x) => x.throughline === t.key)
                .map((x) => (
                  <option key={x.key} value={x.key}>
                    {storybeatTag(x)} · {x.fn}
                    {x.summary ? ` – ${x.summary.slice(0, 60)}` : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * Zásobník storybeatů: strom po throughlines (Signpost › Progrese › Událost). Nepřiřazené se dají přetáhnout
 * na scénu na tabuli, nebo jich víc zaškrtnout a přiřadit najednou vybrané scéně.
 */
function StorybeatTray({ s }: { s: State }) {
  const p = s.project;
  const [tl, setTl] = useState<Throughline | ''>('');
  const [all, setAll] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const free = new Set(unassigned(p).map((x) => x.key));
  const list = p.storyform!.beats.filter((x) => (!tl || x.throughline === tl) && (all || free.has(x.key)));
  const picked = checked.filter((k) => free.has(k) || all);
  const scene = s.selected ? p.beats[s.selected] : null;
  const toggle = (k: string) => setChecked((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const done = () => setChecked([]);
  return (
    <div className="tray">
      <div className="tray-filter">
        <span className="seg">
          <button className={tl === '' ? 'on' : ''} onClick={() => setTl('')}>
            Vše
          </button>
          {THROUGHLINES.map((t) => (
            <button key={t.key} className={tl === t.key ? 'on' : ''} onClick={() => setTl(t.key)} title={t.name}>
              {t.key}
            </button>
          ))}
        </span>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> i přiřazené
        </label>
      </div>
      <p className="muted small">
        {free.size} z {p.storyform!.beats.length} storybeatů není v žádné scéně. Přetáhni je na kartu na tabuli, nebo jich víc zaškrtni.
      </p>
      {picked.length > 0 && (
        <div className="tray-actions">
          <button className="primary" disabled={!scene} onClick={() => (actions.editScript((draft) => assignStorybeats(draft, scene!.id, picked)), done())}>
            {scene ? `Přiřadit ${picked.length} ke scéně „${scene.title || 'Bez názvu'}“` : 'Vyber scénu na tabuli'}
          </button>
          <button
            onClick={() => {
              let made: ID | null = null;
              actions.editScript((draft) => void (made = sceneFromStorybeats(draft, picked, s.selected)));
              if (made) ui({ selected: made });
              done();
            }}
          >
            Nová scéna z vybraných
          </button>
        </div>
      )}
      {list.length === 0 && <p className="muted">Všechny storybeaty jsou zařazené do scén.</p>}
      {list.map((sb, i) => {
        const at = sceneOf(p, sb.key);
        const head = i === 0 || list[i - 1].throughline !== sb.throughline;
        return (
          <div key={sb.key}>
            {head && !tl && <div className="tray-head">{THROUGHLINES.find((t) => t.key === sb.throughline)!.name}</div>}
            <div
              className={`tray-row ${sb.scope}${at ? ' placed' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(STORYBEAT_MIME, JSON.stringify(picked.includes(sb.key) ? picked : [sb.key]));
                e.dataTransfer.effectAllowed = 'link';
              }}
            >
              <input type="checkbox" checked={checked.includes(sb.key)} onChange={() => toggle(sb.key)} aria-label={`Vybrat ${storybeatTag(sb)}`} />
              <div>
                <Chip sb={sb} /> <b>{sb.fn}</b>
                {sb.summary && <p>{sb.summary}</p>}
                {at && (
                  <button className="linklike" onClick={() => ui({ selected: at.id, multi: [], tab: 'detail' })}>
                    → {at.title || 'Bez názvu'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Storyform z Dramatiky po ruce při psaní: dynamika, storypointy příběhu a čtyř throughlines. */
function StoryformPanel({ s }: { s: State }) {
  const p = s.project;
  const sf = p.storyform!;
  const b = s.selected ? p.beats[s.selected] : null;
  const current = b ? (throughlinesOf(p, b)[0] ?? null) : null;
  const [open, setOpen] = useState(false);
  const pinnedAll = new Set(Object.values(p.beats).flatMap((x) => x.points ?? []));
  const shown = sf.points.filter((x) => !open || !pinnedAll.has(pointId(x)));
  const point = (x: (typeof sf.points)[number], i: number) => {
    const pid = pointId(x);
    const scenes = scenesOfPoint(p, pid);
    const here = !!b?.points?.includes(pid);
    return (
      <div className={`sf-point${here ? ' here' : ''}`} key={i}>
        <b>{x.name}</b>
        {x.fn && <span>{x.fn}</span>}
        <span className="sf-pin">
          {scenes.length > 0 && (
            <button className="linklike" title={scenes.map((sc) => sc.title || 'Bez názvu').join('\n')} onClick={() => ui({ selected: scenes[(scenes.findIndex((sc) => sc.id === s.selected) + 1) % scenes.length].id, multi: [] })}>
              {scenes.length === 1 ? 'v 1 scéně' : `ve ${scenes.length} scénách`}
            </button>
          )}
          {b && (
            <button className={here ? 'pressed' : ''} title={here ? 'Odepnout od vybrané scény' : `Připnout ke scéně „${b.title || 'Bez názvu'}“: scéna tento storypoint ukazuje`} onClick={() => actions.editScript((draft) => togglePoint(draft, b.id, pid))}>
              {here ? 'Připnuto' : 'Připnout'}
            </button>
          )}
        </span>
        {x.summary && <p>{x.summary}</p>}
        {x.text && x.text !== x.summary && (
          <details>
            <summary>Storytelling</summary>
            <p>{x.text}</p>
          </details>
        )}
      </div>
    );
  };
  const story = shown.filter((x) => !x.throughline);
  return (
    <div className="storyform">
      {sf.dynamics.length > 0 && (
        <div className="sf-dynamics">
          {sf.dynamics.map((d) => (
            <span key={d.name} title={d.summary || undefined}>
              {d.name}: <b>{d.value}</b>
            </span>
          ))}
        </div>
      )}
      {sf.points.length > 0 && (
        <label className="check sf-open">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> jen storypointy, které zatím žádná scéna neukazuje ({sf.points.filter((x) => !pinnedAll.has(pointId(x))).length} z {sf.points.length})
        </label>
      )}
      {story.length > 0 && (
        <details open={!current}>
          <summary>Příběh</summary>
          {story.map(point)}
        </details>
      )}
      {THROUGHLINES.map((t) => {
        const list = shown.filter((x) => x.throughline === t.key);
        return (
          list.length > 0 && (
            // Klíč podle vybraného beatu: po změně výběru se rozbalí throughline, ke které beat patří.
            <details key={`${t.key}${current === t.key}`} open={current === t.key} className={current === t.key ? 'current' : ''} style={{ ['--lane' as string]: t.color }}>
              <summary>{t.name}</summary>
              {list.map(point)}
            </details>
          )
        );
      })}
    </div>
  );
}

function Detail({ s, issues }: { s: State; issues: Issue[] }) {
  const p = s.project;
  const id = s.selected;
  if (id && p.breaks[id]) {
    return (
      <>
        <label>
          Název předělu
          <input value={p.breaks[id].title} onChange={(e) => actions.updateBreak(id, e.target.value)} />
        </label>
        <button className="danger" onClick={() => actions.deleteItem(id)}>
          Smazat předěl
        </button>
      </>
    );
  }
  if (s.multi.length > 1) return <Bulk s={s} />;
  const b = id ? p.beats[id] : null;
  if (!id || !b) {
    return (
      <p className="muted">
        Vyber beat na tabuli, ve scénáři nebo na časové ose. Nový vytvoříš dvojklikem do linie na tabuli nebo tlačítkem „+ Beat“.
      </p>
    );
  }
  const causes = p.links.filter((l) => l.to === id);
  const effects = p.links.filter((l) => l.from === id);
  const mine = issues.filter((i) => i.beatIds.includes(id));
  const pos = (x: ID) => p.order.indexOf(x);
  const detected = detectedCharacters(p, b);
  const pg = paginate(p);
  const place = pg.beat.get(id);
  const group = p.groups.find((g) => g.id === b.groupId) ?? null;

  const linkRow = (l: Link, other: ID, inverted: boolean) => (
    <li key={l.id} className={inverted ? 'bad' : ''}>
      <div className="link-row">
        <button className="linklike" onClick={() => ui({ selected: other })}>
          {beatNumber(p, other)}. {beatName(p, other)}
        </button>
        {inverted && <span className="tag-bad">obrácené pořadí</span>}
        <button className="x" title="Odebrat vazbu" onClick={() => actions.removeLink(l.id)}>
          ×
        </button>
      </div>
      <input className="link-note-input" value={l.note} placeholder="protože…" onChange={(e) => actions.updateLink(l.id, e.target.value)} />
    </li>
  );

  return (
    <>
      <div className="insp-kicker">
        Beat {beatNumber(p, id)}
        {place && (
          <>
            {' '}
            · délka {eighths(place.lines, pg.perPage)} str. · strana {pageRange(place)}
          </>
        )}
      </div>
      <label>
        Název
        <input value={b.title} placeholder="Co se stane" onChange={(e) => actions.updateBeat(id, { title: e.target.value }, 'title')} />
      </label>
      <label>
        Synopse
        <textarea rows={3} value={b.synopsis} onChange={(e) => actions.updateBeat(id, { synopsis: e.target.value }, 'synopsis')} />
      </label>
      {b.source && (
        <label>
          Dramatica · {b.source.kind === 'moment' ? 'Moment' : 'Story Driver'}
          <textarea
            rows={b.source.kind === 'moment' ? 3 : 6}
            value={b.source.text}
            placeholder={b.source.kind === 'moment' ? 'Místo, čas a pokyny ke scéně' : 'Storytelling: jak se zlom v příběhu odehraje'}
            onChange={(e) => actions.updateBeat(id, { source: { ...b.source!, text: e.target.value } }, 'source')}
          />
          {b.source.kind === 'driver' && b.source.text.trim() && <DraftButton id={id} text={b.source.text} />}
        </label>
      )}
      {(p.structures ?? []).map((sid) => {
        const st = structureOf(sid);
        const here = st && layout(p, st).find((x) => x.scenes.includes(id))?.slot;
        if (!st) return null;
        return (
          <div className="scene-slot" key={sid}>
            <div className="insp-kicker">
              {st.name}
              {here && ` · ${here.name}`}
            </div>
            {here && <p>{here.ask}</p>}
            <select value={b.pins?.[sid] ?? ''} title="Posune hranici kroku: krok začne touto scénou" onChange={(e) => actions.editScript((draft) => pinSlot(draft, id, sid, e.target.value || null))}>
              <option value="">Krok podle rozložení</option>
              {st.slots.map((x) => (
                <option key={x.id} value={x.id}>
                  Touto scénou začíná: {x.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {(p.storyform?.beats.length ?? 0) > 0 && <SceneStorybeats s={s} id={id} />}
      <div className="row">
        <label>
          Linie
          <select value={b.laneId} onChange={(e) => actions.updateBeat(id, { laneId: e.target.value })}>
            {p.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || 'Bez názvu'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stav
          <select value={b.status} onChange={(e) => actions.updateBeat(id, { status: e.target.value as BeatStatus })}>
            {(Object.keys(STATUS_LABEL) as BeatStatus[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Blok nebo skupina
        <select
          value={b.groupId ?? ''}
          onChange={(e) => (e.target.value === '+' ? actions.addGroup(id) : actions.updateBeat(id, { groupId: e.target.value || null }))}
        >
          <option value="">— žádná —</option>
          {p.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {groupLabel(p, g)}
            </option>
          ))}
          <option value="+">+ Nová skupina…</option>
        </select>
      </label>
      {group && (
        <div className="row">
          <label>
            Název
            <input value={group.title} onChange={(e) => actions.updateGroup(group.id, { title: e.target.value })} />
          </label>
          <label title="Blok sdružuje několik skupin: blok → skupina → beat">
            Nadřazený blok
            <select
              value={group.parentId ?? ''}
              disabled={p.groups.some((g) => g.parentId === group.id)}
              onChange={(e) => (e.target.value === '+' ? actions.addBlockFor(group.id) : actions.updateGroup(group.id, { parentId: e.target.value || null }))}
            >
              <option value="">— žádný —</option>
              {p.groups
                .filter((g) => g.id !== group.id && !g.parentId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title || 'Bez názvu'}
                  </option>
                ))}
              <option value="+">+ Nový blok…</option>
            </select>
          </label>
        </div>
      )}
      <label className="check-row" title="Na tabuli se beat zařadí do stejného sloupce jako předchozí. Totéž udělá přetažení karty s klávesou Alt.">
        <input type="checkbox" checked={b.concurrent} disabled={p.order.indexOf(id) === 0} onChange={(e) => actions.updateBeat(id, { concurrent: e.target.checked })} />
        Děje se souběžně s předchozím beatem
      </label>
      <label className="check-row" title="Beat zůstane na tabuli, ale nepočítá se do scénáře, exportů ani statistik.">
        <input type="checkbox" checked={b.off} onChange={(e) => actions.updateBeat(id, { off: e.target.checked })} />
        Vyřadit ze scénáře
      </label>
      <label>
        Napětí: {b.tension}/10
        <input type="range" min={0} max={10} value={b.tension} onChange={(e) => actions.updateBeat(id, { tension: +e.target.value }, 'tension')} />
      </label>

      <h4>Verze textu</h4>
      <ul className="links-list">
        <li>
          <div className="link-row">
            <input
              className="version-name"
              value={b.versionName}
              placeholder="Současná verze (pojmenuj ji)"
              onChange={(e) => actions.updateBeat(id, { versionName: e.target.value }, 'vername')}
            />
            <span className="tag-now">aktivní</span>
          </div>
        </li>
        {b.versions.map((v) => (
          <li key={v.id}>
            <div className="link-row">
              <span className="grow">{v.name || 'Bez názvu'}</span>
              <button onClick={() => actions.switchVersion(id, v.id)} title="Přepnout scénář na tuto verzi; současná se odloží">
                Použít
              </button>
              <button className="x" title="Smazat verzi" onClick={() => confirm(`Smazat verzi „${v.name}“?`) && actions.deleteVersion(id, v.id)}>
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        title="Současný text se odloží jako verze a ty pokračuješ v jeho kopii"
        onClick={() => {
          const name = prompt('Název nové verze (např. „Přepis po poznámkách“)', `Verze ${b.versions.length + 2}`);
          if (name !== null) actions.saveVersion(id, name.trim() || `Verze ${b.versions.length + 2}`);
        }}
      >
        + Nová verze textu
      </button>

      <h4>Postavy</h4>
      {p.characters.length === 0 && <p className="muted">Postavy přidáš v záložce „Obsazení“, nebo je stačí nechat mluvit ve scénáři.</p>}
      <div className="chips">
        {p.characters.map((c) => {
          const manual = b.characterIds.includes(c.id);
          const auto = detected.has(c.id);
          return (
            <button
              key={c.id}
              className={`chip${manual ? ' on' : auto ? ' auto' : ''}`}
              style={manual ? { background: c.color, borderColor: c.color } : auto ? { borderColor: c.color, color: c.color } : undefined}
              title={manual ? 'Přiřazeno ručně' : auto ? 'Rozpoznáno z textu' : 'Kliknutím přiřadíš'}
              onClick={() => actions.toggleCharacter(id, c.id)}
            >
              {c.name || 'Bez jména'}
            </button>
          );
        })}
      </div>
      {[...detected].some((c) => !b.characterIds.includes(c)) && <p className="muted small">Čárkovaný okraj: rozpoznáno z textu scény nebo synopse.</p>}

      {p.tags.length > 0 && (
        <>
          <h4>Motivy</h4>
          <div className="chips">
            {p.tags.map((t) => {
              const on = b.tagIds.includes(t.id);
              return (
                <button key={t.id} className={`chip${on ? ' on' : ''}`} style={on ? { background: t.color, borderColor: t.color } : undefined} onClick={() => actions.toggleTag(id, t.id)}>
                  {t.name || 'Bez názvu'}
                </button>
              );
            })}
          </div>
          {p.tags
            .filter((t) => b.tagIds.includes(t.id) && t.mode !== 'none')
            .map((t) => (
              <label key={t.id} className="tag-level">
                {t.name || 'Bez názvu'}: {b.tagLevels[t.id] ?? 5}/10
                <input
                  type="range"
                  min={0}
                  max={10}
                  value={b.tagLevels[t.id] ?? 5}
                  style={{ accentColor: t.color }}
                  onChange={(e) => actions.setTagLevel(id, t.id, +e.target.value, 'taglevel')}
                />
              </label>
            ))}
        </>
      )}

      <h4>Příčiny</h4>
      {causes.length === 0 ? <p className="muted">Nic tento beat nezpůsobuje.</p> : <ul className="links-list">{causes.map((l) => linkRow(l, l.from, pos(l.from) > pos(id)))}</ul>}
      <h4>Následky</h4>
      {effects.length === 0 ? <p className="muted">Z tohoto beatu nic neplyne.</p> : <ul className="links-list">{effects.map((l) => linkRow(l, l.to, pos(l.to) < pos(id)))}</ul>}
      <button onClick={() => ui({ linkFrom: id, view: 'board' })}>+ Přidat následek…</button>

      <h4>Rešerše</h4>
      <ul className="links-list">
        {p.research
          .filter((r) => r.beatIds.includes(id))
          .map((r) => (
            <li key={r.id}>
              <button className="linklike" onClick={() => ui({ view: 'research', research: r.id })}>
                {r.title.trim() || 'Bez názvu'}
              </button>
            </li>
          ))}
      </ul>
      <button onClick={() => (actions.addResearch('Podklady', { beatIds: [id] }), ui({ view: 'research' }))}>+ Nová poznámka k beatu</button>

      {mine.length > 0 && (
        <>
          <h4>Problémy tohoto beatu</h4>
          <ul className="issues">
            {mine.map((i) => (
              <li key={i.key} className={i.severity}>
                <b>{SEVERITY_LABEL[i.severity]}</b> {i.message}
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="danger" onClick={() => actions.deleteItem(id)}>
        Smazat beat
      </button>
    </>
  );
}

/** Hromadné úpravy více vybraných beatů. */
function Bulk({ s }: { s: State }) {
  const p = s.project;
  const ids = s.multi;
  const beats = ids.map((id) => p.beats[id]).filter(Boolean);
  const common = <K extends 'laneId' | 'status' | 'groupId'>(k: K) => (beats.every((b) => b[k] === beats[0][k]) ? beats[0][k] : undefined);
  return (
    <>
      <div className="insp-kicker">Vybráno {ids.length} beatů</div>
      <ul className="bulk-list">
        {p.order
          .filter((id) => ids.includes(id))
          .map((id) => (
            <li key={id}>
              {beatNumber(p, id)}. {beatName(p, id)}
            </li>
          ))}
      </ul>
      <div className="row">
        <label>
          Linie
          <select value={common('laneId') ?? ''} onChange={(e) => e.target.value && actions.updateBeats(ids, { laneId: e.target.value })}>
            <option value="">— různé —</option>
            {p.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || 'Bez názvu'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stav
          <select value={common('status') ?? ''} onChange={(e) => e.target.value && actions.updateBeats(ids, { status: e.target.value as BeatStatus })}>
            <option value="">— různé —</option>
            {(Object.keys(STATUS_LABEL) as BeatStatus[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Blok nebo skupina
        <select
          value={common('groupId') === undefined ? '?' : (common('groupId') ?? '')}
          onChange={(e) => (e.target.value === '+' ? actions.groupBeats(ids) : e.target.value !== '?' && actions.updateBeats(ids, { groupId: e.target.value || null }))}
        >
          <option value="?">— různé —</option>
          <option value="">žádná</option>
          {p.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {groupLabel(p, g)}
            </option>
          ))}
          <option value="+">+ Nová skupina z výběru</option>
        </select>
      </label>
      {p.tags.length > 0 && (
        <>
          <h4>Motivy</h4>
          <div className="chips">
            {p.tags.map((t) => {
              const all = beats.every((b) => b.tagIds.includes(t.id));
              const some = beats.some((b) => b.tagIds.includes(t.id));
              return (
                <button
                  key={t.id}
                  className={`chip${all ? ' on' : some ? ' auto' : ''}`}
                  style={all ? { background: t.color, borderColor: t.color } : some ? { borderColor: t.color, color: t.color } : undefined}
                  title={all ? 'Mají všechny – kliknutím odebereš' : 'Kliknutím přidáš všem'}
                  onClick={() => actions.setTagOnBeats(ids, t.id, !all)}
                >
                  {t.name || 'Bez názvu'}
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className="muted small">Esc výběr zruší. Tažením jedné z vybraných karet přesuneš všechny.</p>
      <button className="danger" onClick={() => confirm(`Smazat ${ids.length} beatů včetně jejich vazeb?`) && actions.deleteItems(ids)}>
        Smazat vybrané
      </button>
    </>
  );
}

function Cast({ s }: { s: State }) {
  const p = s.project;
  const beats = Object.values(p.beats);
  const unknown = unknownSpeakers(p);
  const detected = beats.map((b) => [b, detectedCharacters(p, b)] as const);
  return (
    <>
      <h4>Postavy</h4>
      <ul className="edit-list">
        {p.characters.map((c) => (
          <li key={c.id} className="two-line">
            <div>
              <input type="color" value={c.color} onChange={(e) => actions.updateCharacter(c.id, { color: e.target.value })} title="Barva" />
              <input value={c.name} placeholder="Jméno" onChange={(e) => actions.updateCharacter(c.id, { name: e.target.value })} />
              <small title="Počet beatů, ve kterých vystupuje">{detected.filter(([b, d]) => d.has(c.id) || b.characterIds.includes(c.id)).length}×</small>
              <button className="x" title="Smazat postavu" onClick={() => actions.deleteCharacter(c.id)}>
                ×
              </button>
            </div>
            <div className="sub">
              <select value={c.role} title="Skupina na časové ose" onChange={(e) => actions.updateCharacter(c.id, { role: e.target.value as CharRole })}>
                <option value="main">hlavní</option>
                <option value="secondary">vedlejší</option>
                <option value="small">malá role</option>
              </select>
              <input value={c.aliases} placeholder="další slova pro rozpoznání (čárkami)" onChange={(e) => actions.updateCharacter(c.id, { aliases: e.target.value })} />
            </div>
            <label className="check-row hl" title="Podbarví repliky této postavy ve scénáři">
              <input
                type="checkbox"
                checked={s.highlight.includes(c.id)}
                onChange={() => ui({ highlight: s.highlight.includes(c.id) ? s.highlight.filter((x) => x !== c.id) : [...s.highlight, c.id] })}
              />
              zvýraznit repliky ve scénáři
            </label>
          </li>
        ))}
      </ul>
      <button onClick={() => actions.addCharacter()}>+ Postava</button>
      {unknown.length > 0 && (
        <p className="notice">
          Ve scénáři mluví i {unknown.join(', ')}. <button onClick={actions.addUnknownSpeakers}>Přidat mezi postavy</button>
        </p>
      )}

      <h4>Motivy</h4>
      <p className="muted small">Mini-zápletky, nebezpečí, rysy postav, cíle, témata… Každý motiv má na časové ose vlastní stopu.</p>
      {tagCategories(p).map((cat) => {
        const tags = p.tags.filter((t) => t.category === cat);
        const preset = TAG_CATEGORIES.find(([n]) => n === cat);
        if (!tags.length && !preset) return null;
        return (
          <div key={cat} className="tag-cat">
            <h5>
              {cat}
              <button title={`Nový motiv v kategorii ${cat}`} onClick={() => actions.addTag(cat, preset?.[1] ?? 'change')}>
                +
              </button>
            </h5>
            <ul className="edit-list">
              {tags.map((t) => (
                <li key={t.id} className="two-line">
                  <div>
                    <input type="color" value={t.color} onChange={(e) => actions.updateTag(t.id, { color: e.target.value })} title="Barva" />
                    <input value={t.name} placeholder="Název motivu" onChange={(e) => actions.updateTag(t.id, { name: e.target.value })} />
                    <small>{beats.filter((b) => b.tagIds.includes(t.id)).length}×</small>
                    <button className="x" title="Smazat motiv" onClick={() => actions.deleteTag(t.id)}>
                      ×
                    </button>
                  </div>
                  <div className="sub">
                    <select
                      value={t.category}
                      title="Kategorie"
                      onChange={(e) => {
                        const name = e.target.value === '+' ? prompt('Název nové kategorie')?.trim() : e.target.value;
                        if (name) actions.updateTag(t.id, { category: name });
                      }}
                    >
                      {tagCategories(p).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="+">+ Nová kategorie…</option>
                    </select>
                    <select value={t.mode} title="Jak motiv vytváří napětí" onChange={(e) => actions.updateTag(t.id, { mode: e.target.value as TagMode })}>
                      {(Object.keys(TAG_MODE_LABEL) as TagMode[]).map((m) => (
                        <option key={m} value={m}>
                          {TAG_MODE_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <h4>Dějové linie</h4>
      <ul className="edit-list">
        {p.lanes.map((l, i) => (
          <li key={l.id}>
            <input type="color" value={l.color} onChange={(e) => actions.updateLane(l.id, { color: e.target.value })} title="Barva" />
            <input value={l.name} placeholder="Název linie" onChange={(e) => actions.updateLane(l.id, { name: e.target.value })} />
            <small>{beats.filter((b) => b.laneId === l.id).length}×</small>
            <button className="x" title="Posunout řádek nahoru" disabled={i === 0} onClick={() => actions.moveLane(l.id, -1)}>
              ↑
            </button>
            <button className="x" title="Posunout řádek dolů" disabled={i === p.lanes.length - 1} onClick={() => actions.moveLane(l.id, 1)}>
              ↓
            </button>
            <button
              className="x"
              title={p.lanes.length < 2 ? 'Poslední linii nelze smazat' : 'Smazat linii (beaty se přesunou do první linie)'}
              disabled={p.lanes.length < 2}
              onClick={() => actions.deleteLane(l.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button onClick={actions.addLane}>+ Linie</button>

      {p.groups.length > 0 && (
        <>
          <h4>Bloky a skupiny</h4>
          <ul className="edit-list">
            {p.groups.map((g) => (
              <li key={g.id}>
                <input type="color" value={g.color} onChange={(e) => actions.updateGroup(g.id, { color: e.target.value })} title="Barva" />
                <input value={g.title} placeholder={g.parentId ? 'Název skupiny' : 'Název'} onChange={(e) => actions.updateGroup(g.id, { title: e.target.value })} />
                <small title={g.parentId ? 'Skupina v bloku' : 'Počet beatů včetně vnořených skupin'}>{groupBeats(p, g.id).length}×</small>
                <button className="x" title="Zrušit (beaty zůstanou)" onClick={() => actions.deleteGroup(g.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Beat zařadíš do skupiny v záložce Detail; tam také skupinu vnoříš do bloku.</p>
        </>
      )}
    </>
  );
}

function Issues({ s, issues }: { s: State; issues: Issue[] }) {
  if (issues.length === 0) return <p className="muted">Žádné problémy. Každý následek přichází až po své příčině.</p>;
  return (
    <ul className="issues">
      {issues.map((i) => (
        <li key={i.key} className={i.severity}>
          <button className="issue" disabled={!i.beatIds.length} onClick={() => ui({ selected: i.beatIds[0], view: s.view })}>
            <b>{SEVERITY_LABEL[i.severity]}</b> {i.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
