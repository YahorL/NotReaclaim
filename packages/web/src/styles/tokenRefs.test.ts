import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A typo'd `var(--…)` fails silently in the browser (the declaration is just dropped), and
// jsdom never evaluates our CSS — so pin every reference against the token definitions.
const read = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf8');
const tokens = read('tokens.css');
const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] ?? ''));

/** Vars supplied by the element that uses the class/animation, not by tokens.css. */
const CALLER_SUPPLIED = new Set(['--donut-c']);

function references(source: string): string[] {
  // Comments carry examples like `var(--x)`; only real declarations count.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // `ch('--…')` / `fixed('--…', a)` / `raw('--…')` are tailwind.config.js's var helpers.
  return [...new Set([...code.matchAll(/(?:var\(|(?:ch|fixed|raw)\(')(--[\w-]+)/g)].map((m) => m[1] ?? ''))];
}

describe('CSS variable references resolve to tokens', () => {
  it('sees the config references (guards the scan itself)', () => {
    expect(references(read('..', '..', 'tailwind.config.js')).length).toBeGreaterThan(50);
  });

  it.each([
    ['tailwind.config.js', read('..', '..', 'tailwind.config.js')],
    ['src/index.css', read('..', 'index.css')],
    ['src/styles/tokens.css', tokens],
  ])('%s', (_name, source) => {
    const refs = references(source).filter((v) => !v.startsWith('--tw-') && !CALLER_SUPPLIED.has(v));
    const missing = refs.filter((v) => !defined.has(v));
    expect(missing).toEqual([]);
  });
});
