import { describe, it, expect } from 'vitest';
import { applyStageEvent, runningStages } from './progressStages.js';
import { parseProgressLine, progressChannel, OPS } from './progressChannels.js';

const ev = (line) => parseProgressLine(line);

describe('applyStageEvent', () => {
  it('marks a stage running on start', () => {
    expect(applyStageEvent({}, ev('start::2::audio_peaks')))
      .toEqual({ audio_peaks: 'running' });
  });

  it('marks a stage done on done', () => {
    expect(applyStageEvent({ audio_peaks: 'running' }, ev('done::2::audio_peaks')))
      .toEqual({ audio_peaks: 'done' });
  });

  it('ignores the depth-1 command wrapper', () => {
    const before = {};
    expect(applyStageEvent(before, ev('start::1::structural.auto_chapter'))).toBe(before);
  });

  it('ignores depth-3 sub-stages', () => {
    const before = { detect: 'running' };
    expect(applyStageEvent(before, ev('start::3::extract'))).toBe(before);
  });

  it('ignores a null parse', () => {
    const before = { detect: 'running' };
    expect(applyStageEvent(before, null)).toBe(before);
  });

  it('returns the same reference when nothing changes', () => {
    const before = { detect: 'running' };
    expect(applyStageEvent(before, ev('start::2::detect'))).toBe(before);
  });

  it('keeps other stages untouched', () => {
    expect(applyStageEvent({ a: 'done' }, ev('start::2::b')))
      .toEqual({ a: 'done', b: 'running' });
  });
});

describe('runningStages', () => {
  it('lists only the stages that started without finishing', () => {
    expect(runningStages({ a: 'done', b: 'running', c: 'done' })).toEqual(['b']);
  });

  it('is empty for an empty map', () => {
    expect(runningStages({})).toEqual([]);
    expect(runningStages(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The regression this whole change exists for.
//
// A minimal stand-in for Tauri's event bus: emit(name, payload) reaches only
// the handlers registered for that exact name — which is what Tauri does, and
// is the property the fix depends on.
function makeBus() {
  const handlers = new Map();
  return {
    listen(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) {
      for (const fn of handlers.get(name) ?? []) fn({ payload });
    },
  };
}

// What Rust does for one run: every line goes to the global channel AND to
// this operation's own channel. Mirrors run_cli_with_progress.
function emitRun(bus, op, lines) {
  for (const line of lines) {
    bus.emit('ff:progress', line);
    bus.emit(progressChannel(op), line);
  }
}

describe('operation scoping (regression: "stuck in assessing phrases")', () => {
  // Subscribe the way AnalysisTab does now, and track its stage map.
  function mountAnalysisTab(bus) {
    let stages = {};
    const offs = [OPS.ANALYZE, OPS.AUDIO, OPS.PHRASES].map((op) =>
      bus.listen(progressChannel(op), (e) => {
        stages = applyStageEvent(stages, parseProgressLine(e.payload));
      }));
    return { get: () => stages, unmount: () => offs.forEach((f) => f()) };
  }

  // The OLD behaviour, for contrast: one listener on the global channel.
  function mountGlobalListener(bus) {
    let stages = {};
    const off = bus.listen('ff:progress', (e) => {
      stages = applyStageEvent(stages, parseProgressLine(e.payload));
    });
    return { get: () => stages, unmount: off };
  }

  it('OLD: a generate left a stage running in the analysis stage map', () => {
    // This is the bug, reproduced. The generate opens `chapters_sidecar`
    // and closes it, but if the tab only sees part of another run's stream
    // — here, the start without the done — the stage hangs forever.
    const bus = makeBus();
    const tab = mountGlobalListener(bus);
    emitRun(bus, OPS.GENERATE, ['progress: start::2::chapters_sidecar']);
    expect(runningStages(tab.get())).toEqual(['chapters_sidecar']);
  });

  it('NEW: a generate cannot touch the analysis stage map at all', () => {
    const bus = makeBus();
    const tab = mountAnalysisTab(bus);
    emitRun(bus, OPS.GENERATE, [
      'progress: start::2::chapters_sidecar',
      'progress: start::2::sidecar',
    ]);
    expect(tab.get()).toEqual({});
    expect(runningStages(tab.get())).toEqual([]);
  });

  it('NEW: the tab still tracks its own operations', () => {
    const bus = makeBus();
    const tab = mountAnalysisTab(bus);
    emitRun(bus, OPS.ANALYZE, [
      'progress: start::2::audio_peaks',
      'progress: done::2::audio_peaks',
      'progress: start::2::detect',
    ]);
    expect(tab.get()).toEqual({ audio_peaks: 'done', detect: 'running' });
  });

  it('NEW: phrases (assess) still reaches the tab — it owns that op', () => {
    // The user's report named this operation by name, so pin it.
    const bus = makeBus();
    const tab = mountAnalysisTab(bus);
    emitRun(bus, OPS.PHRASES, ['progress: start::2::assess', 'progress: done::2::assess']);
    expect(tab.get()).toEqual({ assess: 'done' });
  });

  it('NEW: interleaved runs no longer corrupt each other', () => {
    // The realistic case: an assess is still streaming when a generate
    // starts. Previously both wrote into the same map.
    const bus = makeBus();
    const tab = mountAnalysisTab(bus);
    emitRun(bus, OPS.PHRASES, ['progress: start::2::assess']);
    emitRun(bus, OPS.GENERATE, ['progress: start::2::assess', 'progress: done::2::assess']);
    // The generate's `done` must NOT close the assess run's stage.
    expect(runningStages(tab.get())).toEqual(['assess']);
    emitRun(bus, OPS.PHRASES, ['progress: done::2::assess']);
    expect(runningStages(tab.get())).toEqual([]);
  });

  it('the global channel still carries everything, for the busy footer', () => {
    // App.jsx's always-mounted listener must keep seeing every operation —
    // scoping must not have made the app-wide banner selective.
    const bus = makeBus();
    const footer = mountGlobalListener(bus);
    emitRun(bus, OPS.EXPORT, ['progress: start::2::packaging']);
    emitRun(bus, OPS.ANALYZE, ['progress: start::2::detect']);
    expect(Object.keys(footer.get()).sort()).toEqual(['detect', 'packaging']);
  });

  it('unmounting removes every one of the tab\'s listeners', () => {
    // Three listeners now, not one — a partial teardown would keep firing
    // handlers against unmounted state.
    const bus = makeBus();
    const tab = mountAnalysisTab(bus);
    tab.unmount();
    emitRun(bus, OPS.ANALYZE, ['progress: start::2::detect']);
    emitRun(bus, OPS.AUDIO, ['progress: start::2::audio_peaks']);
    emitRun(bus, OPS.PHRASES, ['progress: start::2::assess']);
    expect(tab.get()).toEqual({});
  });
});
