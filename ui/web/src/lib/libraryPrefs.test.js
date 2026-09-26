import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadLibraryPrefs, saveLibraryPrefs, reconcileActiveRoot, DEFAULT_PREFS,
} from './libraryPrefs.js';

const KEY = 'ff.library.prefs.v1';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

describe('library prefs round-trip', () => {
  let original;
  beforeEach(() => { original = globalThis.localStorage; });
  afterEach(() => {
    if (original === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', {
      value: original, configurable: true, writable: true,
    });
  });

  const installStorage = (s) => Object.defineProperty(globalThis, 'localStorage', {
    value: s, configurable: true, writable: true,
  });

  it('remembers the chosen root across a remount', () => {
    const s = fakeStorage();
    installStorage(s);
    saveLibraryPrefs({ activeRootPath: 'D:/lib', statusFilter: 'ready', sortKey: 'name' });
    expect(loadLibraryPrefs()).toEqual({
      activeRootPath: 'D:/lib', statusFilter: 'ready', sortKey: 'name',
    });
  });

  it('defaults to all roots on first run', () => {
    installStorage(fakeStorage());
    expect(loadLibraryPrefs()).toEqual(DEFAULT_PREFS);
    expect(loadLibraryPrefs().activeRootPath).toBe(null);
  });

  it('★ survives corrupt or hostile stored data', () => {
    // A screen that throws on mount because storage held junk is worse than
    // one that forgets a preference.
    for (const junk of ['{not json', 'null', '"a string"', '[]', '42']) {
      installStorage(fakeStorage({ [KEY]: junk }));
      expect(() => loadLibraryPrefs()).not.toThrow();
      expect(loadLibraryPrefs().statusFilter).toBe(DEFAULT_PREFS.statusFilter);
    }
  });

  it('ignores wrong-typed fields rather than passing them through', () => {
    installStorage(fakeStorage({
      [KEY]: JSON.stringify({ activeRootPath: 42, statusFilter: [], sortKey: {} }),
    }));
    expect(loadLibraryPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('★ never throws when storage itself is unavailable', () => {
    // Private windows and blocked site data make the ACCESSOR throw, not just
    // return empty.
    installStorage({
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    });
    expect(loadLibraryPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => saveLibraryPrefs({ activeRootPath: 'D:/lib' })).not.toThrow();
  });

  it('tolerates no localStorage at all', () => {
    delete globalThis.localStorage;
    expect(loadLibraryPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => saveLibraryPrefs({ activeRootPath: 'x' })).not.toThrow();
  });
});

describe('reconcileActiveRoot', () => {
  it('restores a root that is still configured', () => {
    expect(reconcileActiveRoot('D:/lib', ['D:/lib', 'E:/other'])).toBe('D:/lib');
  });

  it('★ falls back to all roots when the remembered one is gone', () => {
    // The user removed it, or it is an external drive that is not mounted
    // today. Selecting a root with no scan behind it renders an EMPTY library
    // with no explanation — showing everything is the honest fallback.
    expect(reconcileActiveRoot('D:/removed', ['E:/other'])).toBe(null);
    expect(reconcileActiveRoot('D:/removed', [])).toBe(null);
  });

  it('handles no remembered root and malformed config', () => {
    expect(reconcileActiveRoot(null, ['D:/lib'])).toBe(null);
    expect(reconcileActiveRoot('D:/lib', null)).toBe(null);
    expect(reconcileActiveRoot('D:/lib', undefined)).toBe(null);
  });
});
