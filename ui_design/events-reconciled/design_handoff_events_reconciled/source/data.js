// Events tab — RECONCILED prototype data.
// Taxonomy matches the screenshots the user pointed at:
//   • Device classes (left-library tabs):  Estim / Vibrator / bHaptics / Shaker
//   • Effect categories (the bottom-timeline legend): Buzz / Stroke / Control / Shape
//   • Recipes = named compositions, each with a preview shape, intensity,
//     tunable params, per-device overrides — same contract as events_tab.
// Chapters double as the four "Acts". The chapter picked at the top scopes
// the entire work area below it.

// ─── Effect categories (legend colors) ─────────────────────────────
window.RX_CATS = {
  buzz:    { id: "buzz",    label: "Buzz",    accent: "#ff5a5a" }, // vibration / pulse
  stroke:  { id: "stroke",  label: "Stroke",  accent: "#4dabf7" }, // motion / position
  control: { id: "control", label: "Control", accent: "#eab308" }, // baseline / erase / hold
  shape:   { id: "shape",   label: "Shape",   accent: "#c77dff" }, // envelope shaping
};

// ─── Device classes (left-library tabs) ────────────────────────────
window.RX_DEVICES = [
  { id: "estim",    label: "Estim"    },
  { id: "vibrator", label: "Vibrator" },
  { id: "bhaptics", label: "bHaptics" },
  { id: "shaker",   label: "Shaker"   },
];

