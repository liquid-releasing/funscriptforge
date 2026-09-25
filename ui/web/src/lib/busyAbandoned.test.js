import { describe, it, expect } from 'vitest';
import { applyBusyUpdate, isBusyAbandoned } from './busyOwner.js';

// ★ The invariant: a busy banner must never outlive the work it describes.
//
// Ownership alone does not give that. It stops a late-landing operation from
// wiping someone else's banner, but nothing guarantees a banner is ever
// cleared. Observed twice during dogfooding on 2026-09-25, both ending in an
// app restart: the footer read "in progress" on every tab while nothing was
// running and the work had already finished on disk.

describe('two owned producers can strand the banner', () => {
  it('reproduces the interleaving that wedged it', () => {
    // Chapters starts an analyze.
    let busy = applyBusyUpdate(null, { message: 'Analyzing chapters…' }, 'chapters');
    // The user moves to Events, whose own load takes the banner over.
    busy = applyBusyUpdate(busy, { message: 'Loading events…' }, 'events');
    // Chapters' work lands and clears — refused, it no longer owns it.
    busy = applyBusyUpdate(busy, null, 'chapters');
    expect(busy).not.toBeNull();
    // Events finishes and clears its own. This one works...
    busy = applyBusyUpdate(busy, null, 'events');
    expect(busy).toBeNull();
  });

  it('★ but the reverse order strands it for good', () => {
    // Events sets the banner first, then Chapters' in-flight analyze
    // re-takes it on its next progress update.
    let busy = applyBusyUpdate(null, { message: 'Loading events…' }, 'events');
    busy = applyBusyUpdate(busy, { message: 'Detecting phrases…' }, 'chapters');
    // Events finishes and clears — refused, Chapters owns it now.
    busy = applyBusyUpdate(busy, null, 'events');
    expect(busy).not.toBeNull();
    // And Chapters never clears, because its Promise never settled. Without
    // the release below, this banner is up until the app restarts.
    expect(busy.message).toBe('Detecting phrases…');
  });
});

describe('isBusyAbandoned', () => {
  const STALL = 180000;

  it('releases a banner that has gone silent', () => {
    const prev = { message: 'Detecting phrases…', owner: 'chapters', startedAt: 0 };
    expect(isBusyAbandoned(prev, { lastProgressAt: 0, now: STALL, stallMs: STALL }))
      .toBe(true);
  });

  it('★ leaves a banner alone while progress keeps arriving', () => {
    // The whole point: long work must not be released mid-flight.
    const prev = { message: 'Analyzing chapters…', owner: 'chapters', startedAt: 0 };
    expect(isBusyAbandoned(prev, {
      lastProgressAt: 9_000_000, now: 9_000_001, stallMs: STALL,
    })).toBe(false);
  });

  it('falls back to startedAt when no event has ever arrived', () => {
    // A command that dies before emitting anything still has a baseline.
    const prev = { message: 'Analyzing…', owner: 'analysis', startedAt: 1000 };
    expect(isBusyAbandoned(prev, { lastProgressAt: 0, now: 1000 + STALL, stallMs: STALL }))
      .toBe(true);
    expect(isBusyAbandoned(prev, { lastProgressAt: 0, now: 1000 + STALL - 1, stallMs: STALL }))
      .toBe(false);
  });

  it('never fires without a banner or without timestamps', () => {
    expect(isBusyAbandoned(null, { lastProgressAt: 0, now: 1e9, stallMs: STALL }))
      .toBe(false);
    const prev = { message: 'x', owner: 'a' };   // no startedAt, no events
    expect(isBusyAbandoned(prev, { lastProgressAt: 0, now: 1e9, stallMs: STALL }))
      .toBe(false);
    expect(isBusyAbandoned({ ...prev, startedAt: 0 }, { lastProgressAt: 0, now: null, stallMs: STALL }))
      .toBe(false);
  });

  it('★ resolves the stranded case above', () => {
    let busy = applyBusyUpdate(null, { message: 'Loading events…', startedAt: 0 }, 'events');
    busy = applyBusyUpdate(busy, { message: 'Detecting phrases…', startedAt: 0 }, 'chapters');
    busy = applyBusyUpdate(busy, null, 'events');
    expect(busy).not.toBeNull();
    expect(isBusyAbandoned(busy, { lastProgressAt: 0, now: STALL, stallMs: STALL }))
      .toBe(true);
  });
});
