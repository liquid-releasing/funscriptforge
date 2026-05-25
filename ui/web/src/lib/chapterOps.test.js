import { describe, it, expect } from 'vitest';
import {
  CHAPTER_PALETTE,
  renumberChapters,
  chapterDisplayLabel,
  computeRemap,
  splitAt,
  joinAt,
} from './chapterOps.js';

// Fixture: 4 chapters of 10s each, IDs as-loaded ('chA'..'chD') to
// distinguish from the renumbered 'ch1'..'chN' that mutations produce.
const FIXTURE = [
  { id: 'chA', atMs: 0,     endMs: 10000, name: 'A', content_type: 'driving', color: '#aaa' },
  { id: 'chB', atMs: 10000, endMs: 20000, name: 'B', content_type: 'calm',    color: '#bbb' },
  { id: 'chC', atMs: 20000, endMs: 30000, name: 'C', content_type: 'varied',  color: '#ccc' },
  { id: 'chD', atMs: 30000, endMs: 40000, name: 'D', content_type: 'driving', color: '#ddd' },
];

describe('renumberChapters', () => {
  it('rewrites IDs to sequential ch1..chN', () => {
    const out = renumberChapters(FIXTURE);
    expect(out.map((c) => c.id)).toEqual(['ch1', 'ch2', 'ch3', 'ch4']);
  });

  it('assigns palette colors modular by index', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, atMs: 0, endMs: 1 }));
    const out = renumberChapters(ten);
    expect(out[0].color).toBe(CHAPTER_PALETTE[0]);
    expect(out[7].color).toBe(CHAPTER_PALETTE[7]);
    expect(out[8].color).toBe(CHAPTER_PALETTE[0]); // wraps
    expect(out[9].color).toBe(CHAPTER_PALETTE[1]);
  });

  it('preserves atMs / endMs / content_type', () => {
    const out = renumberChapters(FIXTURE);
    expect(out[2]).toMatchObject({ atMs: 20000, endMs: 30000, content_type: 'varied' });
  });
});

describe('chapterDisplayLabel', () => {
  it('formats as "NN · STYLE" when content_type present', () => {
    expect(chapterDisplayLabel({ content_type: 'driving' }, 0)).toBe('01 · DRIVING');
    expect(chapterDisplayLabel({ content_type: 'calm' }, 9)).toBe('10 · CALM');
  });

  it('falls back to padded index when no content_type', () => {
    expect(chapterDisplayLabel({}, 0)).toBe('01');
    expect(chapterDisplayLabel(null, 4)).toBe('05');
  });
});

