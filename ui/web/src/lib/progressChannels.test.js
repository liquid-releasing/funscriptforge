import { describe, it, expect } from 'vitest';
import {
  GLOBAL_PROGRESS_EVENT,
  OPS,
  progressChannel,
  parseProgressLine,
} from './progressChannels.js';

describe('progress channel names', () => {
  it('keeps the global channel name', () => {
    // App.jsx's always-mounted footer listener subscribes to this exact
    // string; renaming it silently kills the busy banner.
    expect(GLOBAL_PROGRESS_EVENT).toBe('ff:progress');
  });

  it('matches the Rust scoped_progress_event format exactly', () => {
    // Pinned on both sides — see progress_event_tests in commands.rs.
    expect(progressChannel('analyze')).toBe('ff:progress:analyze');
    expect(progressChannel('generate')).toBe('ff:progress:generate');
    expect(progressChannel('phrases')).toBe('ff:progress:phrases');
  });

  it('never produces the global channel from a scoped op', () => {
    // If a scoped name ever collided with the global one, every tab would
    // be back to hearing every operation with no visible symptom.
    for (const op of Object.values(OPS)) {
      expect(progressChannel(op)).not.toBe(GLOBAL_PROGRESS_EVENT);
    }
  });

  it('gives every operation a distinct channel', () => {
    const names = Object.values(OPS).map(progressChannel);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers all seven streaming commands', () => {
    // One per run_cli_with_progress call site in commands.rs. If a new
    // streaming command lands without an op here, this catches it.
    expect(Object.values(OPS).sort()).toEqual([
      'analyze', 'audio', 'export', 'generate', 'import', 'phrases', 'polish',
    ]);
  });
});

describe('parseProgressLine', () => {
  it('parses a start event', () => {
    expect(parseProgressLine('progress: start::2::audio_peaks')).toMatchObject({
      structured: true, kind: 'start', depth: 2, leaf: 'audio_peaks', rest: '',
    });
  });

  it('parses a done event with a summary', () => {
    expect(parseProgressLine('progress: done::2::detect::13 chapters detected'))
      .toMatchObject({ kind: 'done', depth: 2, leaf: 'detect', rest: '13 chapters detected' });
  });

  it('re-joins a summary that itself contains the separator', () => {
    // The Python side can emit a body containing `::`; splitting naively
    // would truncate the message at the first one.
    expect(parseProgressLine('progress: msg::3::extract::ratio 2::1').rest)
      .toBe('ratio 2::1');
  });

  it('works without the "progress: " prefix', () => {
    expect(parseProgressLine('start::2::detect')).toMatchObject({
      kind: 'start', depth: 2, leaf: 'detect',
    });
  });

  it('returns null for an empty payload', () => {
    expect(parseProgressLine('')).toBeNull();
    expect(parseProgressLine(null)).toBeNull();
    expect(parseProgressLine(undefined)).toBeNull();
    expect(parseProgressLine('progress: ')).toBeNull();
  });

  it('treats an unstructured line as depth 0 with the text as leaf', () => {
    // Polish and Export emit plain human-readable status lines; those tabs
    // pipe them straight to the footer.
    const p = parseProgressLine('progress: Polishing chapter 7 of 13');
    expect(p).toMatchObject({
      structured: false, depth: 0, leaf: 'Polishing chapter 7 of 13',
    });
    expect(p.line).toBe('Polishing chapter 7 of 13');
  });

  it('distinguishes structured from unstructured', () => {
    // This is exactly the distinction Polish/Export were making by hand
    // with `!line.includes("::")`.
    expect(parseProgressLine('done::2::detect').structured).toBe(true);
    expect(parseProgressLine('Writing stations…').structured).toBe(false);
  });

  it('defaults a non-numeric depth to 0 rather than NaN', () => {
    // NaN depth silently fails every `depth === 2` comparison, so a stage
    // would just never appear — the hardest kind of bug to see.
    expect(parseProgressLine('start::x::detect').depth).toBe(0);
  });

  it('tolerates a missing leaf', () => {
    expect(parseProgressLine('start::2').leaf).toBe('');
  });
});
