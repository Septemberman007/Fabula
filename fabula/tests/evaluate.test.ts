import { describe, expect, it } from 'vitest';
import { brokenLinks, evaluate } from '../src/evaluate';
import { para, project } from './fixtures';

const keys = (issues: { key: string }[]) => issues.map((i) => i.key.split(':')[0]);

describe('kontrola děje', () => {
  it('ohlásí následek, který je před svou příčinou', () => {
    const p = project();
    const a = p.add('Příčina');
    const b = p.add('Následek');
    p.links.push({ id: 'l', from: b.id, to: a.id, note: '' });
    const issues = evaluate(p);
    expect(issues[0]).toMatchObject({ severity: 'error', linkId: 'l', beatIds: [a.id, b.id] });
    expect([...brokenLinks(p, issues)]).toEqual(['l']);
  });

  it('správné pořadí chybu nehlásí', () => {
    const p = project();
    const a = p.add('Příčina');
    const b = p.add('Následek');
    p.links.push({ id: 'l', from: a.id, to: b.id, note: '' });
    expect(evaluate(p).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('ohlásí kruhovou závislost jednou', () => {
    const p = project();
    const [a, b, c] = ['A', 'B', 'C'].map((t) => p.add(t));
    p.links.push({ id: '1', from: a.id, to: b.id, note: '' }, { id: '2', from: b.id, to: c.id, note: '' }, { id: '3', from: c.id, to: a.id, note: '' });
    const errors = evaluate(p).filter((i) => i.severity === 'error');
    expect(keys(errors)).toEqual(['cycle']);
  });

  it('najde chyby formátu', () => {
    const p = project();
    p.add('Scéna', { paras: [para('scene', 'KUCHYNĚ'), para('character', 'PETR'), para('action', 'Mlčí.'), para('dialogue', 'Kdo to řekl?')] });
    const fmt = evaluate(p).find((i) => i.key.startsWith('fmt'))!;
    expect(fmt.message).toContain('hlavička scény nezačíná INT. nebo EXT.');
    expect(fmt.message).toContain('postava „PETR“ nemá repliku');
    expect(fmt.message).toContain('replika bez jména postavy');
  });

  it('mnoho stejných tipů shrne do jednoho', () => {
    const p = project();
    const beats = [...Array(12)].map((_, i) => p.add(`Beat ${i}`));
    p.links.push({ id: 'l', from: beats[0].id, to: beats[1].id, note: '' });
    const isolated = evaluate(p).filter((i) => i.key.startsWith('isolated'));
    expect(isolated).toHaveLength(1);
    expect(isolated[0].beatIds).toHaveLength(10);
  });

  it('postava, která zmizí na celé dějství', () => {
    const p = project();
    p.characters = [{ id: 'm', name: 'Marta', color: '#000', aliases: '', role: 'main' }];
    p.add('1', { characterIds: ['m'] });
    p.breaks.x = { id: 'x', title: 'Druhé dějství' };
    p.order.push('x');
    p.add('2');
    p.add('3');
    p.breaks.y = { id: 'y', title: 'Třetí dějství' };
    p.order.push('y');
    p.add('4', { characterIds: ['m'] });
    expect(evaluate(p).some((i) => i.key.startsWith('gone') && i.message.includes('Druhé dějství'))).toBe(true);
  });
});
