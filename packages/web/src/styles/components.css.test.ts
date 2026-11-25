import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Later phases build on these literal class names (Tailwind JIT can't see computed names, so
// multi-value tokens live here). Guards against an accidental deletion or rename.
const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const componentsLayer = [...css.matchAll(/@layer components\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '').join('\n');

const CLASSES = [
  'glass', 'glass-card', 'glass-card-hover', 'glass-dialog',
  'btn-glass', 'btn-primary', 'btn-accent',
  'chip', 'toast', 'hatch', 'focus-ring',
  'block-meeting', 'block-task', 'block-habit', 'block-blocked',
];

describe('index.css component classes', () => {
  it.each(CLASSES)('.%s is defined in @layer components', (name) => {
    expect(componentsLayer).toMatch(new RegExp(`\\.${name}\\s*[{,:]`));
  });

  it('presses every button variant down to .96', () => {
    for (const b of ['btn-glass', 'btn-primary', 'btn-accent']) {
      expect(componentsLayer).toMatch(new RegExp(`\\.${b}:active[^{]*\\{[^}]*scale\\(\\.96\\)`));
    }
  });

  it('draws every focus outline in the theme-aware focus colour, not the accent fill', () => {
    const all = readFileSync(join(__dirname, '..', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...all.matchAll(/([^{}]*:focus-visible)\s*\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThanOrEqual(2); // the base :focus-visible and .focus-ring
    for (const [, , body] of rules) expect(body).toMatch(/outline:[^;]*var\(--c-focus\)/);
  });
});