// ─── Recipes ────────────────────────────────────────────────────────
// devices: which device classes this recipe is available on.
// compose: additive | replace.  isBaseline = control-family eraser-ish.
window.RX_RECIPES = [
  // ── Buzz ──────────────────────────────────────────────────────────
  { id: "surge", label: "Surge", cat: "buzz", devices: ["estim","vibrator","shaker"],
    desc: "Release crescendo — high pulse, slow throb out.",
    nsfw: "Slow ramp into a sustained throb, then a long melt-down. Big finish energy.",
    compose: "additive", intensity: 0.85,
    tunables: [
      { key: "ramp_in",  label: "Ramp in",  min: 200, max: 4000, step: 100, default: 800,  unit: "ms" },
      { key: "throb",    label: "Throb",    min: 0.5, max: 4,    step: 0.1, default: 1.5,  unit: "Hz" },
      { key: "ramp_out", label: "Ramp out", min: 500, max: 8000, step: 100, default: 2500, unit: "ms" },
    ],
    preview: [0.10,0.18,0.30,0.42,0.55,0.68,0.78,0.85,0.82,0.85,0.78,0.82,0.85,0.80,0.78,0.72,0.65,0.55,0.46,0.38,0.30,0.22,0.16,0.12] },
  { id: "edge", label: "Edge", cat: "buzz", devices: ["estim","vibrator"],
    desc: "Tension build — pulse ramp with 10Hz volume buzz.",
    nsfw: "Quick pulse ramp held right at the threshold — takes them to the brink and keeps them there.",
    compose: "additive", intensity: 0.70,
    tunables: [
      { key: "tremor",  label: "Tremor",  min: 1,  max: 20,  step: 0.5,  default: 10,   unit: "Hz" },
      { key: "amount",  label: "Amount",  min: 0,  max: 1,   step: 0.05, default: 0.30, unit: ""   },
      { key: "ramp_up", label: "Ramp up", min: 50, max: 1500,step: 50,   default: 250,  unit: "ms" },
    ],
    preview: [0.15,0.28,0.42,0.55,0.70,0.62,0.78,0.65,0.82,0.68,0.85,0.72,0.88,0.74,0.85,0.71,0.82,0.68,0.78,0.62,0.72,0.55,0.65,0.48] },
  { id: "hold", label: "Hold", cat: "buzz", devices: ["estim","vibrator","bhaptics"],
    desc: "Locked high pulse with subtle 15Hz hum.",
    nsfw: "A locked, unrelenting high pulse — no escalation, no relief.",
    compose: "additive", intensity: 0.78,
    tunables: [
      { key: "level", label: "Level", min: 0.4, max: 1, step: 0.02, default: 0.78, unit: "" },
      { key: "hum",   label: "Hum",   min: 5,   max: 30, step: 1,   default: 15,   unit: "Hz" },
    ],
    preview: [0.70,0.72,0.78,0.74,0.80,0.76,0.82,0.78,0.80,0.79,0.81,0.78,0.80,0.79,0.81,0.78,0.80,0.79,0.81,0.78,0.80,0.79,0.78,0.76] },
  { id: "tease", label: "Tease", cat: "buzz", devices: ["estim","vibrator","shaker"],
    desc: "Light flutter with held breath. Anticipation.",
    nsfw: "Feather-light flutter that backs off the instant they lean in. Pure anticipation.",
    compose: "additive", intensity: 0.45,
    tunables: [
      { key: "flutter", label: "Flutter", min: 1, max: 15, step: 0.5,  default: 6,    unit: "Hz" },
      { key: "amount",  label: "Amount",  min: 0, max: 1,  step: 0.05, default: 0.15, unit: ""   },
    ],
    preview: [0.25,0.35,0.30,0.40,0.32,0.42,0.34,0.44,0.36,0.46,0.34,0.44,0.32,0.42,0.34,0.44,0.36,0.46,0.38,0.48,0.36,0.46,0.34,0.42] },
  { id: "climax", label: "Climax", cat: "buzz", devices: ["estim","vibrator","shaker","bhaptics"],
    desc: "Hard crescendo, peak intensity. The moment.",
    nsfw: "Everything at once, peaked and held — saved for the single biggest moment.",
    compose: "additive", intensity: 1.00,
    tunables: [
      { key: "ramp_up", label: "Ramp up", min: 200, max: 4000, step: 100, default: 1200, unit: "ms" },
      { key: "decay",   label: "Decay",   min: 500, max: 6000, step: 100, default: 2500, unit: "ms" },
    ],
    preview: [0.12,0.18,0.28,0.42,0.60,0.78,0.92,1.00,1.00,0.98,1.00,0.95,1.00,0.92,0.88,0.82,0.75,0.65,0.55,0.42,0.30,0.20,0.14,0.10] },

  // ── Stroke ────────────────────────────────────────────────────────
  { id: "slow", label: "Slow", cat: "stroke", devices: ["vibrator","shaker"],
    desc: "Pull back — quarter-speed motion, intent.",
    nsfw: "Long, deliberate quarter-speed strokes. Drawn out on purpose.",
    compose: "additive", intensity: 0.55,
    tunables: [ { key: "period", label: "Period", min: 1, max: 8, step: 0.5, default: 4, unit: "b" } ],
    preview: [0.20,0.30,0.42,0.55,0.66,0.74,0.78,0.74,0.66,0.55,0.42,0.30,0.20,0.30,0.42,0.55,0.66,0.74,0.78,0.74,0.66,0.55,0.42,0.30] },
  { id: "steady", label: "Steady", cat: "stroke", devices: ["vibrator","shaker"],
    desc: "Neutral — moderate motion, no intensity change.",
    nsfw: "A reliable, even rhythm. The metronome to build everything else around.",
    compose: "additive", intensity: 0.60,
    tunables: [ { key: "period", label: "Period", min: 0.5, max: 4, step: 0.25, default: 1, unit: "b" } ],
    preview: [0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62,0.30,0.62] },
  { id: "fast", label: "Fast", cat: "stroke", devices: ["vibrator","shaker"],
    desc: "Push — double-speed motion, drives the climb.",
    nsfw: "Double-time strokes that drive the climb hard toward the top.",
    compose: "additive", intensity: 0.80,
    tunables: [ { key: "period", label: "Period", min: 0.125, max: 1, step: 0.125, default: 0.25, unit: "b" } ],
    preview: [0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75,0.30,0.75] },

  // ── Control (baseline-ish) ─────────────────────────────────────────
  { id: "normal", label: "Normal", cat: "control", devices: ["estim","vibrator","bhaptics","shaker"],
    desc: "Pass-through. Clears a span back to baseline.",
    nsfw: "Pass-through. Whatever the script does on its own, untouched.",
    compose: "replace", intensity: 0, isBaseline: true,
    tunables: [],
    preview: [] },
  { id: "mute", label: "Mute", cat: "control", devices: ["estim","vibrator","bhaptics","shaker"],
    desc: "Output at zero. Deliberate silence.",
    nsfw: "Complete stop. Dead silence — the contrast that makes the next hit land.",
    compose: "replace", intensity: 0, isBaseline: true,
    tunables: [],
    preview: [0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05] },
  { id: "freeze", label: "Freeze", cat: "control", devices: ["vibrator","shaker"],
    desc: "Hold position at the begin frame. Pause without retracting.",
    nsfw: "Pinned in place, full and still. A held breath made physical.",
    compose: "replace", intensity: 0, isBaseline: true,
    tunables: [],
    preview: [0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5] },

  // ── Shape ───────────────────────────────────────────────────────────
  { id: "swell", label: "Swell", cat: "shape", devices: ["estim","vibrator","bhaptics"],
    desc: "Smooth rise and fall over the whole span.",
    nsfw: "One long breath in and out across the whole span. Gentle and total.",
    compose: "additive", intensity: 0.65,
    tunables: [ { key: "depth", label: "Depth", min: 0, max: 1, step: 0.05, default: 0.7, unit: "" } ],
    preview: [0.20,0.30,0.42,0.56,0.70,0.82,0.90,0.94,0.90,0.82,0.70,0.56,0.42,0.30,0.22,0.18,0.22,0.34,0.48,0.60,0.52,0.40,0.30,0.22] },
  { id: "rolling", label: "Rolling", cat: "shape", devices: ["estim","vibrator","shaker"],
    desc: "Continuous swell, ocean-wave shape.",
    nsfw: "Wave after wave that never fully recedes. Relentless, building swell.",
    compose: "additive", intensity: 0.65,
    tunables: [
      { key: "period", label: "Period", min: 1, max: 8, step: 0.5,  default: 2,   unit: "b" },
      { key: "depth",  label: "Depth",  min: 0, max: 1, step: 0.05, default: 0.7, unit: ""  },
    ],
    preview: [0.50,0.62,0.74,0.82,0.85,0.82,0.74,0.62,0.50,0.38,0.26,0.18,0.15,0.18,0.26,0.38,0.50,0.62,0.74,0.82,0.85,0.78,0.66,0.54] },
  { id: "soften", label: "Soften", cat: "shape", devices: ["estim","vibrator","bhaptics"],
    desc: "Drop the floor. Recovery / aftercare.",
    nsfw: "Ease everything down to a warm, low floor. Recovery and aftercare.",
    compose: "additive", intensity: 0.30,
    tunables: [
      { key: "floor", label: "Floor", min: 0, max: 0.5, step: 0.02, default: 0.20, unit: "" },
      { key: "ease",  label: "Ease",  min: 200, max: 4000, step: 100, default: 1200, unit: "ms" },
    ],
    preview: [0.65,0.60,0.55,0.48,0.42,0.36,0.30,0.26,0.24,0.22,0.20,0.20,0.20,0.20,0.20,0.20,0.20,0.20,0.20,0.20,0.20,0.20,0.20,0.20] },
];

