import "@testing-library/jest-dom/vitest";

// jsdom has no IntersectionObserver (used by AppPicker for lazy icon loading).
// This stub never reports intersection, so icons stay as placeholders in tests.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

Object.defineProperty(globalThis, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: IntersectionObserverStub,
});
