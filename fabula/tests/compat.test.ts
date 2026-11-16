import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tint } from '../src/colors';
import { profanities } from '../src/stats';

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

describe('starší prohlížeče (Safari 15 na iPadu Air 2)', () => {
  it('kód nepoužívá regulární výrazy s lookbehind, kvůli kterým by se aplikace vůbec nenačetla', () => {
    const bad = files('src').filter((f) => /\(\?<[=!]/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('vulgarismy se počítají jen na začátku slova', () => {
    expect(profanities('Kurva, do prdele. Okurva není nadávka, hovno ano.')).toBe(3);
  });
  it('zprůhledněná barva se píše bez color-mix', () => {
    expect(tint('#ff0000', 0.5)).toBe('#ff000080');
    expect(tint('#f00', 1)).toBe('#ff0000ff');
    expect(tint('red', 0.2)).toContain('color-mix');
  });
});
