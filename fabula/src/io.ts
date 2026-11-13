import type { Beat, Break, CharRole, ID, Para, ParaType, Project } from './model';
import { derivedTension } from './tension';
import { parseFountain, toFountain, titleCase, speaker } from './text';

const id = () => crypto.randomUUID();
const COLORS = ['#c2410c', '#0f766e', '#6d28d9', '#b45309', '#1d4ed8', '#be185d', '#4d7c0f', '#475569'];

function blank(title: string): Project {
  return {
    format: 2,
    id: id(),
    title,
    lanes: [{ id: id(), name: 'Hlavní děj', color: COLORS[0] }],
    characters: [],
    tags: [],
    groups: [],
    beats: {},
    breaks: {},
    order: [],
    links: [],
    notes: [],
    research: [],
    titlePage: { author: '', basedOn: '', draft: '', contact: '' },
    revisions: [],
    targetPages: 110,
  };
}

function beat(laneId: ID, patch: Partial<Beat>): Beat {
  return {
    id: id(),
    title: '',
    synopsis: '',
    paras: [],
    laneId,
    characterIds: [],
    tagIds: [],
    tagLevels: {},
    groupId: null,
    concurrent: false,
    off: false,
    versionName: '',
    versions: [],
    tension: 5,
    status: 'idea',
    ...patch,
  };
}

/** Ověří a doplní projekt načtený z úložiště nebo souboru; starší formát převede. Vrací null, když to projekt není. */
export function normalize(x: unknown): Project | null {
  const p = x as any;
  if (!p || (p.format !== 1 && p.format !== 2)) return null;
  if (!Array.isArray(p.lanes) || !p.lanes.length || !Array.isArray(p.order) || !Array.isArray(p.links)) return null;
  if (typeof p.beats !== 'object' || typeof p.breaks !== 'object') return null;
  if (!p.order.every((i: ID) => p.beats[i] || p.breaks[i])) return null;
  p.format = 2;
  p.characters = (p.characters ?? []).map((c: any) => ({ aliases: '', role: 'main', ...c }));
  p.tags = (p.tags ?? []).map((t: any) => ({ mode: 'change', category: 'Obecné', ...t }));
  p.groups = (p.groups ?? []).map((g: any) => ({ collapsed: false, parentId: null, ...g }));
  p.notes ??= [];
  p.revisions ??= [];
  p.targetPages ??= 110;
  p.titlePage = { author: '', basedOn: '', draft: '', contact: '', ...(p.titlePage ?? {}) };
  p.research ??= [];
  p.links = p.links.map((l: any) => ({ note: '', ...l }));
  for (const b of Object.values<any>(p.beats)) {
    if (!Array.isArray(b.paras)) b.paras = parseFountain(String(b.script ?? ''));
    delete b.script;
    if (!b.paras.length) b.paras = [{ id: id(), type: 'action', text: '' }];
    b.tagIds ??= [];
    b.tagLevels ??= {};
    b.groupId ??= null;
    b.concurrent ??= false;
    b.off ??= false;
    b.versionName ??= '';
    b.versions ??= [];
    b.characterIds ??= [];
  }
  return p as Project;
}

/** Scénář ve formátu Fountain: každá scéna se stane jedním beatem. */
export function importFountain(text: string, fileName: string): Project {
  const p = blank(fileName.replace(/\.[^.]+$/, ''));
  const body = text.replace(/\r/g, '');
  // Titulní stránka: úvodní řádky „Klíč: hodnota“ oddělené prázdným řádkem.
  const head = body.match(/^((?:[A-Za-z ]+:.*\n(?:[ \t]+.*\n)*)+)\n/);
  const title = head?.[1].match(/^Title:\s*(.+)$/im)?.[1];
  if (title) p.title = title.replace(/[_*]/g, '').trim();
  const paras = parseFountain(head ? body.slice(head[0].length) : body);

  parasToBeats(p, paras);
  addSpeakers(p);
  return p;
}

const sceneTitle = (heading: string) => titleCase(heading.replace(/^(INT|EXT)[^\s]*\s*/i, '').replace(/\s[–-]\s\S+$/, ''));

