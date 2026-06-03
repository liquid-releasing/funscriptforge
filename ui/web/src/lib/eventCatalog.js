// Events catalog vocabulary + derivations — the pure logic behind the Events
// tab, extracted from EventsTab.jsx so it can be unit-tested. Recipes are the
// 32 Edger events (backend-sourced via list-event-recipes); these helpers turn
// a recipe into the labels, colors, blend classification, "what this produces"
// step lines, and the shape glyph the UI renders.

// Colors + display names by source group.
export const GROUP_COLORS = {
  featured: '#c77dff', general: '#4dabf7', mcb: '#ff7b7b', clutch: '#ffb547', test: '#8a8a93',
};
export const GROUP_NAMES = {
  featured: 'Featured', general: 'General', mcb: 'MCB', clutch: 'Clutch', test: 'Test',
};

export function recipeColor(recipe) {
  if (!recipe) return 'var(--text-dim)';
  if (recipe.baseline) return '#8a8a93';
  return GROUP_COLORS[recipe.group] || '#4dabf7';
}

// SFW is the default presentation (store positioning); NSFW reveals the raw
// intent label. Most events are unbranded → both labels resolve the same.
export function pickLabel(recipe, mode) {
  if (!recipe) return '';
  if (mode === 'nsfw') return recipe.nsfwLabel || recipe.label || recipe.name;
  return recipe.sfwLabel || recipe.label || recipe.name;
}

// Blend = how an event combines with whatever is already on the channel.
// Derived from each step's `mode`: additive layers ON TOP (safe to stack),
// overwrite REPLACES the channel for the window. Matters because events stack.
export function recipeBlend(recipe) {
  const modes = (recipe?.steps || []).map((s) => s.params?.mode || 'additive');
  if (!modes.length) return null; // baseline / Normal
  if (modes.every((m) => m === 'additive')) return 'additive';
  if (modes.every((m) => m === 'overwrite')) return 'overwrite';
  return 'mixed';
}
export const BLEND_META = {
  additive: { label: 'Adds on top', color: '#5dc98a', tip: 'Layers on existing motion — safe to stack with other events.' },
  overwrite: { label: 'Replaces', color: '#ffb547', tip: 'Takes over the channel for its window — overrides anything underneath.' },
  mixed: { label: 'Mixed', color: '#9aa0ad', tip: 'Some steps add on top, some replace the channel.' },
};

// Resolve a step param's `$ref` against the live param values (else defaults).
export function resolveParam(v, paramVals, defaults) {
  if (typeof v === 'string' && v.startsWith('$')) {
    const k = v.slice(1);
    const r = paramVals?.[k] ?? defaults?.[k];
    return r != null ? r : v;
  }
  return v;
}
export const AXIS_LABEL = {
  pulse_frequency: 'pulse rate', pulse_width: 'pulse width',
  volume: 'volume', 'volume,volume-prostate': 'volume',
};

// Humanize a recipe's step stack into "what this produces" lines, with the
// current params substituted (matches funscript-tools' update_steps_preview,
// friendlier). Each entry = one operation: { text, mode } (mode = additive |
// overwrite, surfaced so the user sees which steps layer vs replace).
export function humanizeSteps(steps, paramVals, defaults) {
  const lines = [];
  for (const s of (steps || [])) {
    const p = s.params || {};
    const mode = p.mode || 'additive';
    const axis = AXIS_LABEL[s.axis] || (s.axis || '').split(',')[0] || s.axis || 'output';
    const r = (v) => resolveParam(v, paramVals, defaults);
    const dur = r(p.duration_ms);
    const ramp = r(p.ramp_in_ms);
    const durTxt = typeof dur === 'number' ? ` over ${(dur / 1000).toFixed(1)}s` : '';
    const rampTxt = typeof ramp === 'number' && ramp > 0 ? `, ramp ${(ramp / 1000).toFixed(2)}s` : '';
    let text;
    if (s.op === 'apply_linear_change') {
      text = `Sweep ${axis} ${r(p.start_value)}→${r(p.end_value)}${durTxt}${rampTxt}`;
    } else if (s.op === 'apply_modulation') {
      const freq = r(p.frequency);
      const amp = r(p.amplitude);
      const freqTxt = typeof freq === 'number' ? ` @${freq}Hz` : '';
      const ampTxt = amp != null ? ` ±${amp}` : '';
      text = `Modulate ${axis} ${r(p.waveform) || 'sin'}${freqTxt}${ampTxt}${durTxt}`;
    } else {
      text = `${(s.op || 'op').replace(/_/g, ' ')} on ${axis}${durTxt}`;
    }
    lines.push({ text, mode });
  }
  return lines;
}

// Classify a recipe's step stack into a glyph kind (the "shape icon"):
// modulation → its waveform; a single linear change → ramp up/down/steady;
// baseline / no steps → flat. Grounded in real data, not a shape table.
export function recipeGlyphKind(recipe) {
  const steps = recipe?.steps || [];
  if (!steps.length) return { kind: 'flat' };
  const mod = steps.find((s) => s.op === 'apply_modulation');
  if (mod) return { kind: 'wave', waveform: mod.params?.waveform || 'sin' };
  const first = steps[0].params || {};
  const last = steps[steps.length - 1].params || {};
  const sv = resolveParam(first.start_value, null, recipe.defaultParams);
  const ev = resolveParam(last.end_value ?? last.start_value, null, recipe.defaultParams);
  const a = Number(sv); const b = Number(ev);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    if (b > a * 1.001) return { kind: 'ramp-up' };
    if (b < a * 0.999) return { kind: 'ramp-down' };
  }
  return { kind: 'steady' };
}

// Sample a glyph kind into polyline points over a w×h box (SVG coords, y down).
export function glyphPoints(spec, w, h) {
  const pad = 2;
  const x0 = pad; const x1 = w - pad;
  const yLo = h - pad; const yHi = pad;
  const mid = (yLo + yHi) / 2;
  const amp = (yLo - yHi) * 0.4;
  const pts = [];
  if (spec.kind === 'wave') {
    const cycles = 2.4; const n = 36;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const ph = 2 * Math.PI * cycles * t;
      let s;
      switch (spec.waveform) {
        case 'square': s = (ph % (2 * Math.PI)) < Math.PI ? 1 : -1; break;
        case 'sawtooth': s = 2 * ((cycles * t) % 1) - 1; break;
        case 'triangle': { const f = (cycles * t) % 1; s = f < 0.5 ? 4 * f - 1 : 3 - 4 * f; break; }
        default: s = Math.sin(ph);
      }
      pts.push([x, mid - amp * s]);
    }
  } else if (spec.kind === 'ramp-up') {
    pts.push([x0, yLo], [x1, yHi]);
  } else if (spec.kind === 'ramp-down') {
    pts.push([x0, yHi], [x1, yLo]);
  } else if (spec.kind === 'steady') {
    pts.push([x0, mid - amp * 0.5], [x1, mid - amp * 0.5]);
  } else { // flat / baseline
    pts.push([x0, mid], [x1, mid]);
  }
  return pts;
}
