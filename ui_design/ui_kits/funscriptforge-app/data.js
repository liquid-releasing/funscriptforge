// Synthetic FunscriptForge project data.
// Vocabulary is real to the product:
//   • A funscript = array of {at: ms, pos: 0..100} actions.
//   • Phrases are auto-detected runs of similar motion. Each gets a behavioral tag
//     from the classifier (10 tags — see FF_TAGS in transforms-data.js).
//   • Chapters are user-defined slices of the script for managing big projects.
//     They group phrases for batch work; they do NOT change the funscript.
//   • Patterns (sub-phrase) and Cycles (one stroke up + down) exist under the hood
//     but are surfaced only in the Phrase Editor's analysis chart.

const FF_TOTAL_MS = 9 * 60 * 1000 + 32 * 1000; // 9:32

// ─── Chapters (user-defined slices) ─────────────────────────────────
const FF_CHAPTERS = [
  { id: "ch1", title: "Act 1 — Opening",      start:      0, end: 138000, color: "#4dabf7" },
  { id: "ch2", title: "Act 2 — Rising",       start: 138000, end: 348000, color: "#ffb547" },
  { id: "ch3", title: "Act 3 — Heated",       start: 348000, end: 472000, color: "#ff5470" },
  { id: "ch4", title: "Act 4 — Aftercare",    start: 472000, end: FF_TOTAL_MS, color: "#8b9bff" },
];

// ─── Patterns — named structural behaviors ──────────────────────────
// Patterns are named recurring shapes (e.g. Steady, Pulse, Tide, 3+1).
// Each phrase belongs to one pattern. Patterns can span multiple phrases.
const FF_PATTERNS = [
  { id: "pat_steady",   label: "Steady",       desc: "Regular up-down strokes, even tempo." },
  { id: "pat_pulse",    label: "Pulse",        desc: "Repeating pulses with rest between groups." },
  { id: "pat_31",       label: "3+1",          desc: "Three full strokes followed by one rest beat." },
  { id: "pat_tide",     label: "Tide",         desc: "Fast strokes riding on a slow center wave." },
  { id: "pat_drift",    label: "Drift",        desc: "Sustained plateau with one slow dip." },
  { id: "pat_burst",    label: "Burst",        desc: "Short bursts of high-BPM motion separated by lulls." },
  { id: "pat_taper",    label: "Taper",        desc: "Amplitude shrinks across the phrase — winding down." },
  { id: "pat_swell",    label: "Swell",        desc: "Amplitude grows across the phrase — winding up." },
];