/** Rozdělí souvislý scénář na beaty: každá hlavička scény začíná nový. */
function parasToBeats(p: Project, paras: Para[], meta?: Map<ID, { title?: string; synopsis?: string; isBreak?: boolean }>) {
  let current: Beat | null = null;
  for (const para of paras) {
    if (meta?.get(para.id)?.isBreak) {
      // Předěl dějství: ukončí rozepsaný beat.
      p.breaks[para.id] = { id: para.id, title: titleCase(para.text) };
      p.order.push(para.id);
      current = null;
      continue;
    }
    if (para.type === 'scene' || !current) {
      const m = meta?.get(para.id);
      current = beat(p.lanes[0].id, {
        title: m?.title?.trim() || (para.type === 'scene' ? sceneTitle(para.text) : 'Úvod'),
        synopsis: m?.synopsis ?? '',
      });
      p.beats[current.id] = current;
      p.order.push(current.id);
    }
    current.paras.push(para);
  }
}

function addSpeakers(p: Project) {
  const names = new Set<string>();
  for (const b of Object.values(p.beats)) for (const x of b.paras) if (x.type === 'character' && speaker(x.text)) names.add(speaker(x.text));
  [...names].forEach((n, i) => p.characters.push({ id: id(), name: titleCase(n), color: COLORS[(i + 2) % COLORS.length], aliases: '', role: 'main' }));
}

const decode = (s: string) => {
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
};

