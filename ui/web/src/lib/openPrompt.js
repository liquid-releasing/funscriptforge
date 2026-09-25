// Which one thing the open-project dialog asks about.
//
// Three independent conditions can be true at once when a project opens, and
// showing them together would turn a prompt into a form. They are ranked by
// what would be WASTED by answering in the wrong order:
//
//   1. analysis  — the on-disk analysis is from an older analyzer. Everything
//                  downstream is built FROM it, so updating outputs first is
//                  work thrown away the moment the user recalculates.
//   2. outputs   — the device files are stale (older pipeline) or behind
//                  (older than the user's own edits). Both are fixed by the
//                  same re-render, so they are one prompt, not two.
//   3. resume    — no correctness consequence at all; it is a convenience.
//
// Nothing to decide → null → no dialog. We don't nag.

export const PROMPT = Object.freeze({
  ANALYSIS: 'analysis',
  OUTPUTS: 'outputs',
  RESUME: 'resume',
});

/** Backend `project_status.state` values that mean "re-render me". */
export const OUTPUTS_NEED_WORK = Object.freeze(['stale', 'behind']);

export function outputsNeedWork(state) {
  return OUTPUTS_NEED_WORK.includes(state);
}

/**
 * @param versionStale  analyzer stamp differs from this build
 * @param outputsState  project_status.state, or null when not yet known
 * @param resumeTab     tab id to resume to, or null
 * @returns one of PROMPT, or null when there is nothing to decide
 */
export function chooseOpenPrompt({ versionStale, outputsState, resumeTab } = {}) {
  if (versionStale) return PROMPT.ANALYSIS;
  if (outputsNeedWork(outputsState)) return PROMPT.OUTPUTS;
  if (resumeTab) return PROMPT.RESUME;
  return null;
}
