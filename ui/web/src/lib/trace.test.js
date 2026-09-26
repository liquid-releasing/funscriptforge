import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The gate's whole job is to be OFF by default and to never throw. Both are
// easy to get wrong in a way no other test would notice: tracing that defaults
// on buries real warnings, and a localStorage read that throws in a private
// window would take the render down with it.

function withStorage(store) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: store, configurable: true, writable: true,
  });
}

function fakeStorage(initial = {}) {
  const map = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    _map: map,
  };
}

/** trace.js caches the flag at import, so each case needs a fresh module. */
async function freshTrace() {
  vi.resetModules();
  return import('./trace.js');
}

let logged;
beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => logged.push(a));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('off by default', () => {
  it('★ logs nothing when the flag was never set', async () => {
    withStorage(fakeStorage());
    const { trace, traceEnabled } = await freshTrace();
    expect(traceEnabled()).toBe(false);
    trace('should not appear');
    expect(logged).toEqual([]);
  });

  it('is not switched on by any other stored value', async () => {
    withStorage(fakeStorage({ 'ff.trace': 'true' }));
    const { traceEnabled } = await freshTrace();
    expect(traceEnabled()).toBe(false);   // only the literal '1'
  });
});

describe('enabled', () => {
  it('logs under the [ff-trace] prefix once the flag is set', async () => {
    withStorage(fakeStorage({ 'ff.trace': '1' }));
    const { trace, traceEnabled } = await freshTrace();
    expect(traceEnabled()).toBe(true);
    trace('ops after begin', 'app#1');
    expect(logged).toEqual([['[ff-trace]', 'ops after begin', 'app#1']]);
  });

  it('setTrace flips it live and persists, so no rebuild is needed', async () => {
    const store = fakeStorage();
    withStorage(store);
    const { trace, setTrace, traceEnabled } = await freshTrace();

    expect(setTrace(true)).toBe(true);
    expect(traceEnabled()).toBe(true);
    expect(store._map['ff.trace']).toBe('1');
    trace('now visible');
    expect(logged).toHaveLength(1);

    expect(setTrace(false)).toBe(false);
    expect(store._map['ff.trace']).toBeUndefined();
    trace('silent again');
    expect(logged).toHaveLength(1);
  });

  it('exposes window.ffTrace so a stuck app can be instrumented', async () => {
    // This suite runs in the node environment, which has no `window` -- the
    // module's own `typeof window !== 'undefined'` guard is what keeps it
    // importable here at all, so the test has to supply one.
    withStorage(fakeStorage());
    Object.defineProperty(globalThis, 'window', {
      value: {}, configurable: true, writable: true,
    });
    const { setTrace } = await freshTrace();
    expect(globalThis.window.ffTrace).toBe(setTrace);
    delete globalThis.window;
  });
});

describe('★ hostile storage', () => {
  it('stays off rather than throwing when getItem throws', async () => {
    // A private window, or site data blocked. A diagnostic flag must never be
    // the reason a screen fails to render.
    withStorage({ getItem: () => { throw new Error('denied'); } });
    const { traceEnabled } = await freshTrace();
    expect(traceEnabled()).toBe(false);
  });

  it('still traces for this session when setItem throws', async () => {
    withStorage({
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
    });
    const { trace, setTrace } = await freshTrace();
    expect(setTrace(true)).toBe(true);    // not persisted, but live
    trace('visible');
    expect(logged).toHaveLength(1);
  });
});