// ─── Project / chapters (= Acts) ────────────────────────────────────
window.RX_PROJECT = {
  title: "kiss-the-sky-vH.funscript",
  duration_ms: 720000, // 12:00
  actions: 2183,
  bpm: 92,
};

window.RX_CHAPTERS = [
  { id: "ch1", label: "Act 1 — Opening",   short: "ACT 1 — OPENING",   start:      0, end: 180000, color: "#4dabf7" },
  { id: "ch2", label: "Act 2 — Rising",    short: "ACT 2 — RISING",    start: 180000, end: 360000, color: "#ffb547" },
  { id: "ch3", label: "Act 3 — Heated",    short: "ACT 3 — HEATED",    start: 360000, end: 540000, color: "#ff5470" },
  { id: "ch4", label: "Act 4 — Aftercare", short: "ACT 4 — AFTERCARE", start: 540000, end: 720000, color: "#3ed598" },
];

// ─── Deterministic PRNG so the mock is stable across reloads ────────
function rxRand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ─── Stanzas — beat-grouped sub-slices within each chapter ──────────
// Each stanza carries an `energy` 0..1 used to color the spectrum bars,
// and a `freq` band height for the spectrum look.
window.RX_STANZAS = (() => {
  const rand = rxRand(91);
  const out = [];
  window.RX_CHAPTERS.forEach((ch, ci) => {
    const span = ch.end - ch.start;
    const n = ci === 0 ? 25 : (ci === 1 ? 22 : (ci === 2 ? 20 : 8));
    const w = span / n;
    for (let i = 0; i < n; i++) {
      // Energy arc: low at chapter ends, hot in the middle, act-dependent.
      const t = i / (n - 1 || 1);
      const arc = Math.sin(t * Math.PI);
      const base = [0.45, 0.6, 0.85, 0.4][ci];
      const energy = Math.max(0.08, Math.min(1, base * (0.45 + arc * 0.7) + (rand() - 0.5) * 0.3));
      out.push({
        id: `${ch.id}-s${i + 1}`,
        chapter: ch.id,
        idx: i + 1,
        start: ch.start + i * w,
        end: ch.start + (i + 1) * w,
        energy,
        quiet: energy < 0.22,
      });
    }
  });
  return out;
})();