describe('splitAt', () => {
  it('cuts the target chapter into two halves at the requested ms', () => {
    const result = splitAt(FIXTURE, 'chB', 15000);
    expect(result.ok).toBe(true);
    expect(result.chapters).toHaveLength(5);
    expect(result.chapters[1]).toMatchObject({ atMs: 10000, endMs: 15000 });
    expect(result.chapters[2]).toMatchObject({ atMs: 15000, endMs: 20000 });
  });

  it('both halves inherit content_type from the parent', () => {
    const result = splitAt(FIXTURE, 'chB', 15000);
    expect(result.chapters[1].content_type).toBe('calm');
    expect(result.chapters[2].content_type).toBe('calm');
  });

  it('renumbers all IDs sequentially after the split', () => {
    const result = splitAt(FIXTURE, 'chB', 15000);
    expect(result.chapters.map((c) => c.id)).toEqual(['ch1', 'ch2', 'ch3', 'ch4', 'ch5']);
  });

  it('remap routes both new halves back to the parent', () => {
    const result = splitAt(FIXTURE, 'chB', 15000);
    expect(result.remap.get('ch1')).toBe('chA');
    expect(result.remap.get('ch2')).toBe('chB');
    expect(result.remap.get('ch3')).toBe('chB'); // second half
    expect(result.remap.get('ch4')).toBe('chC');
    expect(result.remap.get('ch5')).toBe('chD');
  });

  it('newActiveIdx points at the second half', () => {
    const result = splitAt(FIXTURE, 'chB', 15000);
    expect(result.newActiveIdx).toBe(2);
    expect(result.chapters[result.newActiveIdx].atMs).toBe(15000);
  });

  it('rejects splits within minClearanceMs of the start boundary', () => {
    const result = splitAt(FIXTURE, 'chB', 10100); // 100ms past start
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-clearance');
  });

  it('rejects splits within minClearanceMs of the end boundary', () => {
    const result = splitAt(FIXTURE, 'chB', 19800); // 200ms before end
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-clearance');
  });

  it('honours custom minClearanceMs', () => {
    const tight = splitAt(FIXTURE, 'chB', 10100, { minClearanceMs: 50 });
    expect(tight.ok).toBe(true);
  });

  it('returns not-found for unknown chapter id', () => {
    const result = splitAt(FIXTURE, 'chZ', 5000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-found');
  });

  it('does not mutate input', () => {
    const before = JSON.stringify(FIXTURE);
    splitAt(FIXTURE, 'chB', 15000);
    expect(JSON.stringify(FIXTURE)).toBe(before);
  });

  it('splitting first chapter still maps correctly', () => {
    const result = splitAt(FIXTURE, 'chA', 5000);
    expect(result.ok).toBe(true);
    expect(result.remap.get('ch1')).toBe('chA');
    expect(result.remap.get('ch2')).toBe('chA');
    expect(result.remap.get('ch3')).toBe('chB');
    expect(result.newActiveIdx).toBe(1);
  });

  it('splitting last chapter still maps correctly', () => {
    const result = splitAt(FIXTURE, 'chD', 35000);
    expect(result.ok).toBe(true);
    expect(result.chapters).toHaveLength(5);
    expect(result.remap.get('ch4')).toBe('chD');
    expect(result.remap.get('ch5')).toBe('chD');
    expect(result.newActiveIdx).toBe(4);
  });
});

describe('joinAt prev', () => {
  it('merges target into its previous neighbour', () => {
    const result = joinAt(FIXTURE, 'chC', 'prev');
    expect(result.ok).toBe(true);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[1]).toMatchObject({ atMs: 10000, endMs: 30000 });
  });

  it('keeps the earlier chapter content_type (later is dropped)', () => {
    // chB is calm, chC is varied → merged should be calm
    const result = joinAt(FIXTURE, 'chC', 'prev');
    expect(result.chapters[1].content_type).toBe('calm');
  });

  it('remap routes the merged slot to the earlier chapter', () => {
    const result = joinAt(FIXTURE, 'chC', 'prev');
    expect(result.remap.get('ch1')).toBe('chA');
    expect(result.remap.get('ch2')).toBe('chB'); // earlier wins, chC dropped
    expect(result.remap.get('ch3')).toBe('chD');
  });

  it('newActiveIdx points at the merged chapter (earlier slot)', () => {
    const result = joinAt(FIXTURE, 'chC', 'prev');
    expect(result.newActiveIdx).toBe(1);
  });

  it('rejects when target has no previous neighbour', () => {
    const result = joinAt(FIXTURE, 'chA', 'prev');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-neighbor');
  });
});

describe('joinAt next', () => {
  it('merges target with its next neighbour', () => {
    const result = joinAt(FIXTURE, 'chB', 'next');
    expect(result.ok).toBe(true);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[1]).toMatchObject({ atMs: 10000, endMs: 30000 });
  });

  it('keeps the earlier (target) content_type, drops next', () => {
    const result = joinAt(FIXTURE, 'chB', 'next');
    expect(result.chapters[1].content_type).toBe('calm');
  });

  it('remap routes merged slot to the target (earlier)', () => {
    const result = joinAt(FIXTURE, 'chB', 'next');
    expect(result.remap.get('ch2')).toBe('chB');
    expect(result.remap.get('ch3')).toBe('chD');
  });

  it('newActiveIdx points at the target slot', () => {
    const result = joinAt(FIXTURE, 'chB', 'next');
    expect(result.newActiveIdx).toBe(1);
  });

  it('rejects when target has no next neighbour', () => {
    const result = joinAt(FIXTURE, 'chD', 'next');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-neighbor');
  });
});

describe('join + split round-trip', () => {
  it('split then re-join restores the boundary (state may not survive)', () => {
    // Split chB at 15000 then join the second half back into the first.
    // After split: ch1=chA, ch2=chB-first, ch3=chB-second, ch4=chC, ch5=chD
    // After join ch3 with prev: ch1=chA, ch2=(chB whole), ch3=chC, ch4=chD
    const s = splitAt(FIXTURE, 'chB', 15000);
    expect(s.ok).toBe(true);
    const j = joinAt(s.chapters, 'ch3', 'prev');
    expect(j.ok).toBe(true);
    expect(j.chapters).toHaveLength(4);
    expect(j.chapters[1]).toMatchObject({ atMs: 10000, endMs: 20000 });
  });
});

describe('computeRemap', () => {
  it('returns null for new positions that map outside oldChapters', () => {
    // Pretend posToOldIdx pretends a fresh chapter (no old source)
    const newChapters = [{ id: 'ch1' }, { id: 'ch2' }, { id: 'ch3' }];
    const remap = computeRemap(FIXTURE, newChapters, (idx) => (idx === 1 ? -1 : idx));
    expect(remap.get('ch1')).toBe('chA');
    expect(remap.get('ch2')).toBe(null);
    expect(remap.get('ch3')).toBe('chC');
  });
});
