import { describe, it, expect } from 'vitest';
import {
  recipeColor, pickLabel, recipeBlend, BLEND_META,
  humanizeSteps, recipeGlyphKind, glyphPoints, GROUP_COLORS,
} from './eventCatalog.js';

// A few representative recipe shapes mirroring list-event-recipes output.
const additiveRecipe = {
  id: 'edge', group: 'general', sfwLabel: 'Edge', nsfwLabel: 'Edge', label: 'Edge',
  defaultParams: { buzz_freq: 11 },
  steps: [
    { op: 'apply_linear_change', axis: 'volume', params: { start_value: 0.05, end_value: 0.05, duration_ms: 10000, mode: 'additive' } },
    { op: 'apply_modulation', axis: 'volume', params: { waveform: 'sin', frequency: '$buzz_freq', amplitude: 0.1, duration_ms: 10000, mode: 'additive' } },
  ],
};
const overwriteRecipe = {
  id: 'medium', group: 'general', sfwLabel: 'Steady', nsfwLabel: 'Medium', label: 'Medium',
  defaultParams: { pulse_rate: 120 },
  steps: [
    { op: 'apply_linear_change', axis: 'pulse_frequency', params: { start_value: '$pulse_rate', end_value: '$pulse_rate', duration_ms: 8000, mode: 'overwrite' } },
  ],
};
const mixedRecipe = {
  id: 'mix', group: 'mcb', label: 'Mix',
  steps: [
    { op: 'apply_linear_change', axis: 'volume', params: { start_value: 0.1, end_value: 0.2, mode: 'additive' } },
    { op: 'apply_modulation', axis: 'volume', params: { waveform: 'square', frequency: 9, mode: 'overwrite' } },
  ],
};
const baseline = { id: 'normal', baseline: true, label: 'Normal', sfwLabel: 'Normal', nsfwLabel: 'Normal', steps: [] };
const rampUp = { id: 'up', group: 'clutch', label: 'Up', defaultParams: {}, steps: [{ op: 'apply_linear_change', axis: 'pulse_frequency', params: { start_value: 60, end_value: 120, mode: 'additive' } }] };
const rampDown = { id: 'down', group: 'clutch', label: 'Down', defaultParams: {}, steps: [{ op: 'apply_linear_change', axis: 'pulse_frequency', params: { start_value: 120, end_value: 60, mode: 'additive' } }] };

describe('recipeColor', () => {
  it('returns the group color for an effect', () => {
    expect(recipeColor(additiveRecipe)).toBe(GROUP_COLORS.general);
  });
  it('returns grey for the baseline', () => {
    expect(recipeColor(baseline)).toBe('#8a8a93');
  });
  it('returns a fallback for null/unknown', () => {
    expect(recipeColor(null)).toBe('var(--text-dim)');
    expect(recipeColor({ group: 'who' })).toBe('#4dabf7');
  });
});

describe('pickLabel', () => {
  it('prefers sfwLabel in sfw mode', () => {
    expect(pickLabel(overwriteRecipe, 'sfw')).toBe('Steady');
  });
  it('prefers nsfwLabel in nsfw mode', () => {
    expect(pickLabel(overwriteRecipe, 'nsfw')).toBe('Medium');
  });
  it('falls back through label → name', () => {
    expect(pickLabel({ name: 'raw_evt' }, 'sfw')).toBe('raw_evt');
    expect(pickLabel(null, 'sfw')).toBe('');
  });
});

describe('recipeBlend', () => {
  it('classifies all-additive', () => {
    expect(recipeBlend(additiveRecipe)).toBe('additive');
  });
  it('classifies all-overwrite', () => {
    expect(recipeBlend(overwriteRecipe)).toBe('overwrite');
  });
  it('classifies mixed', () => {
    expect(recipeBlend(mixedRecipe)).toBe('mixed');
  });
  it('treats a missing mode as additive', () => {
    expect(recipeBlend({ steps: [{ op: 'x', params: {} }] })).toBe('additive');
  });
  it('returns null for the baseline (no steps)', () => {
    expect(recipeBlend(baseline)).toBeNull();
  });
  it('has metadata for every blend kind', () => {
    for (const k of ['additive', 'overwrite', 'mixed']) {
      expect(BLEND_META[k]).toHaveProperty('label');
      expect(BLEND_META[k]).toHaveProperty('color');
      expect(BLEND_META[k]).toHaveProperty('tip');
    }
  });
});

