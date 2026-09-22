// FunscriptForge prototype — sample data + helpers (plain global script).
// Exposes window.FF (data) and window.FFShapes (passage/arc math).
(function () {
  // ── Passage / arc shape vocabulary (mirrors forge/passages.py) ──────────
  const PASSAGE_SHAPES = [
    { id: 'steady',  label: 'Steady',  glyph: '▄▄▄▄',  desc: 'No change — neutral hold.' },
    { id: 'build',   label: 'Build',   glyph: '▁▃▅▇',  desc: 'Rises from floor to ceiling.' },
    { id: 'sustain', label: 'Sustain', glyph: '▇▇▇▇',  desc: 'Holds at the ceiling.' },
    { id: 'release', label: 'Release', glyph: '▇▅▃▁',  desc: 'Eases ceiling → floor (wind-down).' },
    { id: 'swell',   label: 'Swell',   glyph: '▁▅▇▅▁', desc: 'Peaks in the middle, eases back.' },
  ];
  const SHAPE_BY_ID = Object.fromEntries(PASSAGE_SHAPES.map((s) => [s.id, s]));

  // multiplier at fractional position frac (0..1) along a span
  function shapeFactor(shape, frac, floor, ceiling) {
    const f = Math.max(0, Math.min(1, frac));
    const lo = floor, hi = ceiling;
    switch ((shape || 'steady').toLowerCase()) {
      case 'steady':  return (lo + hi) / 2;
      case 'sustain': return hi;
      case 'build':   return lo + (hi - lo) * f;
      case 'release': return hi - (hi - lo) * f;
      case 'swell':   return lo + (hi - lo) * (1 - Math.abs(2 * f - 1));
      default:        return (lo + hi) / 2;
    }
  }

  // ── Characters (the "type / feel" per section) ──────────────────────────
  const CHARACTERS = [
    { id: 'gentle',        label: 'Gentle',        color: '#4dabf7', tagline: 'Soft, slow-building' },
    { id: 'reactive',      label: 'Reactive',      color: '#ff5470', tagline: 'Sharp, tracks every stroke' },
    { id: 'scene_builder', label: 'Scene Builder', color: '#3ed598', tagline: 'Builds gradually' },
    { id: 'unpredictable', label: 'Unpredictable', color: '#ffb547', tagline: 'Random direction changes' },
    { id: 'balanced',      label: 'Balanced',      color: '#c77dff', tagline: 'Middle of everything' },
    { id: 'scene_closer',  label: 'Scene Closer',  color: '#ff8e72', tagline: 'Winds the scene down' },
  ];
  const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

  // ── deterministic PRNG so the sample is stable across reloads ───────────
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DURATION_MS = 634000; // Big Buck Bunny ≈ 10:34

  // Intensity arc (0..1) over normalized time — a believable journey:
  // slow open, two builds, a mid plateau, a climax, then a wind-down.
  function arcAt(t) {
    const a =
      0.30 +
      0.34 * Math.pow(t, 0.8) +                       // overall build
      0.16 * Math.sin(t * Math.PI * 2.0 - 0.6) +      // two swells
      0.10 * Math.sin(t * Math.PI * 6.0);             // texture
    const climax = 0.22 * Math.exp(-Math.pow((t - 0.82) / 0.06, 2)); // climax bump
    const tail = t > 0.93 ? -0.45 * (t - 0.93) / 0.07 : 0;           // afterglow
    return Math.max(0.05, Math.min(1, a + climax + tail));
  }

  // Synthesize a funscript: position oscillation whose BPM + amplitude track
  // the intensity arc. ~ down to ~1100 points (already viewer-friendly).
  function buildFunscript() {
    const rnd = mulberry32(20260613);
    const actions = [];
    let tMs = 0;
    let up = true;
    while (tMs < DURATION_MS) {
      const t = tMs / DURATION_MS;
      const energy = arcAt(t);
      const bpm = 36 + energy * 150;                 // 36 → ~186 bpm
      const halfPeriod = 60000 / bpm / 2;
      const amp = 28 + energy * 64;                  // stroke depth
      const center = 50 + (rnd() - 0.5) * 8;
      const pos = up ? center + amp / 2 : center - amp / 2;
      actions.push({ at: Math.round(tMs), pos: Math.max(0, Math.min(100, Math.round(pos))) });
      const jitter = 1 + (rnd() - 0.5) * 0.18;
      tMs += halfPeriod * jitter;
      up = !up;
    }
    return actions;
  }

  const ACTIONS = buildFunscript();

  // energy samples for heatmaps (256 buckets)
  function buildEnergy(n) {
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(arcAt(i / (n - 1)));
    return out;
  }
  const ENERGY = buildEnergy(256);

  // ── Default sections the user can edit on the Generate timeline ─────────
  // Times in ms. These ARE the chapter substrate once accepted.
  function mkSection(id, beginMs, endMs, shape, characterId, label) {
    return { id, beginMs, endMs, shape, characterId, label,
             floor: 0.3, ceiling: 0.85 };
  }
  const D = DURATION_MS;
  const SECTIONS = [
    mkSection('s1', 0,            0.10 * D, 'build',   'scene_builder', 'Open'),
    mkSection('s2', 0.10 * D,     0.30 * D, 'sustain', 'gentle',        'Settle'),
    mkSection('s3', 0.30 * D,     0.52 * D, 'build',   'balanced',      'Rise'),
    mkSection('s4', 0.52 * D,     0.70 * D, 'swell',   'reactive',      'Swell'),
    mkSection('s5', 0.70 * D,     0.88 * D, 'build',   'reactive',      'Climb'),
    mkSection('s6', 0.88 * D,     0.95 * D, 'sustain', 'reactive',      'Peak'),
    mkSection('s7', 0.95 * D,     D,        'release', 'scene_closer',  'Afterglow'),
  ].map((s) => ({ ...s, beginMs: Math.round(s.beginMs), endMs: Math.round(s.endMs) }));

  // Library entries (sample + a couple of recents for the grid)
  const LIBRARY = [
    { id: 'bbb', title: 'big_buck_bunny', duration: '10:34', durationMs: D,
      mediaKind: 'video', sections: SECTIONS.length, edited: 'just now',
      hasFunscript: true, color: '#ff8c42', note: 'bundled sample' },
    { id: 'euph', title: 'Euphoria2', duration: '24:12', durationMs: 1452000,
      mediaKind: 'video', sections: 0, edited: '2 days ago', hasFunscript: false,
      color: '#4dabf7', note: 'video only — no script yet' },
    { id: 'tl1', title: 'Timeline1', duration: '06:48', durationMs: 408000,
      mediaKind: 'video', sections: 9, edited: 'last week', hasFunscript: true,
      color: '#3ed598' },
    { id: 'pris', title: 'Prisoner', duration: '18:03', durationMs: 1083000,
      mediaKind: 'audio', sections: 14, edited: 'last month', hasFunscript: true,
      color: '#c77dff' },
  ];

  const SAMPLE_PROJECT = {
    id: 'bbb',
    title: 'big_buck_bunny',
    path: 'sample://demo/big_buck_bunny.funscript',
    mediaPath: 'sample://demo/big_buck_bunny.mov',
    mediaKind: 'video',
    duration: '10:34',
    durationMs: D,
    actionCount: ACTIONS.length,
    actions: ACTIONS,
    avgSpeed: 312,
    minPos: 4,
    maxPos: 98,
    sections: SECTIONS,
    hasFunscript: true,
  };

  function fmtTime(ms) {
    if (ms == null || isNaN(ms)) return '0:00';
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  window.FF = {
    DURATION_MS, ACTIONS, ENERGY, SECTIONS, LIBRARY, SAMPLE_PROJECT,
    CHARACTERS, CHAR_BY_ID, fmtTime, arcAt, mkSection,
    // axis-changer lane defaults (control points: {t:0..1, v:0..1})
    DEFAULT_DEPTH: [{ t: 0, v: 0.34 }, { t: 0.5, v: 0.62 }, { t: 0.85, v: 0.9 }, { t: 1, v: 0.7 }],
    DEFAULT_DENSITY: [{ t: 0, v: 0.28 }, { t: 0.5, v: 0.5 }, { t: 0.85, v: 0.92 }, { t: 1, v: 0.42 }],
  };
  window.FFShapes = { PASSAGE_SHAPES, SHAPE_BY_ID, shapeFactor };
})();