function htmlToParas(html: string): Para[] {
  const out: Para[] = [];
  for (const m of html.matchAll(/<p[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const cls = m[1].toLowerCase();
    const text = decode(m[2].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')).trim();
    if (!text) continue;
    const type: ParaType = cls.includes('scene')
      ? 'scene'
      : cls.includes('character')
        ? 'character'
        : cls.includes('parenth')
          ? 'paren'
          : cls.includes('dialog')
            ? 'dialogue'
            : cls.includes('transition')
              ? 'transition'
              : 'action';
    out.push({ id: id(), type, text });
  }
  return out;
}

const argb = (c: unknown, fallback: string) => (typeof c === 'string' && /^#[0-9a-f]{8}$/i.test(c) ? '#' + c.slice(3) : fallback);

const CAU_CATEGORY: Record<string, string> = {
  'mini-plots': 'Mini-zápletky',
  dangers: 'Nebezpečí',
  'character traits': 'Rysy postav',
  objectives: 'Cíle',
  abilities: 'Schopnosti',
  themes: 'Témata',
  general: 'Obecné',
  '': 'Obecné',
};
const CAU_ROLE: [RegExp, CharRole][] = [
  [/main/i, 'main'],
  [/secondary/i, 'secondary'],
  [/small/i, 'small'],
];

/**
 * Převod dokumentu Causality (.cau, JSON) na projekt.
 *
 * Přenáší: beaty s textem a hlavičkami scén, pořadí, bloky a skupiny, postavy včetně rolí a slov pro rozpoznání,
 * tagy s kategoriemi a průběhem emocí, předěly, závislosti, vyřazené beaty a titulní stranu.
 * Nepřenáší: plátno rešerší, lokace natáčení, nastavení tisku a styly odstavců.
 */
export function importCau(doc: any, fileName: string): Project {
  if (!doc?.objects?.beatObjects || !doc.objectLinks || !doc.orderLinks) throw new Error('Soubor nevypadá jako dokument Causality.');
  const o = doc.objects;
  const map = (key: string): Map<ID, ID> => new Map((doc.objectLinks[key] ?? []).map((l: any) => [l.id1, l.id2]));
  const inverse = (m: Map<ID, ID>) => new Map([...m].map(([a, b]) => [b, a]));
  const values = (key: string): any[] => Object.values(o[key] ?? {});

  const p = blank(fileName.replace(/\.[^.]+$/, ''));

  // ---------- Pořadí: spojový seznam časových dílků (id1 → id2) ----------
  const beatSlice = map('BeatObject.timeslice');
  const sliceBeat = inverse(beatSlice);
  const sliceBreak = new Map<ID, Break & { episode?: any }>();
  for (const kind of ['ActBreak', 'ChapterBreak', 'EpisodeBreak', 'SectionBreak']) {
    const store = o[kind[0].toLowerCase() + kind.slice(1) + 's'] ?? {};
    for (const [brk, slice] of map(`${kind}.timeslice`)) {
      if (store[brk]) sliceBreak.set(slice, { id: brk, title: store[brk].title ?? '', episode: kind === 'EpisodeBreak' ? store[brk] : undefined });
    }
  }
  const next = new Map<ID, ID>((doc.orderLinks.timeslices ?? []).map((l: any) => [l.id1, l.id2]));
  const targets = new Set(next.values());
  const sequence: ({ beat: ID } | { brk: Break & { episode?: any } })[] = [];
  let cur: ID | undefined = [...next.keys()].find((k) => !targets.has(k)) ?? Object.keys(o.timeslices ?? {})[0];
  const seen = new Set<ID>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (sliceBeat.has(cur)) sequence.push({ beat: sliceBeat.get(cur)! });
    else if (sliceBreak.has(cur)) sequence.push({ brk: sliceBreak.get(cur)! });
    cur = next.get(cur);
  }
  const beatOrder = sequence.flatMap((x) => ('beat' in x ? [x.beat] : []));
  const pos = new Map(beatOrder.map((b, i) => [b, i]));

  // ---------- Bloky a skupiny ----------
  const aliasBeat = map('BeatAlias.beatObject');
  const aliasBlock = map('BeatAlias.whiteboardBlock');
  const aliasGroup = map('BeatAlias.whiteboardGroup');
  const groupBlock = map('WhiteboardGroup.whiteboardBlock');
  const blockLane = map('WhiteboardBlock.whiteboardLane');
  const beatGroup = new Map<ID, ID>();
  const beatBlock = new Map<ID, ID>();
  for (const [alias, b] of aliasBeat) {
    const g = aliasGroup.get(alias);
    if (g) beatGroup.set(b, g);
    const blk = aliasBlock.get(alias) ?? (g ? groupBlock.get(g) : undefined);
    if (blk) beatBlock.set(b, blk);
  }
  const blocks: any[] = values('whiteboardBlocks');
  const blockBeats = (blk: ID) => beatOrder.filter((b) => beatBlock.get(b) === blk);
  const used = new Set(beatBlock.values());
  let gi = 0;
  for (const blk of blocks) {
    if (!used.has(blk.id)) continue;
    const members = blockBeats(blk.id);
    const hasGroups = values('whiteboardGroups').some((g) => groupBlock.get(g.id) === blk.id && [...beatGroup.values()].includes(g.id));
    // Blok s jediným beatem a bez skupin je jen obal karty – sekvenci z něj neděláme.
    if (members.length < 2 && !hasGroups) continue;
    p.groups.push({ id: blk.id, title: blk.name ?? '', color: blk.hasBaseColor ? argb(blk.baseColor, COLORS[gi % COLORS.length]) : COLORS[gi % COLORS.length], collapsed: false, parentId: null });
    gi++;
  }
  const isBlock = new Set(p.groups.map((g) => g.id));
  for (const g of values('whiteboardGroups')) {
    if (![...beatGroup.values()].includes(g.id)) continue;
    const parent = groupBlock.get(g.id);
    p.groups.push({ id: g.id, title: g.name ?? '', color: COLORS[gi++ % COLORS.length], collapsed: false, parentId: parent && isBlock.has(parent) ? parent : null });
  }

  // ---------- Linie ----------
  const lanes: any[] = values('whiteboardLanes').sort((a, b) => (a.indexHint ?? 0) - (b.indexHint ?? 0));
  const laneOfBlock = new Map<ID, ID>();
  if (lanes.length > 1) {
    p.lanes = lanes.map((l, i) => ({ id: l.id, name: l.name ?? '', color: l.hasBaseColor ? argb(l.baseColor, COLORS[i % COLORS.length]) : COLORS[i % COLORS.length] }));
    for (const blk of blocks) laneOfBlock.set(blk.id, blockLane.get(blk.id) ?? p.lanes[0].id);
  } else {
    // Jediná linie, ve které se bloky překrývají v čase: rozložíme je do řad tak, aby se souběžné bloky nepotkaly.
    const ranges = blocks
      .map((blk) => ({ id: blk.id as ID, y: blk.localYHint ?? 0, idx: blockBeats(blk.id).map((b) => pos.get(b)!) }))
      .filter((r) => r.idx.length)
      .map((r) => ({ ...r, from: Math.min(...r.idx), to: Math.max(...r.idx) }))
      .sort((a, b) => a.y - b.y);
    const rows: { from: number; to: number }[][] = [];
    for (const r of ranges) {
      let row = rows.findIndex((taken) => taken.every((t) => r.to < t.from || r.from > t.to));
      if (row < 0) row = rows.push([]) - 1;
      rows[row].push(r);
      laneOfBlock.set(r.id, String(row));
    }
    const base = lanes[0]?.name || 'Hlavní děj';
    p.lanes = (rows.length ? rows : [[]]).map((_, i) => ({ id: id(), name: rows.length > 1 ? `${base} ${i + 1}` : base, color: COLORS[i % COLORS.length] }));
    for (const [blk, row] of laneOfBlock) laneOfBlock.set(blk, p.lanes[Number(row)].id);
  }

  // ---------- Postavy ----------
  const parentOf = map('ResearchObject.parentObject');
  const charResearch = map('Character.researchObject');
  const roleOf = (charId: ID): CharRole => {
    let node = charResearch.get(charId);
    for (let i = 0; node && i < 6; i++, node = parentOf.get(node)) {
      const title = o.researchObjects?.[node]?.title ?? '';
      const hit = CAU_ROLE.find(([re]) => re.test(title));
      if (hit) return hit[1];
    }
    return 'main';
  };
  p.characters = values('characters').map((c, i) => ({
    id: c.id,
    name: c.name ?? '',
    color: argb(c.color, COLORS[i % COLORS.length]),
    aliases: (c.detectionWords ?? []).filter((w: string) => w && w.toLowerCase() !== String(c.name ?? '').toLowerCase()).join(', '),
    role: roleOf(c.id),
  }));
  const usageBeat = map('BeatCharacterUsage.beatObject');
  const usageChar = map('BeatCharacterUsage.character');
  const beatChars = new Map<ID, ID[]>();
  for (const [u, b] of usageBeat) if (usageChar.has(u)) beatChars.set(b, [...(beatChars.get(b) ?? []), usageChar.get(u)!]);

  // ---------- Tagy ----------
  const tagCategory = map('BeatTag.category');
  const categories: any[] = values('beatTagCategories').sort((a, b) => (a.indexHint ?? 0) - (b.indexHint ?? 0));
  const catName = (tagId: ID) => {
    const title = String(o.beatTagCategories?.[tagCategory.get(tagId) ?? '']?.title ?? '').trim();
    return CAU_CATEGORY[title.toLowerCase()] ?? title;
  };
  p.tags = values('beatTags')
    .sort((a, b) => categories.findIndex((c) => c.id === tagCategory.get(a.id)) - categories.findIndex((c) => c.id === tagCategory.get(b.id)))
    .map((t, i) => ({
      id: t.id,
      name: t.name ?? '',
      color: argb(t.color, COLORS[i % COLORS.length]),
      category: catName(t.id),
      // Sleduje-li tag emoci, má průběh; napětí „když je vysoko“ znamená, že roste s úrovní.
      mode: !t.trackEmotion ? 'none' : t.trackTension && (t.tensionWhenHigh ?? 0) > 0 ? 'rising' : 'change',
    }));
  const tagUsageBeat = map('BeatTagUsage.beatObject');
  const tagUsageTag = map('BeatTagUsage.beatTag');
  const usagesOf = new Map<ID, { beat: ID; u: any }[]>();
  for (const [u, b] of tagUsageBeat) {
    const t = tagUsageTag.get(u);
    if (t && o.beatTagUsages?.[u]) usagesOf.set(t, [...(usagesOf.get(t) ?? []), { beat: b, u: o.beatTagUsages[u] }]);
  }
  const beatTags = new Map<ID, { tag: ID; level: number }[]>();
  for (const [tag, list] of usagesOf) {
    // Hodnota emoce je buď absolutní (0–1), nebo změna oproti předchozímu výskytu.
    let level = 0;
    for (const { beat: b, u } of list.sort((x, y) => (pos.get(x.beat) ?? 1e9) - (pos.get(y.beat) ?? 1e9))) {
      level = Math.max(0, Math.min(1, u.emotionAbsolute ? (u.emotionValue ?? 0) : level + (u.emotionValue ?? 0)));
      beatTags.set(b, [...(beatTags.get(b) ?? []), { tag, level: Math.round(level * 10) }]);
    }
  }

  // ---------- Beaty ----------
  const beatSnippet = map('BeatObject.activeSnippet');
  const heading = (sn: any) => {
    const ie = String(sn.sceneIntExt ?? '').trim().replace(/\.$/, '');
    const time = String(sn.sceneTime ?? '').trim();
    return `${ie ? ie + '. ' : ''}${String(sn.sceneLocation).trim()}${time ? ` – ${time}` : ''}`;
  };
  const addBeat = (bid: ID, forceOff = false) => {
    const b = o.beatObjects[bid];
    const sn = o.snippets?.[beatSnippet.get(bid) ?? ''];
    const paras = sn ? htmlToParas(sn.content ?? '') : [];
    if (!b.name?.trim() && !b.synopsis?.trim() && !paras.length) return null; // prázdné zástupné beaty
    const blk = beatBlock.get(bid);
    const grp = beatGroup.get(bid);
    const tags = beatTags.get(bid) ?? [];
    p.beats[bid] = beat(laneOfBlock.get(blk ?? '') ?? p.lanes[0].id, {
      id: bid,
      title: b.name ?? '',
      synopsis: String(b.synopsis ?? '').trim(),
      paras,
      groupId: grp && p.groups.some((g) => g.id === grp) ? grp : blk && isBlock.has(blk) ? blk : null,
      characterIds: [...new Set(beatChars.get(bid) ?? [])],
      tagIds: tags.map((t) => t.tag),
      tagLevels: Object.fromEntries(tags.map((t) => [t.tag, t.level])),
      off: forceOff || b.beatState === 'ObjectState.Disabled',
      versionName: sn?.versionName ?? '',
    });
    return sn;
  };

  // Hlavička scény není v textu, ale ve vlastnostech úryvku: vkládáme ji tam, kde se scéna změní.
  let prevScene = '';
  let firstItem = true;
  for (const item of sequence) {
    if ('brk' in item) {
      const ep = item.brk.episode;
      if (ep && firstItem) {
        // Úvodní epizoda nese titulní stranu celého scénáře.
        if (ep.title?.trim()) p.title = ep.title.trim();
        const body = htmlToParas(String(ep.body ?? '').replace(/class="titlepagebody"/g, 'class="action"')).map((x) => x.text);
        const by = body.findIndex((t) => /^(by|napsal[a]?|written by)$/i.test(t));
        p.titlePage.author = by >= 0 ? (body[by + 1] ?? '') : '';
        p.titlePage.contact = String(ep.bottomLeftText ?? '').replace(/^contact:\s*/i, '');
        p.titlePage.draft = String(ep.bottomRightText ?? '').replace(/\n/g, ', ');
      } else {
        p.breaks[item.brk.id] = { id: item.brk.id, title: item.brk.title };
        p.order.push(item.brk.id);
      }
      firstItem = false;
      continue;
    }
    firstItem = false;
    const sn = addBeat(item.beat);
    if (sn === null) continue;
    p.order.push(item.beat);
    const b = p.beats[item.beat];
    if (sn?.sceneLocation?.trim()) {
      const h = heading(sn);
      if ((h !== prevScene || sn.forceSceneHeading) && !b.paras.some((x) => x.type === 'scene')) b.paras.unshift({ id: id(), type: 'scene', text: h });
      prevScene = h;
    }
    if (!b.paras.length) b.paras = [{ id: id(), type: 'action', text: '' }];
  }
  // Beaty bez místa v časové ose (odložené) přidáme na konec jako vyřazené.
  for (const bid of Object.keys(o.beatObjects)) {
    if (p.beats[bid] || pos.has(bid)) continue;
    if (addBeat(bid, true) === null) continue;
    const added = (p.beats as Record<ID, Beat>)[bid];
    if (!added.paras.length) added.paras = [{ id: id(), type: 'action', text: '' }];
    p.order.push(bid);
  }
  p.groups = p.groups.filter((g) => Object.values(p.beats).some((b) => b.groupId === g.id) || p.groups.some((x) => x.parentId === g.id));

  // ---------- Závislosti: koncový bod je beat, skupina nebo blok ----------
  const depBeat = map('DependencyObject.sourceBeat');
  const depBlock = map('DependencyObject.sourceBlock');
  const depGroup = map('DependencyObject.sourceGroup');
  const resolve = (dep: ID | undefined, last: boolean): ID | undefined => {
    if (!dep) return;
    if (depBeat.has(dep)) return p.beats[depBeat.get(dep)!] ? depBeat.get(dep) : undefined;
    const members = depGroup.has(dep)
      ? beatOrder.filter((b) => beatGroup.get(b) === depGroup.get(dep) && p.beats[b])
      : beatOrder.filter((b) => beatBlock.get(b) === depBlock.get(dep) && p.beats[b]);
    return last ? members.at(-1) : members[0];
  };
  const src = map('DependencyConnection.sourceObject');
  const dst = map('DependencyConnection.destinationObject');
  for (const [conn, s] of src) {
    const from = resolve(s, true);
    const to = resolve(dst.get(conn), false);
    if (from && to && from !== to && !p.links.some((l) => l.from === from && l.to === to)) p.links.push({ id: conn, from, to, note: '' });
  }

  // Ruční křivku napětí nastavíme podle napětí z tagů, aby nezačínala jako rovná čára.
  const derived = derivedTension(p);
  if (derived) for (const [bid, v] of derived) p.beats[bid].tension = Math.round(v * 10);
  return p;
}

export function exportFountain(p: Project): string {
  const tp = p.titlePage;
  let s = `Title: ${p.title}\n`;
  if (tp.author.trim()) s += `Credit: Napsal\nAuthor: ${tp.author.trim()}\n`;
  if (tp.basedOn.trim()) s += `Source: ${tp.basedOn.trim()}\n`;
  if (tp.draft.trim()) s += `Draft date: ${tp.draft.trim()}\n`;
  if (tp.contact.trim()) s += `Contact: ${tp.contact.trim().replace(/\n/g, '\n    ')}\n`;
  s += '\n';
  for (const x of p.order) {
    if (p.breaks[x]) s += `# ${p.breaks[x].title}\n\n`;
    else if (!p.beats[x].off) {
      const b = p.beats[x];
      if (b.title.trim()) s += `## ${b.title.trim()}\n\n`;
      if (b.synopsis.trim()) s += `= ${b.synopsis.trim().replace(/\n/g, ' ')}\n\n`;
      const body = toFountain(b.paras);
      if (body) s += body + '\n\n';
    }
  }
  return s;
}

/** Osnova slovy: beaty v pořadí, u každého jeho příčiny. */
export function exportOutline(p: Project): string {
  const num = new Map<ID, number>();
  let n = 0;
  for (const x of p.order) if (p.beats[x]) num.set(x, ++n);
  const name = (b: ID) => `${num.get(b)}. ${p.beats[b].title.trim() || 'Bez názvu'}`;
  let s = `${p.title.toLocaleUpperCase('cs')} – osnova\n`;
  for (const x of p.order) {
    if (p.breaks[x]) {
      s += `\n== ${p.breaks[x].title} ==\n`;
      continue;
    }
    const b = p.beats[x];
    const lane = p.lanes.find((l) => l.id === b.laneId)?.name;
    s += `\n${name(x)}${lane ? ` [${lane}]` : ''}\n`;
    if (b.synopsis.trim()) s += `   ${b.synopsis.trim()}\n`;
    for (const l of p.links.filter((l) => l.to === x)) s += `   ← protože ${name(l.from)}${l.note.trim() ? ` – ${l.note.trim()}` : ''}\n`;
  }
  return s;
}

export function download(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const FDX_TYPE: Record<ParaType, string> = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  paren: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
};
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Scénář jako dokument Final Draft (.fdx). Název a synopse beatu se uloží do vlastností scény. */
export function exportFdx(p: Project): string {
  const out: string[] = [];
  const para = (type: string, text: string, attrs = '', inner = '') =>
    out.push(`    <Paragraph${attrs} Type="${type}">\n${inner}      <Text>${xml(text)}</Text>\n    </Paragraph>`);
  let scene = 0;
  for (const x of p.order) {
    if (p.breaks[x]) {
      para('General', p.breaks[x].title.toLocaleUpperCase('cs'), ' Alignment="Center"');
      continue;
    }
    const b = p.beats[x];
    if (b.off) continue;
    let first = true;
    for (const q of b.paras) {
      const t = q.text.trim();
      if (!t) continue;
      const upper = q.type === 'scene' || q.type === 'character' || q.type === 'transition';
      const text = upper ? t.toLocaleUpperCase('cs') : t;
      if (q.type === 'scene') {
        const props = first
          ? `      <SceneProperties Title="${xml(b.title)}">\n        <Summary>\n          <Paragraph>\n            <Text>${xml(b.synopsis)}</Text>\n          </Paragraph>\n        </Summary>\n      </SceneProperties>\n`
          : '';
        para('Scene Heading', text, ` Number="${++scene}"`, props);
        first = false;
      } else {
        for (const line of q.type === 'action' ? text.split('\n') : [text]) if (line.trim()) para(FDX_TYPE[q.type], line.trim());
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${out.join('\n')}
  </Content>
  <TitlePage>
    <Content>
      <Paragraph Alignment="Center" Type="General">
        <Text>${xml(p.title.toLocaleUpperCase('cs'))}</Text>
      </Paragraph>${[p.titlePage.author && `Napsal ${p.titlePage.author}`, p.titlePage.basedOn, p.titlePage.draft, p.titlePage.contact]
        .filter((t) => t && t.trim())
        .map((t) => `\n      <Paragraph Alignment="Center" Type="General">\n        <Text>${xml(String(t).trim())}</Text>\n      </Paragraph>`)
        .join('')}
    </Content>
  </TitlePage>
</FinalDraft>
`;
}

/** Dokument Final Draft (.fdx): každá scéna se stane jedním beatem. */
export function importFdx(text: string, fileName: string): Project {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'FinalDraft' || doc.querySelector('parsererror')) throw new Error('Soubor není dokument Final Draft.');
  const content = [...root.children].find((c) => c.nodeName === 'Content');
  if (!content) throw new Error('Dokument Final Draft neobsahuje scénář.');
  const p = blank(fileName.replace(/\.[^.]+$/, ''));
  const kids = (el: Element, name: string) => [...el.children].filter((c) => c.nodeName === name);
  const ownText = (el: Element) => kids(el, 'Text').map((t) => t.textContent ?? '').join('');

  const paras: Para[] = [];
  const meta = new Map<ID, { title?: string; synopsis?: string; isBreak?: boolean }>();
  for (const el of kids(content, 'Paragraph')) {
    const t = ownText(el).trim();
    if (!t) continue;
    const kind = (el.getAttribute('Type') ?? '').toLowerCase();
    const type: ParaType = kind.includes('scene')
      ? 'scene'
      : kind === 'character'
        ? 'character'
        : kind.includes('parenth')
          ? 'paren'
          : kind.includes('dialog')
            ? 'dialogue'
            : kind.includes('transition')
              ? 'transition'
              : 'action';
    const q: Para = { id: id(), type, text: t };
    paras.push(q);
    // Předěly: prvky „New Act“ / „End of Act“ a vycentrovaný obecný odstavec (tak je zapisuje náš export).
    if (/\bact\b/.test(kind) || (kind === 'general' && el.getAttribute('Alignment') === 'Center')) meta.set(q.id, { isBreak: true });
    const props = kids(el, 'SceneProperties')[0];
    if (props) {
      const summary = [...props.querySelectorAll('Summary Text')].map((x) => x.textContent ?? '').join(' ').trim();
      meta.set(q.id, { title: props.getAttribute('Title') ?? undefined, synopsis: summary });
    }
  }
  parasToBeats(p, paras, meta);
  addSpeakers(p);
  const title = root.querySelector('TitlePage Text')?.textContent?.trim();
  if (title) p.title = titleCase(title);
  return p;
}
