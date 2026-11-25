import plugin from 'tailwindcss/plugin';

// Every colour resolves through the CSS variables in src/styles/tokens.css, so flipping
// `data-theme` on <html> re-themes the whole app without touching a class name.
//
// `ch(v)`: a channel-triplet var → full `/alpha` modifier support (`bg-accent/40`).
// `fixed(v, a)`: the design bakes this alpha in (fg-2 = text @ .66, line = white/ink @ .07, …).
//   Tailwind 3.4 still parses `rgb(var(--x) / 0.66)`, so a modifier (`text-fg-2/50`) does
//   compile — but it REPLACES the baked alpha (→ text @ .50) rather than multiplying it.
//   Prefer the base name (`text-fg/50`) when you need a different alpha.
// `raw(v)`: an `--x-*` value that already carries its own alpha (no modifier support at all).
const ch = (v) => `rgb(var(${v}) / <alpha-value>)`;
const fixed = (v, a) => `rgb(var(${v}) / ${a})`;
const raw = (v) => `var(${v})`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ---- semantic token names (use these in new code) ----
        page: ch('--c-page'),
        fg: ch('--c-text-1'),
        'fg-2': fixed('--c-text-1', 0.66),
        'fg-3': fixed('--c-text-1', 0.55),
        'on-accent': ch('--c-on-accent'),
        danger: ch('--c-danger'),
        card: ch('--c-card'),
        line: fixed('--c-line-rgb', 0.07),
        grid: fixed('--c-line-rgb', 0.065),
        primary: ch('--c-primary'),
        'on-primary': ch('--c-on-primary'),
        accent: ch('--c-accent'),
        'accent-fg': ch('--c-accent-text'),
        'accent-soft': raw('--x-accent-soft'),
        'accent-line': raw('--x-accent-line'),
        meeting: ch('--c-meeting'),
        'on-meeting': ch('--c-on-meeting'),
        today: ch('--c-today'),
        'on-today': ch('--c-on-today'),
        'habit-fg': ch('--c-habit-fg'),
        now: ch('--c-now'),
        'toast-fg': ch('--c-toast-fg'),
        'chip-fg': ch('--c-chip-fg'),
        'chart-meet': ch('--c-chart-meet'),
        'chart-habit': ch('--c-chart-habit'),
        'chart-task': ch('--c-chart-task'),
        'pri-crit': ch('--c-pri-crit'),
        'pri-high': ch('--c-pri-high'),
        'pri-med': ch('--c-pri-med'),
        'pri-low': ch('--c-pri-low'),

        // ---- legacy names, re-pointed at tokens for the transition (removed in P8, Task 8.2) ----
        // indigo → meeting violet, NOT lime: today's `bg-indigo text-white` buttons would be
        // white-on-lime. Screen phases move brand fills to `bg-accent text-on-accent` and brand
        // text to `text-accent-fg`.
        indigo: ch('--c-meeting'),
        indigo600: ch('--c-meeting'),
        indigoSoft: fixed('--c-meeting', 0.12),
        event: ch('--c-meeting'),
        bg: ch('--c-page'),
        ink: ch('--c-text-1'),
        inkSoft: fixed('--c-text-1', 0.66),
        crit: ch('--c-pri-crit'),
        high: ch('--c-pri-high'),
        med: ch('--c-pri-med'),
        low: ch('--c-pri-low'),
        // The old sidebar stays a fixed dark island (dark-theme values) until P2 replaces it
        // with the rail: its active item is `bg-sidebarHover text-white`, which a themed
        // (light) surface would make white-on-white.
        sidebar: 'rgb(22 22 26 / <alpha-value>)',
        sidebarHover: 'rgb(255 255 255 / 0.08)',
        sidebarText: 'rgb(244 245 247 / 0.66)',
        sidebarMuted: 'rgb(244 245 247 / 0.55)',
        // Kind palettes — Stats charts and planner tiles.
        kind: {
          meetingBar: ch('--c-chart-meet'),
          habitBar: ch('--c-chart-habit'),
          taskBar: ch('--c-chart-task'),
          habitText: ch('--c-habit-fg'),
          taskText: ch('--c-text-1'),
        },
      },
      backgroundColor: {
        overlay: raw('--x-overlay'),
        'today-col': raw('--x-today-col'),
      },
      fontFamily: { sans: ['Manrope', 'system-ui', 'sans-serif'] },
      borderRadius: {
        panel: 'var(--radius-panel)',
        rail: 'var(--radius-rail)',
        card: 'var(--radius-card)',
        field: 'var(--radius-field)',
        input: 'var(--radius-input)',
        event: 'var(--radius-event)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        // legacy names re-pointed
        card: 'var(--x-card-shadow)',
        pop: 'var(--x-shadow-pop)',
        modal: 'var(--x-shadow-modal)',
        // design
        panel: 'var(--x-panel-shadow)',
        meeting: 'var(--x-meeting-shadow)',
        accent: 'var(--x-accent-shadow)',
        'accent-hover': 'var(--x-accent-shadow-hover)',
        lift: '0 26px 50px -14px rgba(0, 0, 0, 0.8)',
      },
      transitionTimingFunction: {
        spring: 'var(--ease-spring)',
        'spring-strong': 'var(--ease-spring-strong)',
        pop: 'var(--ease-pop)',
        'out-soft': 'var(--ease-out)',
      },
      transitionDuration: {
        move: 'var(--dur-move)',
        resize: 'var(--dur-resize)',
        land: 'var(--dur-land)',
        reflow: 'var(--dur-reflow)',
        enter: 'var(--dur-enter)',
        'modal-in': 'var(--dur-modal-in)',
        'modal-out': 'var(--dur-modal-out)',
      },
      // Every animation the redesign needs ships here (the config is frozen after P1).
      // Curves are the prototypes' (PlannerDark/PlannerLight/Stats .dc.html); lime glows use
      // --c-accent-glow so the light theme gets its olive glow.
      keyframes: {
        // pre-redesign (still used)
        pop: { '0%': { opacity: '0', transform: 'translateY(8px) scale(.98)' }, '100%': { opacity: '1', transform: 'none' } },
        fade: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        // redesign
        rise: { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'none' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'ev-in': { from: { opacity: '0', transform: 'translateY(10px) scale(.95)' }, to: { opacity: '1', transform: 'none' } },
        land: {
          '0%': { opacity: '0', transform: 'translateY(-46px) scale(.82) rotate(-2deg)' },
          '55%': { opacity: '1' },
          '75%': { boxShadow: '0 0 0 6px rgb(var(--c-accent-glow) / .35)' },
          '100%': { opacity: '1', transform: 'none', boxShadow: '0 0 0 14px rgb(var(--c-accent-glow) / 0)' },
        },
        shake: {
          '10%, 90%': { transform: 'translateX(-1px)' },
          '20%, 80%': { transform: 'translateX(2px)' },
          '30%, 50%, 70%': { transform: 'translateX(-4px)' },
          '40%, 60%': { transform: 'translateX(4px)' },
        },
        // The prototype baked `translate(-50%, …)` in because its toast was `left:50%`. Here
        // the caller centres the toast (flex wrapper), so the keyframe only moves vertically.
        toast: {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(.96)' },
          '12%, 82%': { opacity: '1', transform: 'none' },
          '100%': { opacity: '0', transform: 'translateY(4px)' },
        },
        'pulse-dot': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--c-accent-glow) / .6)' },
          '70%': { boxShadow: '0 0 0 10px rgb(var(--c-accent-glow) / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--c-accent-glow) / 0)' },
        },
        'pop-check': { '0%': { transform: 'scale(.55)' }, '100%': { transform: 'scale(1)' } },
        expand: { from: { opacity: '0', transform: 'translateY(-6px)' } },
        'modal-in': { from: { opacity: '0', transform: 'translateY(26px) scale(.94)' }, to: { opacity: '1', transform: 'none' } },
        'modal-out': { to: { opacity: '0', transform: 'translateY(12px) scale(.97)' } },
        'bd-in': { from: { opacity: '0' } },
        'bd-out': { to: { opacity: '0' } },
        'th-in': { from: { transform: 'rotate(90deg) scale(.6)', opacity: '0' } },
        spin: { to: { transform: 'rotate(360deg)' } },
        fresh: {
          '0%': { opacity: '0', transform: 'translateY(-10px) scale(.96)', boxShadow: '0 0 0 0 rgb(var(--c-accent-glow) / 0)' },
          '35%': { opacity: '1', transform: 'none', boxShadow: '0 0 0 3px rgb(var(--c-accent-glow) / .55)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--c-accent-glow) / 0)' },
        },
        // Stats bars: pair with `origin-bottom`.
        grow: { from: { transform: 'scaleY(0)' }, to: { transform: 'none' } },
        // Stats donut (prototype `draw`): each arc grows from zero length. Contract: the arc
        // sets its final `stroke-dasharray` ("<len> <circumference>") and `--donut-c` to the
        // circle's circumference (falls back to the prototype's r=80 → 503).
        'donut-draw': { from: { strokeDasharray: '0 var(--donut-c, 503)' } },
        // strike-draw (done tasks) is a background-size transition, not a keyframe.
      },
      animation: {
        pop: 'pop .14s ease-out',
        fade: 'fade .12s ease-out',
        rise: 'rise var(--dur-enter) var(--ease-out) backwards',
        'fade-up': 'fade-up .4s var(--ease-out) backwards',
        'ev-in': 'ev-in .55s var(--ease-out) backwards',
        land: 'land .9s cubic-bezier(.34, 1.45, .5, 1) backwards',
        shake: 'shake .45s cubic-bezier(.36, .07, .19, .97)',
        toast: 'toast var(--dur-toast) ease both',
        'pulse-dot': 'pulse-dot 2.2s ease-out infinite',
        'pop-check': 'pop-check .35s var(--ease-pop)',
        expand: 'expand .35s var(--ease-out) both',
        'modal-in': 'modal-in var(--dur-modal-in) cubic-bezier(.34, 1.3, .5, 1) both',
        'modal-out': 'modal-out var(--dur-modal-out) ease both',
        'bd-in': 'bd-in .25s ease both',
        'bd-out': 'bd-out .22s ease both',
        'th-in': 'th-in .6s var(--ease-pop)',
        spin: 'spin .9s linear infinite',
        fresh: 'fresh 1.3s var(--ease-out) backwards',
        grow: 'grow .8s var(--ease-out) backwards',
        'donut-draw': 'donut-draw 1.1s var(--ease-out) .2s backwards',
      },
    },
  },
  // `coarse:` keys off the input device, not the viewport: a touch laptop at 1280px gets the
  // bigger targets and a 390px window driven by a mouse does not. Literal class strings only,
  // so the JIT still sees every utility (`coarse:h-11` is scanned like any other token).
  plugins: [plugin(({ addVariant }) => { addVariant('coarse', '@media (pointer: coarse)'); })],
};
