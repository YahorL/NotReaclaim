import '@testing-library/jest-dom/vitest';

// jsdom does not implement PointerEvent, so @testing-library fireEvent.pointerDown/Move/Up
// fall back to a plain Event with no clientY.  Polyfill a minimal PointerEvent that extends
// MouseEvent (which jsdom does support and which carries clientX/clientY).
if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).PointerEvent = PointerEventPolyfill;
}

// jsdom marks window.location.assign/replace/reload as non-configurable, so
// vi.spyOn(window.location, 'assign') throws "Cannot redefine property". Replace
// window.location with a configurable plain object that delegates reads to the real
// location (preserving href/protocol/host/etc.) while exposing spy-able no-op
// navigation methods.
const realLocation = window.location;
Object.defineProperty(window, 'location', {
  configurable: true,
  writable: true,
  value: {
    get href() { return realLocation.href; },
    get protocol() { return realLocation.protocol; },
    get host() { return realLocation.host; },
    get hostname() { return realLocation.hostname; },
    get port() { return realLocation.port; },
    get origin() { return realLocation.origin; },
    get pathname() { return realLocation.pathname; },
    get search() { return realLocation.search; },
    get hash() { return realLocation.hash; },
    assign() {},
    replace() {},
    reload() {},
    toString() { return realLocation.href; },
  },
});
