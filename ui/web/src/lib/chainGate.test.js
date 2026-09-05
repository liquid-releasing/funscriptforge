import { describe, it, expect } from 'vitest';
import { analysisBlocksChain, PRE_ANALYSIS_TABS } from './chainGate.js';

describe('analysisBlocksChain', () => {
  it('holds the chain on Analysis itself', () => {
    // The original bug: red "Accept and chain to Chapters" offered while the
    // pipeline was still running.
    expect(analysisBlocksChain(true, 'analysis')).toBe(true);
  });

  it('holds the chain on tabs downstream of Analysis', () => {
    for (const tab of ['chapters', 'phrases', 'stanzas', 'characters', 'polish', 'export']) {
      expect(analysisBlocksChain(true, tab)).toBe(true);
    }
  });

  it('does NOT hold the chain on tabs upstream of Analysis', () => {
    // Project and Generate run BEFORE analysis, so incomplete analysis is
    // their normal state -- gating them left the primary permanently white.
    for (const tab of PRE_ANALYSIS_TABS) {
      expect(analysisBlocksChain(true, tab)).toBe(false);
    }
  });

  it('never blocks when analysis is complete', () => {
    for (const tab of ['project', 'generate', 'analysis', 'chapters', 'export']) {
      expect(analysisBlocksChain(false, tab)).toBe(false);
    }
  });

  it('treats a falsy analysisIncomplete as not blocking', () => {
    // App passes `!!project?.mediaPath && ...`, which is undefined before a
    // project is open -- must not be coerced into a block.
    expect(analysisBlocksChain(undefined, 'analysis')).toBe(false);
    expect(analysisBlocksChain(null, 'chapters')).toBe(false);
  });

  it('keeps Project and Generate as the only exemptions', () => {
    // A guard on scope creep: exempting a tab that actually consumes analysis
    // artifacts would reintroduce the original false-ready bug.
    expect(PRE_ANALYSIS_TABS).toEqual(['project', 'generate']);
  });
});
