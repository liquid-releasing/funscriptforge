// The stage map behind the Analysis tab's progressive reveal.
//
// Extracted from AnalysisTab's `ff:progress` handler so the rule that
// produced the stuck-stage bug can be tested directly. The handler still
// owns the side effects (sidecar refreshes, chapter reloads); this owns only
// the question "what does this event do to the stage map?"
//
// The bug it documents: `start` sets a stage `running` and only the matching
// `done` clears it. On a single global event channel, a `start` from one
// operation and the `done` from another were indistinguishable, so a stage
// could be set running by a generate and never completed by it.

/**
 * Fold one parsed progress event into the stage map.
 *
 * Returns the same object reference when nothing changes, so React can skip
 * the re-render.
 *
 * @param stages  {Record<string,'running'|'done'>}
 * @param parsed  result of parseProgressLine()
 */
export function applyStageEvent(stages, parsed) {
  if (!parsed) return stages;
  const { kind, depth, leaf } = parsed;
  // Depth 1 is the outer command wrapper and depth 3+ are sub-stages;
  // only depth 2 maps to a panel.
  if (!leaf || depth !== 2) return stages;
  if (kind === 'start') {
    if (stages[leaf] === 'running') return stages;
    return { ...stages, [leaf]: 'running' };
  }
  if (kind === 'done') {
    if (stages[leaf] === 'done') return stages;
    return { ...stages, [leaf]: 'done' };
  }
  return stages;
}

/** Stage names still running — i.e. started with no matching `done`. */
export function runningStages(stages) {
  return Object.keys(stages || {}).filter((k) => stages[k] === 'running');
}
