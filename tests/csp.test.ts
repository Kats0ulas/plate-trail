import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
const directive = (name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(name + ' '))
    ?.split(/\s+/)
    .slice(1) ?? [];

describe('Content-Security-Policy (privacy rule 3.2)', () => {
  it('exists in index.html', () => {
    expect(csp).not.toBe('');
  });

  it('defaults to self', () => {
    expect(directive('default-src')).toEqual(["'self'"]);
  });

  it('only lets the page talk to itself, the tile host and Overpass', () => {
    expect(directive('connect-src').sort()).toEqual(
      [
        "'self'",
        'https://tiles.openfreemap.org',
        'https://overpass-api.de',
        'https://overpass.kumi.systems',
        'https://overpass.private.coffee',
      ].sort(),
    );
  });

  it('allows no inline or remote scripts', () => {
    expect(directive('script-src')).toEqual(["'self'"]);
  });
});
