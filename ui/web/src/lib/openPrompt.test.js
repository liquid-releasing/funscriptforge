import { describe, it, expect } from 'vitest';
import { chooseOpenPrompt, outputsNeedWork, PROMPT } from './openPrompt.js';

describe('chooseOpenPrompt', () => {
  it('says nothing when there is nothing to decide', () => {
    expect(chooseOpenPrompt({})).toBe(null);
    expect(chooseOpenPrompt({ outputsState: 'current' })).toBe(null);
    expect(chooseOpenPrompt()).toBe(null);
  });

  it('never-exported is not a reason to nag', () => {
    // "You have never exported" is a normal state for a project being
    // authored, not a defect. Prompting there would fire on every new project.
    expect(chooseOpenPrompt({ outputsState: 'never-exported' })).toBe(null);
  });

  it('asks about each condition on its own', () => {
    expect(chooseOpenPrompt({ versionStale: true })).toBe(PROMPT.ANALYSIS);
    expect(chooseOpenPrompt({ outputsState: 'stale' })).toBe(PROMPT.OUTPUTS);
    expect(chooseOpenPrompt({ outputsState: 'behind' })).toBe(PROMPT.OUTPUTS);
    expect(chooseOpenPrompt({ resumeTab: 'generate' })).toBe(PROMPT.RESUME);
  });

  it('★ a stale analysis outranks stale outputs', () => {
    // Re-analyzing changes what the outputs would be built FROM, so updating
    // outputs first is work the user throws away minutes later.
    expect(chooseOpenPrompt({ versionStale: true, outputsState: 'stale' }))
      .toBe(PROMPT.ANALYSIS);
    expect(chooseOpenPrompt({
      versionStale: true, outputsState: 'behind', resumeTab: 'chapters',
    })).toBe(PROMPT.ANALYSIS);
  });

  it('★ out-of-date outputs outrank resuming', () => {
    // Resume is a convenience; shipping or playing stale device files is a
    // correctness problem. The user can still resume after answering.
    expect(chooseOpenPrompt({ outputsState: 'behind', resumeTab: 'generate' }))
      .toBe(PROMPT.OUTPUTS);
  });

  it('treats both re-render states as one prompt', () => {
    // stale and behind differ in CAUSE but not in REMEDY — the same refresh
    // fixes both — so they must not become two separate questions.
    expect(outputsNeedWork('stale')).toBe(true);
    expect(outputsNeedWork('behind')).toBe(true);
    expect(outputsNeedWork('current')).toBe(false);
    expect(outputsNeedWork('never-exported')).toBe(false);
    expect(outputsNeedWork(undefined)).toBe(false);
    expect(outputsNeedWork(null)).toBe(false);
  });
});
