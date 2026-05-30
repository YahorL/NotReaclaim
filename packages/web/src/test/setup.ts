import '@testing-library/jest-dom/vitest';

// Make window.location.assign spy-able in jsdom (it is non-configurable by default).
Object.defineProperty(window, 'location', {
  value: {
    ...window.location,
    assign: window.location.assign.bind(window.location),
  },
  writable: true,
  configurable: true,
});