describe('humanizeSteps', () => {
  it('substitutes $params and carries mode per line', () => {
    const lines = humanizeSteps(additiveRecipe.steps, { buzz_freq: 11 }, additiveRecipe.defaultParams);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toContain('Sweep volume');
    expect(lines[0].text).toContain('over 10.0s');
    expect(lines[0].mode).toBe('additive');
    // $buzz_freq resolves to 11 Hz from the live param values.
    expect(lines[1].text).toContain('@11Hz');
    expect(lines[1].text).toContain('Modulate volume sin');
  });
  it('surfaces overwrite mode on the line', () => {
    const lines = humanizeSteps(overwriteRecipe.steps, {}, overwriteRecipe.defaultParams);
    expect(lines[0].mode).toBe('overwrite');
  });
  it('handles empty/undefined steps', () => {
    expect(humanizeSteps([], {}, {})).toEqual([]);
    expect(humanizeSteps(undefined, {}, {})).toEqual([]);
  });
  it('says "the selected duration" when the step scales to the span ($duration_ms)', () => {
    // Real recipes always use the token — the length is the captured span, not
    // the recipe default, so we must not print a fixed number.
    const spanRecipe = {
      defaultParams: { duration_ms: 15000 },
      steps: [{ op: 'apply_linear_change', axis: 'pulse_frequency', params: { start_value: 90, end_value: 80, duration_ms: '$duration_ms', mode: 'additive' } }],
    };
    const lines = humanizeSteps(spanRecipe.steps, {}, spanRecipe.defaultParams);
    expect(lines[0].text).toContain('over the selected duration');
    expect(lines[0].text).not.toContain('15.0s');
  });
  it('says "selected ramp" for a $ramp token, but prints seconds for a literal ramp', () => {
    const defaults = { duration_ms: 15000, ramp_up_ms: 250 };
    const tokenRamp = humanizeSteps(
      [{ op: 'apply_linear_change', axis: 'volume', params: { start_value: 0.1, end_value: 0.1, duration_ms: '$duration_ms', ramp_in_ms: '$ramp_up_ms', mode: 'additive' } }],
      {}, defaults,
    );
    expect(tokenRamp[0].text).toContain('selected ramp');
    expect(tokenRamp[0].text).not.toMatch(/ramp 0\.\d+s/);
    const literalRamp = humanizeSteps(
      [{ op: 'apply_linear_change', axis: 'volume', params: { start_value: 0.2, end_value: 0.2, ramp_in_ms: 1000, duration_ms: '$duration_ms', mode: 'additive' } }],
      {}, defaults,
    );
    expect(literalRamp[0].text).toContain('ramp 1.00s');
  });
});

describe('recipeGlyphKind', () => {
  it('is wave when any step modulates, carrying the waveform', () => {
    expect(recipeGlyphKind(additiveRecipe)).toEqual({ kind: 'wave', waveform: 'sin' });
    expect(recipeGlyphKind(mixedRecipe)).toEqual({ kind: 'wave', waveform: 'square' });
  });
  it('is ramp-up / ramp-down for a directional linear change', () => {
    expect(recipeGlyphKind(rampUp).kind).toBe('ramp-up');
    expect(recipeGlyphKind(rampDown).kind).toBe('ramp-down');
  });
  it('is steady for a flat linear hold', () => {
    expect(recipeGlyphKind(overwriteRecipe).kind).toBe('steady');
  });
  it('is flat for the baseline / no steps', () => {
    expect(recipeGlyphKind(baseline).kind).toBe('flat');
    expect(recipeGlyphKind(null).kind).toBe('flat');
  });
});

describe('glyphPoints', () => {
  it('returns two endpoints for ramps that span the box', () => {
    const pts = glyphPoints({ kind: 'ramp-up' }, 34, 18);
    expect(pts).toHaveLength(2);
    // ramp-up goes from low-left (high y) to high-right (low y).
    expect(pts[0][1]).toBeGreaterThan(pts[1][1]);
    expect(pts[0][0]).toBeLessThan(pts[1][0]);
  });
  it('samples a wave into many points within bounds', () => {
    const w = 34; const h = 18;
    const pts = glyphPoints({ kind: 'wave', waveform: 'sin' }, w, h);
    expect(pts.length).toBeGreaterThan(10);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(h);
    }
  });
});
