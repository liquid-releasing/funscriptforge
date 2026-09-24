import { describe, it, expect } from 'vitest';
import { resolveMonitorFunscript } from './monitorChannel.js';

const A = [{ at: 0, pos: 10 }, { at: 250, pos: 90 }];
const CHANNELS = [
  { name: 'alpha', actions: [{ at: 0, pos: 50 }] },
  { name: 'beta', actions: [{ at: 0, pos: 60 }] },
  { name: 'frequency', actions: [{ at: 0, pos: 70 }] },
];

describe('resolveMonitorFunscript', () => {
  it('prefers the full-resolution fetch', () => {
    const r = resolveMonitorFunscript(A, CHANNELS, 'frequency');
    expect(r.actions).toBe(A);
    expect(r.provisional).toBe(false);
  });

  it('falls back to the SAME channel\'s decimated lane, flagged provisional', () => {
    const r = resolveMonitorFunscript([], CHANNELS, 'frequency');
    expect(r.actions).toBe(CHANNELS[2].actions);
    expect(r.provisional).toBe(true);
  });

  it('★ never substitutes a different channel', () => {
    // The bug: `|| channels[0]` meant an unresolved name rendered alpha's
    // curve while the label still said the selected channel. Frequency and
    // volume are both smooth, so the wrong one looks entirely plausible —
    // there is no way for the user to catch it.
    const r = resolveMonitorFunscript([], CHANNELS, 'volume-prostate');
    expect(r.actions).toEqual([]);
    expect(r.actions).not.toBe(CHANNELS[0].actions);
  });

  it('★ shows nothing rather than the wrong signal when nothing is selected', () => {
    expect(resolveMonitorFunscript([], CHANNELS, null).actions).toEqual([]);
    expect(resolveMonitorFunscript([], CHANNELS, undefined).actions).toEqual([]);
    expect(resolveMonitorFunscript([], CHANNELS, '').actions).toEqual([]);
  });

  it('handles an empty or missing channel list', () => {
    expect(resolveMonitorFunscript([], [], 'alpha').actions).toEqual([]);
    expect(resolveMonitorFunscript([], null, 'alpha').actions).toEqual([]);
    expect(resolveMonitorFunscript(null, null, null).actions).toEqual([]);
  });

  it('treats a present-but-empty lane as nothing to show', () => {
    const channels = [{ name: 'alpha', actions: [] }];
    const r = resolveMonitorFunscript([], channels, 'alpha');
    expect(r.actions).toEqual([]);
    expect(r.provisional).toBe(false);
  });

  it('tolerates a malformed channel entry', () => {
    const channels = [null, { name: 'alpha' }, { actions: A }];
    expect(resolveMonitorFunscript([], channels, 'alpha').actions).toEqual([]);
  });

  it('a non-array full-res result does not win over the lane', () => {
    const r = resolveMonitorFunscript(undefined, CHANNELS, 'beta');
    expect(r.actions).toBe(CHANNELS[1].actions);
    expect(r.provisional).toBe(true);
  });
});