// ─── Phrases (classifier output) ────────────────────────────────────
// Each phrase: numeric id, behavioral tag (or null = well-formed),
// and a pattern (named shape). Phrases have NO user-facing name —
// they're identified by their position and tag.
const FF_PHRASES = [
  { id: "p01", start:      0, end:  18500, tag: "ambient",      patternId: "pat_drift",  bpm:  18, ampSpan: 12, meanPos: 52 },
  { id: "p02", start:  18500, end:  44000, tag: "lazy",         patternId: "pat_steady", bpm:  48, ampSpan: 28, meanPos: 48 },
  { id: "p03", start:  44000, end:  68000, tag: "plateau",      patternId: "pat_steady", bpm:  92, ampSpan: 32, meanPos: 51 },
  { id: "p04", start:  68000, end:  96000, tag: "giggle",       patternId: "pat_pulse",  bpm: 110, ampSpan: 14, meanPos: 50 },
  { id: "p05", start:  96000, end: 122000, tag: null,           patternId: "pat_steady", bpm:  88, ampSpan: 65, meanPos: 50 },
  { id: "p06", start: 122000, end: 138000, tag: "drift",        patternId: "pat_drift",  bpm:  96, ampSpan: 38, meanPos: 78 },
  { id: "p07", start: 138000, end: 168000, tag: "ramp",         patternId: "pat_swell",  bpm: 105, ampSpan: 42, meanPos: 50 },
  { id: "p08", start: 168000, end: 198000, tag: null,           patternId: "pat_steady", bpm: 118, ampSpan: 72, meanPos: 50 },
  { id: "p09", start: 198000, end: 230000, tag: "half_stroke",  patternId: "pat_steady", bpm: 124, ampSpan: 54, meanPos: 28 },
  { id: "p10", start: 230000, end: 260000, tag: "drone",        patternId: "pat_steady", bpm: 138, ampSpan: 60, meanPos: 50 },
  { id: "p11", start: 260000, end: 290000, tag: "drone",        patternId: "pat_31",     bpm: 142, ampSpan: 58, meanPos: 50 },
  { id: "p12", start: 290000, end: 320000, tag: null,           patternId: "pat_pulse",  bpm: 130, ampSpan: 78, meanPos: 50 },
  { id: "p13", start: 320000, end: 348000, tag: "stingy",       patternId: "pat_burst",  bpm: 168, ampSpan: 88, meanPos: 50 },
  { id: "p14", start: 348000, end: 376000, tag: "stingy",       patternId: "pat_burst",  bpm: 174, ampSpan: 92, meanPos: 50 },
  { id: "p15", start: 376000, end: 402000, tag: "frantic",      patternId: "pat_steady", bpm: 232, ampSpan: 80, meanPos: 50 },
  { id: "p16", start: 402000, end: 428000, tag: "frantic",      patternId: "pat_steady", bpm: 245, ampSpan: 78, meanPos: 50 },
  { id: "p17", start: 428000, end: 452000, tag: null,           patternId: "pat_tide",   bpm: 158, ampSpan: 84, meanPos: 50 },
  { id: "p18", start: 452000, end: 472000, tag: "plateau",      patternId: "pat_taper",  bpm: 102, ampSpan: 30, meanPos: 50 },
  { id: "p19", start: 472000, end: 498000, tag: "lazy",         patternId: "pat_taper",  bpm:  42, ampSpan: 36, meanPos: 50 },
  { id: "p20", start: 498000, end: 524000, tag: null,           patternId: "pat_steady", bpm:  56, ampSpan: 50, meanPos: 50 },
  { id: "p21", start: 524000, end: 548000, tag: "ambient",      patternId: "pat_drift",  bpm:  22, ampSpan: 18, meanPos: 50 },
  { id: "p22", start: 548000, end: 562000, tag: "ramp",         patternId: "pat_taper",  bpm:  38, ampSpan: 32, meanPos: 50 },
  { id: "p23", start: 562000, end: 572000, tag: "ambient",      patternId: "pat_drift",  bpm:  14, ampSpan: 10, meanPos: 50 },
];

// Map a phrase to its parent chapter.
function _chapterOf(ph) {
  return FF_CHAPTERS.find(c => ph.start >= c.start && ph.start < c.end);
}
FF_PHRASES.forEach(p => { p.chapterId = _chapterOf(p)?.id; });

// ─── Action points (synthetic, generated per phrase from its tag) ───
function _mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function _genPhrase(ph, rng) {
  const out = [];
  const dur = ph.end - ph.start;
  const cycleMs = 60000 / Math.max(8, ph.bpm);     // one full cycle (up+down)
  const halfCycle = cycleMs / 2;
  const amp = ph.ampSpan / 2;                       // half-span on each side of mean
  let t = ph.start;
  let up = true;
  while (t < ph.end) {
    const jitterPos = (rng() - 0.5) * 6;
    const jitterT = (rng() - 0.5) * halfCycle * 0.15;
    let pos;
    if (ph.tag === "stingy" || ph.tag === "frantic") {
      pos = up ? 95 + jitterPos * 0.3 : 5 + jitterPos * 0.3;
    } else if (ph.tag === "giggle") {
      pos = ph.meanPos + (up ? amp : -amp) + jitterPos * 1.2;
    } else if (ph.tag === "drift" || ph.tag === "half_stroke") {
      pos = ph.meanPos + (up ? amp : -amp) + jitterPos * 0.6;
    } else if (ph.tag === "ramp") {
      const p = (t - ph.start) / dur;
      const dynAmp = amp * (0.4 + p * 0.9);
      const dynCenter = ph.meanPos + (p - 0.5) * 25;
      pos = dynCenter + (up ? dynAmp : -dynAmp) + jitterPos * 0.5;
    } else if (ph.tag === "ambient" || ph.tag === "lazy") {
      pos = ph.meanPos + (up ? amp : -amp) + jitterPos;
    } else if (ph.tag === "drone" || ph.tag === "plateau") {
      pos = ph.meanPos + (up ? amp : -amp) + jitterPos * 0.4;
    } else {
      // null tag = well-formed
      pos = ph.meanPos + (up ? amp : -amp) + jitterPos;
    }
    pos = Math.max(0, Math.min(100, Math.round(pos)));
    out.push({ at: Math.round(t + jitterT), pos });
    t += halfCycle;
    up = !up;
  }
  return out;
}

