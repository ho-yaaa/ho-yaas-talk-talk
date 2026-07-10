import '@testing-library/jest-dom/vitest';

Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => Math.random().toString(36).slice(2),
  },
});
