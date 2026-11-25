import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Reads ONLY the committed port. The design handoff (notreclaim-redesign/) is untracked and
// absent in worktrees/CI, so its token names are transcribed here once instead.
// (`import.meta.url` is not a file: URL under the jsdom environment — use __dirname.)
const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

/** Declarations (`--name`) inside the rule whose selector list is exactly `selector`. */
function declaredIn(selector: string): Set<string> {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = rules.find((m) => (m[1] ?? '').trim().replace(/\s+/g, ' ') === selector);
  if (!rule) throw new Error(`no rule for selector ${selector}`);
  return new Set([...(rule[2] ?? '').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] ?? ''));
}

const SHARED = ':root';
const DARK = ':root, :root[data-theme="dark"]';
const LIGHT = ':root[data-theme="light"]';

/** Design token → the var(s) carrying it, for tokens whose value differs per theme. */
const THEMED: Record<string, string[]> = {
  '--bg-page': ['--c-page'],
  '--text-1': ['--c-text-1'], // --text-2 / --text-3 are --c-text-1 at fixed alphas (Tailwind fg-2/fg-3)
  '--text-on-accent': ['--c-on-accent'],
  '--text-danger': ['--c-danger'],
  '--panel-bg': ['--x-panel-bg', '--c-card'],
  '--panel-border': ['--x-panel-border', '--c-line-rgb'],
  '--panel-shadow': ['--x-panel-shadow'],
  '--panel-blur': ['--x-panel-blur'],
  '--card-bg': ['--x-card-bg', '--x-card-shadow'],
  '--card-border': ['--x-card-border'],
  '--card-hover': ['--x-card-hover'],
  '--btn-bg': ['--x-btn-bg', '--x-btn-shadow'],
  '--btn-border': ['--x-btn-border', '--x-btn-border-hover'],
  '--btn-bg-hover': ['--x-btn-bg-hover'],
  '--btn-primary-bg': ['--c-primary'],
  '--btn-primary-text': ['--c-on-primary'],
  '--accent': ['--c-accent', '--c-accent-glow'],
  '--accent-text': ['--c-accent-text'],
  '--accent-soft': ['--x-accent-soft'],
  '--accent-line': ['--x-accent-line'],
  '--meeting-bg': ['--c-meeting', '--x-meeting-bg'],
  '--meeting-border': ['--x-meeting-border'],
  '--meeting-text': ['--c-on-meeting'],
  '--meeting-shadow': ['--x-meeting-shadow'],
  '--today-bg': ['--c-today'],
  '--today-text': ['--c-on-today'],
  '--today-column': ['--x-today-col'],
  '--habit-bg': ['--x-habit-bg', '--x-habit-bg-hover'],
  '--habit-border': ['--x-habit-border'],
  '--habit-text': ['--c-habit-fg'],
  '--task-bg': ['--x-task-bg', '--x-task-bg-hover'],
  '--task-border': ['--x-task-border'],
  '--grid-line': ['--c-line-rgb'],
  '--now-line': ['--c-now'],
  '--overlay': ['--x-overlay'],
  '--dialog-bg': ['--x-dialog-bg'],
  '--toast-bg': ['--x-toast-bg', '--x-toast-border', '--x-toast-shadow'],
  '--toast-text': ['--c-toast-fg'],
  '--chart-meetings': ['--c-chart-meet'],
  '--chart-habits': ['--c-chart-habit'],
  // Not design tokens, but per-theme values the app needs (prototype .chip, spec §2.1 / §2.2).
  '(chip)': ['--c-chip-fg', '--x-chip-bg', '--x-chip-border'],
  '(chart task)': ['--c-chart-task'],
  '(legacy shadows)': ['--x-shadow-pop', '--x-shadow-modal'],
  '(focus)': ['--c-focus'],
};

/** Theme-independent design tokens, declared once on :root. */
const SHARED_VARS = [
  '--font-sans',
  '--radius-panel', '--radius-rail', '--radius-card', '--radius-field', '--radius-input', '--radius-event', '--radius-pill',
  '--c-pri-crit', '--c-pri-high', '--c-pri-med', '--c-pri-low',
  '--ease-spring', '--ease-spring-strong', '--ease-pop', '--ease-out',
  '--dur-move', '--dur-resize', '--dur-land', '--dur-reflow', '--dur-enter', '--dur-modal-in', '--dur-modal-out', '--dur-toast',
  '--x-accent-shadow', '--x-accent-shadow-hover', '--x-blocked-bg', '--x-blocked-border', '--x-hatch-bg',
];

describe('tokens.css', () => {
  const dark = declaredIn(DARK);
  const light = declaredIn(LIGHT);
  const shared = declaredIn(SHARED);

  it.each(Object.entries(THEMED))('%s has a counterpart in both theme blocks', (_token, vars) => {
    for (const v of vars) {
      expect(dark, `${v} missing in dark`).toContain(v);
      expect(light, `${v} missing in light`).toContain(v);
    }
  });

  it('declares the same set of vars in both theme blocks', () => {
    expect([...light].sort()).toEqual([...dark].sort());
  });

  it('declares every theme-independent token once on :root', () => {
    for (const v of SHARED_VARS) {
      expect(shared, `${v} missing on :root`).toContain(v);
      expect(dark).not.toContain(v);
      expect(light).not.toContain(v);
    }
  });

  it('sets color-scheme per theme', () => {
    expect(css).toMatch(/:root, :root\[data-theme="dark"\] \{[^}]*color-scheme: dark;/);
    expect(css).toMatch(/:root\[data-theme="light"\] \{[^}]*color-scheme: light;/);
  });

  it('uses Manrope for both themes', () => {
    expect(css).toMatch(/--font-sans: "Manrope"/);
    expect(css.match(/--font-sans:/g)).toHaveLength(1); // one declaration, shared by both themes
  });

  it('stores flat colours as space-separated channel triplets', () => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const values = [...noComments.matchAll(/(--c-[\w-]+)\s*:\s*([^;]+);/g)];
    expect(values.length).toBeGreaterThan(40);
    for (const [, name, value] of values) expect(value?.trim(), name).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
  });

  // WCAG 1.4.11: a focus indicator needs ≥3:1 against what it sits on — the page, opaque cards and
  // (CalendarBlock draws it inset) the solid meeting tile. Light lime was ~1.1:1 on the light page.
  it.each([['dark', DARK], ['light', LIGHT]])('--c-focus reaches 3:1 on %s surfaces', (_name, selector) => {
    const focus = channelsIn(selector, '--c-focus');
    for (const surface of ['--c-page', '--c-card', '--c-meeting']) {
      expect(contrast(focus, channelsIn(selector, surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });
});

/** The `r g b` triplet `name` holds inside the rule whose selector list is exactly `selector`. */
function channelsIn(selector: string, name: string): [number, number, number] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => (m[1] ?? '').trim().replace(/\s+/g, ' ') === selector);
  const value = rule?.[2]?.match(new RegExp(`${name}\\s*:\\s*(\\d+) (\\d+) (\\d+);`));
  if (!value) throw new Error(`${name} not in ${selector}`);
  return [Number(value[1]), Number(value[2]), Number(value[3])];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
