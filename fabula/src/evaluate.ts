import { ID, PARA_LABEL, Project, beatName } from './model';
import { SCENE_RE, beatCharacters, unknownSpeakers } from './text';
import { orderBreaks, storybeatTag } from './dramatica';

export type Severity = 'error' | 'warn' | 'tip';

export interface Issue {
  key: string;
  severity: Severity;
  message: string;
  /** Beaty, kterých se problém týká (první se vybere po kliknutí). */
  beatIds: ID[];
  linkId?: ID;
}

/** Rozdělí pořadí na dějství podle předělů. */
function acts(p: Project): { title: string; beats: ID[] }[] {
  const out = [{ title: 'Úvod', beats: [] as ID[] }];
  for (const id of p.order) {
    if (p.breaks[id]) out.push({ title: p.breaks[id].title || 'Předěl', beats: [] });
    else out[out.length - 1].beats.push(id);
  }
  return out.filter((a) => a.beats.length);
}

/** Projde příběh a vrátí seznam logických problémů, nejzávažnější první. */
export function evaluate(p: Project): Issue[] {
  const issues: Issue[] = [];
  const name = (id: ID) => beatName(p, id);
  const pos = new Map<ID, number>();
  p.order.forEach((id, i) => pos.set(id, i));

  // Pořadí uvnitř throughline je jediné, které Dramatica předepisuje.
  for (const x of orderBreaks(p)) {
    issues.push({
      key: `weave:${x.earlier.key}`,
      severity: 'warn',
      message: `Storybeat ${storybeatTag(x.earlier)} (${x.earlier.fn}) ve scéně „${name(x.second)}“ stojí až za ${storybeatTag(x.later)} ve scéně „${name(x.first)}“. Uvnitř throughline mají jít po sobě.`,
      beatIds: [x.second, x.first],
    });
  }

  // Kruhové vazby: A způsobuje B a B (i nepřímo) způsobuje A.
  const out = new Map<ID, ID[]>();
  for (const l of p.links) out.set(l.from, [...(out.get(l.from) ?? []), l.to]);
  const reaches = (from: ID, target: ID): boolean => {
    const seen = new Set<ID>();
    const stack = [from];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === target) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(out.get(x) ?? []));
    }
    return false;
  };
  const cyclic = new Set<ID>();
  const inCycle = new Set<ID>();
  for (const l of p.links) {
    if (reaches(l.to, l.from)) {
      cyclic.add(l.id);
      inCycle.add(l.from).add(l.to);
    }
  }
  if (inCycle.size) {
    const ids = [...inCycle].sort((a, b) => pos.get(a)! - pos.get(b)!);
    issues.push({
      key: 'cycle',
      severity: 'error',
      message: `Kruhová závislost: ${ids.map((id) => `„${name(id)}“`).join(', ')} se způsobují navzájem.`,
      beatIds: ids,
    });
  }

  // Inverze: následek je ve vyprávění dřív než jeho příčina.
  for (const l of p.links) {
    if (cyclic.has(l.id)) continue;
    if (pos.get(l.from)! > pos.get(l.to)!) {
      issues.push({
        key: `inv:${l.id}`,
        severity: 'error',
        message: `„${name(l.to)}“ se stane dřív než jeho příčina „${name(l.from)}“.`,
        beatIds: [l.to, l.from],
        linkId: l.id,
      });
    }
  }

  const linked = new Set<ID>();
  for (const l of p.links) linked.add(l.from).add(l.to);
  const beatIds = p.order.filter((id) => p.beats[id]);
  const cast = new Map(beatIds.map((id) => [id, beatCharacters(p, p.beats[id])]));

  const isolated: ID[] = [];
  const empty: ID[] = [];
  for (const id of beatIds) {
    const b = p.beats[id];
    if (!b.title.trim()) {
      issues.push({ key: `untitled:${id}`, severity: 'warn', message: 'Beat nemá název.', beatIds: [id] });
    }
    if (p.links.length > 0 && beatIds.length > 1 && !linked.has(id) && !b.off) isolated.push(id);
    if (cast.get(id)!.length === 0 && p.characters.length > 0 && !b.off) empty.push(id);
  }
  // Když se tip týká mnoha beatů, vypíšeme ho jednou; jinak by přehlušil všechno ostatní.
  const many = (ids: ID[], key: string, one: (id: ID) => string, all: (n: number) => string) => {
    if (ids.length > 8) issues.push({ key, severity: 'tip', message: all(ids.length), beatIds: ids });
    else for (const id of ids) issues.push({ key: `${key}:${id}`, severity: 'tip', message: one(id), beatIds: [id] });
  };
  many(
    isolated,
    'isolated',
    (id) => `„${name(id)}“ nemá příčinu ani následek – příběh by se bez něj obešel.`,
    (n) => `${n} beatů nemá žádnou kauzální vazbu. Vazby zatím vedou jen mezi částí příběhu.`,
  );
  many(
    empty,
    'nochar',
    (id) => `V „${name(id)}“ nevystupuje žádná postava.`,
    (n) => `V ${n} beatech nevystupuje žádná postava.`,
  );

  // Formát scénáře: prázdné prvky, postava bez repliky, replika bez postavy, hlavička bez INT/EXT.
  for (const id of beatIds) {
    const b = p.beats[id];
    if (b.off) continue;
    const ps = b.paras;
    const found = new Set<string>();
    ps.forEach((x, i) => {
      const empty = !x.text.trim();
      if (empty && ps.length > 1) found.add(`prázdný odstavec (${PARA_LABEL[x.type].toLowerCase()})`);
      if (empty) return;
      if (/^\s/.test(x.text)) found.add('odstavec začíná mezerou');
      const next = ps[i + 1];
      const prev = ps[i - 1];
      if (x.type === 'character' && !(next && (next.type === 'dialogue' || next.type === 'paren'))) found.add(`postava „${x.text.trim().toLocaleUpperCase('cs')}“ nemá repliku`);
      if (x.type === 'dialogue' && !(prev && (prev.type === 'character' || prev.type === 'paren'))) found.add(prev?.type === 'dialogue' ? 'dvě repliky za sebou bez jména postavy' : 'replika bez jména postavy');
      if (x.type === 'paren' && !(prev && (prev.type === 'character' || prev.type === 'dialogue'))) found.add('poznámka v závorce mimo dialog');
      if (x.type === 'scene' && !SCENE_RE.test(x.text.trim())) found.add('hlavička scény nezačíná INT. nebo EXT.');
    });
    if (found.size) {
      issues.push({ key: `fmt:${id}`, severity: 'warn', message: `Formát v „${name(id)}“: ${[...found].join('; ')}.`, beatIds: [id] });
    }
  }

  // Mluvčí ve scénáři, kteří nejsou mezi postavami.
  const unknown = unknownSpeakers(p);
  if (unknown.length) {
    issues.push({
      key: 'speakers',
      severity: 'warn',
      message: `Ve scénáři mluví ${unknown.join(', ')}, ale mezi postavami chybí. Přidáš je v záložce „Obsazení“.`,
      beatIds: [],
    });
  }

  const structure = acts(p);

  for (const c of p.characters) {
    const cname = c.name.trim() || 'Bez jména';
    const present = (id: ID) => cast.get(id)!.includes(c.id);
    if (!beatIds.some(present)) {
      issues.push({ key: `unused:${c.id}`, severity: 'tip', message: `Postava „${cname}“ nevystupuje v žádném beatu.`, beatIds: [] });
      continue;
    }
    // Postava, která zmizí na celé dějství a pak se vrátí.
    structure.forEach((act, i) => {
      if (act.beats.length < 2 || act.beats.some(present)) return;
      const before = structure.slice(0, i).some((a) => a.beats.some(present));
      const after = structure.slice(i + 1).some((a) => a.beats.some(present));
      if (before && after) {
        issues.push({
          key: `gone:${c.id}:${i}`,
          severity: 'tip',
          message: `Postava „${cname}“ na celé „${act.title}“ zmizí a pak se vrátí.`,
          beatIds: [act.beats[0]],
        });
      }
    });
  }

  // Motiv, který se objeví jen jednou: zasazený, ale nevypointovaný.
  for (const t of p.tags) {
    const used = beatIds.filter((id) => p.beats[id].tagIds.includes(t.id));
    const tname = t.name.trim() || 'Bez názvu';
    if (used.length === 1) {
      issues.push({
        key: `tag1:${t.id}`,
        severity: 'tip',
        message: `Motiv „${tname}“ se objeví jen v „${name(used[0])}“ – je zasazený, ale nevrací se.`,
        beatIds: used,
      });
    } else if (used.length === 0) {
      issues.push({ key: `tag0:${t.id}`, severity: 'tip', message: `Motiv „${tname}“ není použit v žádném beatu.`, beatIds: [] });
    }
  }

  // Dějství, ve kterém napětí neroste.
  for (const [i, act] of structure.entries()) {
    if (act.beats.length < 3) continue;
    const t = act.beats.map((id) => p.beats[id].tension);
    if (Math.max(...t) <= t[0]) {
      issues.push({
        key: `flat:${i}`,
        severity: 'tip',
        message: `V „${act.title}“ napětí nikde nepřekročí úroveň prvního beatu.`,
        beatIds: [act.beats[0]],
      });
    }
  }

  const rank: Record<Severity, number> = { error: 0, warn: 1, tip: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Id vazeb, které jsou v inverzi nebo v kruhu. */
export function brokenLinks(p: Project, issues: Issue[]): Set<ID> {
  const set = new Set<ID>();
  for (const i of issues) if (i.linkId) set.add(i.linkId);
  const cycle = issues.find((i) => i.key === 'cycle');
  if (cycle) {
    const cyc = new Set(cycle.beatIds);
    for (const l of p.links) if (cyc.has(l.from) && cyc.has(l.to)) set.add(l.id);
  }
  return set;
}
