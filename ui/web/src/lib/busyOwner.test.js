import { describe, it, expect } from 'vitest';
import { applyBusyUpdate } from './busyOwner.js';

describe('busy banner ownership', () => {
  it('stamps the owner when a producer sets it', () => {
    expect(applyBusyUpdate(null, { message: 'Analyzing…' }, 'analysis'))
      .toEqual({ message: 'Analyzing…', owner: 'analysis' });
  });

  it('lets the owner clear its own banner', () => {
    const prev = { message: 'Analyzing…', owner: 'analysis' };
    expect(applyBusyUpdate(prev, null, 'analysis')).toBeNull();
  });

  it('refuses a clear from a different producer', () => {
    // The reported bug: Generate's work lands after the user reaches Analysis
    // and wipes the analysis progress banner mid-pipeline.
    const prev = { message: 'Analyzing…', owner: 'analysis' };
    expect(applyBusyUpdate(prev, null, 'generate')).toBe(prev);
  });

  it('refuses a clear from an App operation too', () => {
    const prev = { message: 'Analyzing…', owner: 'analysis' };
    expect(applyBusyUpdate(prev, null, 'app')).toBe(prev);
  });

  it('lets a newer producer REPLACE the banner', () => {
    // Only clearing is restricted. A real new operation still takes over,
    // otherwise the first owner would hold the banner forever.
    const prev = { message: 'Analyzing…', owner: 'analysis' };
    expect(applyBusyUpdate(prev, { message: 'Exporting…' }, 'export'))
      .toEqual({ message: 'Exporting…', owner: 'export' });
  });

  it('leaves an unowned banner clearable by anyone', () => {
    // A legacy caller must never be able to strand the banner on screen.
    expect(applyBusyUpdate({ message: 'Legacy…' }, null, 'analysis')).toBeNull();
  });

  it('clearing an empty banner is a no-op', () => {
    expect(applyBusyUpdate(null, null, 'analysis')).toBeNull();
  });
});
