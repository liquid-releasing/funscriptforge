import { describe, it, expect } from 'vitest';
import {
  computeStats, livelinessScore, posAt, quantile, analyzeChannels,
} from './forgeStats.js';

// a simple triangle wave: 0→100→0 every 1s, dense
function sawtooth(n = 200, dt = 100) {
  return Array.from({ length: n }, (_, i) => ({
    at: i * dt,
    pos: i % 2 === 0 ? 10 : 90,
  }));
}

describe('forgeStats', () => {
  it('computeStats on too-few points returns empty shape', () => {
    const s = computeStats([{ at: 0, pos: 50 }], 1000);
    expect(s.count).toBe(1);
    expect(s.avgVelocity).toBe(0);
  });

  it('computeStats measures range, stroke, velocity', () => {
    const acts = sawtooth();
    const s = computeStats(acts, acts.length * 100);
    expect(s.count).toBe(200);
    expect(s.usableRange).toBeGreaterThan(70); // 10..90 swing
    expect(s.avgStroke).toBeCloseTo(80, 0);    // |90-10|
    expect(s.avgVelocity).toBeGreaterThan(0);
  });

  it('livelinessScore is 0..100 and rises with motion', () => {
    const flat = computeStats(
      Array.from({ length: 50 }, (_, i) => ({ at: i * 200, pos: 50 })), 10000,
    );
    const lively = computeStats(sawtooth(), 20000);
    expect(livelinessScore(flat)).toBeLessThan(livelinessScore(lively));
    expect(livelinessScore(lively)).toBeLessThanOrEqual(100);
    expect(livelinessScore(flat)).toBeGreaterThanOrEqual(0);
  });

  it('quantile interpolates', () => {
    expect(quantile([0, 10, 20, 30], 0.5)).toBeCloseTo(15, 5);
  });

  it('posAt interpolates and clamps to ends', () => {
    const acts = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }];
    expect(posAt(acts, -50)).toBe(0);
    expect(posAt(acts, 500)).toBeCloseTo(50, 5);
    expect(posAt(acts, 9999)).toBe(100);
  });

  it('analyzeChannels rolls channels into a device summary', () => {
    const channels = [
      { name: 'alpha', actions: sawtooth() },
      { name: 'beta', actions: sawtooth() },
      { name: 'volume', actions: Array.from({ length: 50 }, (_, i) => ({ at: i * 200, pos: 70 })) },
    ];
    const sum = analyzeChannels(channels, 20000);
    expect(sum.channelCount).toBe(3);
    expect(sum.perChannel.length).toBe(3);
    expect(sum.totalActions).toBeGreaterThan(0);
    expect(sum.liveliness).toBeGreaterThanOrEqual(0);
    expect(sum.liveliness).toBeLessThanOrEqual(100);
  });

  it('analyzeChannels tolerates empty channels', () => {
    const sum = analyzeChannels([{ name: 'x', actions: [] }], 1000);
    expect(sum.totalActions).toBe(0);
    expect(sum.liveliness).toBe(0);
  });
});
