/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        indigo: '#5b62e3',
        indigo600: '#4f55d6',
        indigoSoft: '#eef0ff',
        sidebar: '#1b1e2e',
        sidebarHover: '#272b3f',
        sidebarText: '#c5c8d6',
        sidebarMuted: '#8b8fa3',
        bg: '#f4f5f8',
        card: '#ffffff',
        line: '#e7e8ee',
        ink: '#2a2d3a',
        inkSoft: '#6b6f80',
        crit: '#e5484d',
        high: '#f2700f',
        med: '#f5b014',
        low: '#2fa45f',
        // Kind palettes — forward-defined for the Milestone 2 Planner re-skin.
        kind: {
          focusBg: '#eaf2ff', focusBar: '#5b62e3', focusText: '#2f3aa8',
          meetingBg: '#fdeef0', meetingBar: '#e5484d', meetingText: '#a3262b',
          habitBg: '#eafaf1', habitBar: '#2fa45f', habitText: '#1c7a43',
          taskBg: '#fff5e9', taskBar: '#f2700f', taskText: '#a8500a',
        },
      },
      fontFamily: { sans: ['Mulish', 'system-ui', 'sans-serif'] },
      boxShadow: {
        card: '0 1px 2px rgba(20,22,40,.04)',
        pop: '0 14px 40px rgba(20,22,50,.16)',
        modal: '0 24px 60px rgba(20,22,50,.28)',
      },
      keyframes: {
        pop: { '0%': { opacity: '0', transform: 'translateY(8px) scale(.98)' }, '100%': { opacity: '1', transform: 'none' } },
        fade: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      animation: { pop: 'pop .14s ease-out', fade: 'fade .12s ease-out' },
    },
  },
  plugins: [],
};
