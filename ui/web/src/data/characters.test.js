import { describe, it, expect } from 'vitest';
import { seedCharacterAssignments, backfillCharacterAssignments } from './characters.js';

const CH3 = [
  { id: 'a', atMs: 0, endMs: 10000 },
  { id: 'b', atMs: 10000, endMs: 20000 },
  { id: 'c', atMs: 20000, endMs: 30000 },
];

describe('seedCharacterAssignments', () => {
  it('seeds every chapter with character, params and mechStyle', () => {
    const seed = seedCharacterAssignments(CH3);
    expect(Object.keys(seed)).toEqual(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) {
      expect(seed[id].characterId).toBeTruthy();
      expect(seed[id].mechStyle).toBeTruthy();
      expect(Object.keys(seed[id].params).length).toBeGreaterThan(0);
    }
  });
});

describe('backfillCharacterAssignments', () => {
  it('is a no-op (changed=false) on a fully-seeded map', () => {
    const seed = seedCharacterAssignments(CH3);
    const { map, changed } = backfillCharacterAssignments(seed, CH3);
    expect(changed).toBe(false);
    expect(map).toEqual(seed);
  });

  it('fills a missing mechStyle (old sidecar) without touching the character', () => {
    const old = {
      a: { characterId: 'scene_builder', params: { foo: 1 } },        // no mechStyle
      b: { characterId: 'balanced', params: { foo: 2 }, mechStyle: 'Doggy' },
      c: { characterId: 'scene_closer', params: { foo: 3 } },         // no mechStyle
    };
    const { map, changed } = backfillCharacterAssignments(old, CH3);
    expect(changed).toBe(true);
    expect(map.a.characterId).toBe('scene_builder');   // preserved
    expect(map.a.params).toEqual({ foo: 1 });          // preserved
    expect(map.a.mechStyle).toBeTruthy();              // filled
    expect(map.b.mechStyle).toBe('Doggy');             // user value untouched
    expect(map.c.mechStyle).toBeTruthy();
  });

  it('fills a missing character + params from the seed', () => {
    const old = { a: { mechStyle: 'Cowgirl' } };       // no characterId/params
    const { map, changed } = backfillCharacterAssignments(old, CH3);
    expect(changed).toBe(true);
    expect(map.a.characterId).toBeTruthy();
    expect(Object.keys(map.a.params).length).toBeGreaterThan(0);
    expect(map.a.mechStyle).toBe('Cowgirl');           // preserved
  });

  it('seeds chapters that have no entry at all (added after the sidecar)', () => {
    const old = { a: seedCharacterAssignments(CH3).a };  // only chapter a saved
    const { map, changed } = backfillCharacterAssignments(old, CH3);
    expect(changed).toBe(true);
    expect(map.b.characterId).toBeTruthy();
    expect(map.c.mechStyle).toBeTruthy();
  });

  it('never mutates the input map', () => {
    const old = { a: { characterId: 'balanced', params: { foo: 1 } } };
    const snapshot = JSON.stringify(old);
    backfillCharacterAssignments(old, CH3);
    expect(JSON.stringify(old)).toBe(snapshot);
  });
});
