// Does an incomplete analysis hold the footer's chain button back on THIS tab?
//
// "Analysis is incomplete" is a real blocker on Analysis and every tab
// downstream of it — chaining forward would promise artifacts that do not
// exist, which is the lie the red ✓ used to tell (reported 2026-09-04).
//
// But Project and Generate sit UPSTREAM of Analysis. There, incomplete
// analysis is not a fault, it is the expected state: the user has not reached
// Analysis yet. Applying the gate to them left their primary button
// permanently white and tentative — "Generate new funscript" never went red
// even once media was attached, and the post-generate primary stayed quiet
// when it was genuinely ready to chain (dogfood 2026-09-05).
//
// Extracted from App.jsx so it is testable: vitest never renders App, so a
// rule left inline there is effectively unguarded — the same reason
// busyOwner.js exists.

// Tabs that come BEFORE Analysis in the chain. Kept as an explicit list
// rather than an index comparison against TAB_CHAIN because the chain order
// has been reshuffled before (Device moved to just before Export) and a
// positional test would silently change meaning when it moves again.
export const PRE_ANALYSIS_TABS = ['project', 'generate'];

/**
 * @param {boolean} analysisIncomplete  media attached and analysis not complete
 * @param {string}  tab                 the active tab id
 * @returns {boolean} true → render the primary as tentative and withhold the ✓
 */
export function analysisBlocksChain(analysisIncomplete, tab) {
  return !!analysisIncomplete && !PRE_ANALYSIS_TABS.includes(tab);
}