// ─── Events — 72 spread across the four acts (10 / 32 / 25 / 5) ─────
window.RX_EVENTS = (() => {
  const rand = rxRand(7);
  const counts = { ch1: 10, ch2: 32, ch3: 25, ch4: 5 };
  const pickFrom = {
    ch1: ["tease", "edge", "steady", "swell", "slow", "normal"],
    ch2: ["edge", "surge", "tease", "rolling", "pulse", "fast", "steady", "hold", "mute"],
    ch3: ["surge", "climax", "edge", "hold", "fast", "rolling", "freeze", "mute"],
    ch4: ["soften", "slow", "normal", "swell"],
  };
  const out = [];
  let n = 0;
  window.RX_CHAPTERS.forEach(ch => {
    const c = counts[ch.id];
    const pool = pickFrom[ch.id].filter(id => window.RX_RECIPES.some(r => r.id === id));
    const span = ch.end - ch.start;
    const slot = span / c;
    for (let i = 0; i < c; i++) {
      const recipeId = pool[Math.floor(rand() * pool.length)] || "edge";
      const recipe = window.RX_RECIPES.find(r => r.id === recipeId);
      const begin = ch.start + i * slot + rand() * slot * 0.35 + 800;
      const dur = 1200 + rand() * 6500;
      const devs = {};
      // Occasionally pin per-device overrides for realism.
      if (rand() > 0.6) {
        const avail = recipe.devices;
        avail.slice(0, 1 + Math.floor(rand() * 2)).forEach(d => { devs[d] = Math.round((0.5 + rand() * 0.5) * 20) / 20; });
      }
      out.push({
        id: `e${String(++n).padStart(2, "0")}`,
        chapter: ch.id,
        begin_ms: Math.round(begin),
        end_ms: Math.round(begin + dur),
        recipe: recipeId,
        intensity: recipe.isBaseline ? 0 : Math.round((0.4 + rand() * 0.55) * 100) / 100,
        params: {},
        devices: devs,
      });
    }
  });
  return out;
})();