const FF_ACTIONS = (() => {
  const rng = _mulberry32(7);
  const all = [];
  for (const ph of FF_PHRASES) all.push(..._genPhrase(ph, rng));
  return all.sort((a, b) => a.at - b.at);
})();

// ─── Recent projects (Project tab) ──────────────────────────────────
const FF_RECENT = [
  { id: "r1", title: "Aftermath — Director's Cut", duration: "9:32",  edited: "just now",     phrases: 23, status: "in-progress" },
  { id: "r2", title: "Slow Burn",                  duration: "8:12",  edited: "yesterday",    phrases: 18, status: "exported" },
  { id: "r3", title: "Quiet Rain (collab)",        duration: "21:05", edited: "3 days ago",   phrases: 47, status: "in-progress" },
  { id: "r4", title: "Untitled draft",             duration: "4:30",  edited: "last week",    phrases:  9, status: "draft" },
];

const FF_ACTIVE_FILE = {
  title: "Aftermath — Director's Cut",
  durationMs: FF_TOTAL_MS,
  phraseCount: FF_PHRASES.length,
  actionCount: FF_ACTIONS.length,
  bpmMean: 102,
  imported: "today, 14:22",
};

// ─── Pipeline / chain stage status ──────────────────────────────────
// Each tab writes its chain file when Accept is clicked. Downstream tabs
// read upstream chain files. Here we model which stages have been accepted.
const FF_PIPELINE = {
  project:    { accepted: true,  file: "aftermath_project.json"             },
  chapters:   { accepted: true,  file: "aftermath_chapters.json"            },
  device:     { accepted: true,  file: "aftermath_funscript_device.json"    },
  tone:       { accepted: true,  file: "aftermath_funscript_tone.json"      },
  phrases:    { accepted: false, file: "aftermath_funscript_phrases.json"   },
  patterns:   { accepted: false, file: null /* via phrases */               },
  stim:       { accepted: false, file: "aftermath_estim.wav"                },
  multiaxis:  { accepted: false, file: "aftermath_funscript_multiaxis.json" },
  exportTab:  { accepted: false, file: null                                 },
};

// ─── Target devices (Project tab) ───────────────────────────────────
const FF_DEVICES = [
  { id: "handy",    label: "The Handy",    icon: "cpu",     maxBpm: 600, axes: "linear", summary: "Linear stroker · 600 BPM ceiling" },
  { id: "ohmibod",  label: "OhMiBod",      icon: "radio",   maxBpm: 0,   axes: "vibration", summary: "Vibrator · vibration intensity" },
  { id: "kiiroo",   label: "Kiiroo Keon",  icon: "cpu",     maxBpm: 240, axes: "linear", summary: "Linear stroker · 240 BPM ceiling" },
  { id: "estim",    label: "E-stim",       icon: "zap",     maxBpm: 0,   axes: "estim",  summary: "Electrostim · driven by Stim tab" },
  { id: "sr6",      label: "OSR2 / SR6",   icon: "axis-3d", maxBpm: 300, axes: "multi-axis", summary: "Multi-axis · L0 + roll/pitch/sway" },
  { id: "lovense",  label: "Lovense",      icon: "radio",   maxBpm: 0,   axes: "vibration", summary: "Vibrator · vibration intensity" },
];

window.FF_DATA = {
  CHAPTERS:    FF_CHAPTERS,
  PATTERNS:    FF_PATTERNS,
  PHRASES:     FF_PHRASES,
  ACTIONS:     FF_ACTIONS,
  RECENT:      FF_RECENT,
  DEVICES:     FF_DEVICES,
  ACTIVE_FILE: FF_ACTIVE_FILE,
  PIPELINE:    FF_PIPELINE,
  TOTAL_MS:    FF_TOTAL_MS,
};
