import { describe, expect, it } from 'vitest';
import { carriedLevel, derivedTension, tagTension } from '../src/tension';
import type { Tag } from '../src/model';
import { project } from './fixtures';

const tag = (mode: Tag['mode']): Tag => ({ id: 't', name: 'Nebezpečí', color: '#000', mode, category: 'Nebezpečí' });

function story(mode: Tag['mode'], levels: (number | null)[]) {
  const p = project();
  p.tags = [tag(mode)];
  const beats = levels.map((lvl, i) => p.add(String(i), lvl === null ? {} : { tagIds: ['t'], tagLevels: { t: lvl } }));
  return { p, values: (m: Map<string, number>) => beats.map((b) => +(m.get(b.id) ?? 0).toFixed(2)) };
}

describe('napětí z motivů', () => {
  it('„rising“: napětí odpovídá úrovni a trvá mezi výskyty', () => {
    const { p, values } = story('rising', [null, 4, null, 9]);
    expect(values(tagTension(p, p.tags[0]))).toEqual([0, 0.4, 0.4, 0.9]);
  });

  it('„change“: napětí vzniká skokem a doznívá', () => {
    const { p, values } = story('change', [5, 5, 8, null, null]);
    expect(values(tagTension(p, p.tags[0]))).toEqual([0.3, 0, 0.5, 0.25, 0.13]);
  });

  it('„none“ napětí nevytváří', () => {
    const { p } = story('none', [3, 9]);
    expect(derivedTension(p)).toBeNull();
  });

  it('nový výskyt naváže na poslední úroveň', () => {
    const { p } = story('rising', [7, null, null]);
    expect(carriedLevel(p, 't', p.order[2])).toBe(7);
  });
});