// ─── Long-form descriptions (shown in the capture cluster) ──────────
// `long` = SFW long copy; `longNsfw` = explicit long copy (NSFW toggle).
// Kept separate from the one-line `desc` used on library cards.
window.RX_LONG = {
  surge: {
    long: "A release shape. Ramps in slowly from a low floor, holds a sustained throb at the top, then melts back down over a long tail. Use it on the big moments where you want a clear build-and-release arc rather than a single spike.",
    longNsfw: "Slow ramp into a sustained, pulsing throb held at the peak, then a long, deliberate melt-down. Built for the big finishes — the climb matters as much as the payoff.",
  },
  edge: {
    long: "A tension build. A quick pulse ramp layered with a fast volume tremor that keeps the sensation right at the threshold without tipping over. Chain several Edges to hold a plateau before a Surge or Climax.",
    longNsfw: "Quick pulse ramp held at the brink with a 10Hz buzz underneath — takes them right to the edge and keeps them there. Stack them to draw the plateau out as long as you dare.",
  },
  hold: {
    long: "A locked, steady high pulse with a subtle hum underneath. No escalation and no relief — it simply sustains. Good for plateaus between more dynamic events.",
    longNsfw: "An unrelenting, locked-high pulse with a low hum. It doesn't build and it doesn't ease — it just keeps going, which is the point.",
  },
  tease: {
    long: "A light flutter with a held-breath quality — backs off the moment attention leans in. The anticipation primitive: use it to create space before a bigger event lands.",
    longNsfw: "Feather-light flutter that pulls away the instant they chase it. Pure anticipation — the gap it leaves is what the next event fills.",
  },
  climax: {
    long: "A hard crescendo to peak intensity, briefly held, then decayed. Reserve it for the single biggest moment — its impact comes from contrast with everything quieter around it.",
    longNsfw: "Everything at once — peaked, held, and released. Save it for the one moment that the whole script has been building toward.",
  },
  slow: {
    long: "Quarter-speed, long-throw motion. Deliberate and drawn out. Pairs well over a Soften or under a Tease when you want motion without urgency.",
    longNsfw: "Long, deliberate, drawn-out strokes at a quarter speed. Slow on purpose — every motion is felt in full.",
  },
  steady: {
    long: "An even, moderate rhythm with no intensity change — the metronome you build everything else around. A neutral baseline for motion.",
    longNsfw: "A reliable, even rhythm that never rushes. The steady bed the spicier events ride on top of.",
  },
  fast: {
    long: "Double-speed motion that drives the climb. Use it under a rising Edge sequence to push pace toward the top of an act.",
    longNsfw: "Double-time strokes that push the pace hard and drive the climb toward the top.",
  },
  normal: {
    long: "Pass-through. The eraser. During a Normal span, anything a chapter or phrase would otherwise apply is ignored and the funscript plays exactly as authored. Use it to carve a deliberate hole in an ambient recipe.",
    longNsfw: "Pass-through — the script, untouched. Whatever ambient recipe is running gets cleared for this span so nothing competes.",
  },
  mute: {
    long: "Output forced to zero — deliberate silence. Distinct from Normal: Mute removes the funscript itself for the span, not just modulation. The contrast makes the next hit land harder.",
    longNsfw: "Dead stop. Total silence — the negative space that makes whatever comes next hit twice as hard.",
  },
  freeze: {
    long: "Holds position at the begin frame without retracting. A physical pause — full and still — rather than a return to rest.",
    longNsfw: "Pinned in place, full and still. A held breath made physical — nothing moves until you release it.",
  },
  swell: {
    long: "A single smooth rise and fall across the whole span. The gentlest of the shape recipes — one long breath in, one out.",
    longNsfw: "One long breath in and out across the entire span. Gentle, total, and unhurried.",
  },
  rolling: {
    long: "A continuous ocean-wave swell that never fully recedes between crests. Relentless and building — good for sustained mid-act intensity.",
    longNsfw: "Wave after wave that never fully pulls back. Relentless, building swell that keeps the pressure on.",
  },
  soften: {
    long: "Eases the intensity floor down to a low, warm level. The recovery / aftercare recipe — use it to land an act gently rather than cutting to silence.",
    longNsfw: "Brings everything down to a warm, low floor. Recovery and aftercare — the gentle landing after the storm.",
  },
};
window.RX_RECIPES.forEach(r => { const L = window.RX_LONG[r.id]; if (L) { r.long = L.long; r.longNsfw = L.longNsfw; } });
window.RX_recipeById = id => window.RX_RECIPES.find(r => r.id === id);
window.RX_catById     = id => window.RX_CATS[id];
window.RX_chapterById = id => window.RX_CHAPTERS.find(c => c.id === id);
window.RX_chapterAt   = ms => window.RX_CHAPTERS.find(c => ms >= c.start && ms < c.end) || window.RX_CHAPTERS[0];
window.RX_accentOf    = ev => {
  const r = window.RX_recipeById(ev.recipe);
  return window.RX_catById(r?.cat)?.accent || "#9ba3c4";
};

window.RX_fmtTime = function (ms, withMs = false) {
  if (ms == null || isNaN(ms)) return withMs ? "––:––.–––" : "––:––";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const base = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (!withMs) return base;
  return `${base}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
};

// Pretty "+5.1s" duration label used in the event list.
window.RX_durLabel = ev => {
  const d = (ev.end_ms - ev.begin_ms) / 1000;
  return `+${d.toFixed(1)}s`;
};
