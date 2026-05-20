// Per-project deterministic funscript preview generator.
//
// Synthesises a believable `[{at, pos}]` action stream from a project's id +
// duration, so the velocity-colored Sparkline / FunscriptChart have something
// to render before the Python bridge can load real funscripts from disk.
//
// Same generator powers both the small Library card previews (~200 actions)
// and the full Project tab chart (~1200 actions). Deterministic per `id` so a
// project always looks the same across renders / sessions.

export function parseDurationToMs(s) {
  if (!s) return 0;
  const m = /^(\d+):(\d+)$/.exec(String(s));
  if (!m) return 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

export function generatePreviewActions(project, count = 200) {
  const seed = hashString(project.id ?? 'default');
  const durationMs = parseDurationToMs(project.duration) || 60000;
  const rand = mulberry32(seed);

  // Profile params derived from the seed so each project feels distinct
  // without a separate per-project config blob. Values picked to give a mix
  // of fast/slow segments per project so velocity coloring has range.
  const baseAmp = 18 + rand() * 40;
  const baseCenter = 35 + rand() * 30;
  const bpm = 40 + rand() * 120;
  const driftSpan = (rand() - 0.5) * 30;

  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const center = baseCenter + driftSpan * t;
    const phase = (i * (bpm / 60) * (durationMs / 1000)) / count * Math.PI * 2;
    const intensityEnv = 0.5 + 0.5 * Math.sin(t * Math.PI);
    const osc = Math.sin(phase) * baseAmp * intensityEnv;
    const jitter = (rand() - 0.5) * 8;
    const pos = Math.max(2, Math.min(98, Math.round(center + osc + jitter)));
    out.push({ at: Math.round(t * durationMs), pos });
  }
  return out;
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
