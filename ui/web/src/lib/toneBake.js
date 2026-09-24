// Which chapters need re-baking, and what to bake them from.
//
// ── The bug this exists to fix ─────────────────────────────────────────────
//
// `<stem>.work.funscript` is a flat destructive snapshot. Nothing recorded
// what had been baked into it, and the chapter's `tone` field in chapters.json
// was doing double duty: the user's INTENT, and evidence the tone was already
// APPLIED. Those two readings agree right up until the user changes their mind.
//
// Consequences, all three observed in the code:
//
//   1. On reopen, ChaptersTab seeded its "original" snapshot from the WORK
//      file (load_project prefers it), so it was toning already-toned data.
//   2. Every chapter with a saved tone was restored as `accepted`, so
//      accepting ANY chapter re-toned ALL of them. Measured with climax at
//      the default impact: depth 54 -> 70 -> 92 -> 100 (railed).
//   3. Params were never persisted, so the re-bake ran at default strength,
//      not what the user had chosen.
//
// And there was no way back. Setting a chapter to Untoned after a reopen
// restored the TONED data, because that was the snapshot. The only escape was
// the global "Revert to original", which deletes every edit from every tab.
//
// ── The rule ───────────────────────────────────────────────────────────────
//
// A separate bake record says what is currently IN the work funscript. Then,
// per chapter:
//
//   • selection unchanged from what is baked  -> LEAVE the work file alone.
//     Nothing is re-applied, so nothing compounds, and edits other tabs made
//     inside that range survive untouched.
//   • selection changed (including changed TO Untoned) -> rebuild that
//     chapter's range from the PRISTINE source at the new settings.
//
// The second half is what makes undo work: Untoned is not a special case, it
// is just a change whose transform happens to be a passthrough of the
// original. Per-chapter undo, across sessions, without touching anything else.
//
// The trade it makes, stated plainly: re-toning a chapter rebuilds its range
// from the original, so edits another tab made INSIDE that chapter are lost.
// That is the honest meaning of "redo this chapter's tone", it only applies to
// chapters the user deliberately changed, and it is the price of having an
// undo at all.

/** Chapters whose tone selection differs from what is baked into the work file. */
export function changedChapters(chapters, selection, baked) {
  return (chapters ?? [])
    .filter((ch) => hasChanged(ch.id, selection, baked))
    .map((ch) => ch.id);
}

/** Normalised view of one chapter's tone choice, for comparison. */
function entry(id, byChapter) {
  const rec = byChapter?.[id];
  if (!rec) return { tone: 'none', params: {} };
  return {
    tone: rec.tone ?? 'none',
    params: rec.params ?? {},
  };
}

/**
 * True when a chapter's current selection differs from the baked one.
 *
 * Params are compared by value, because changing impact or scope alone must
 * count as a change -- that is the "I set it to 0.2 and it came back 0.5"
 * case. Key order is normalised so a re-serialised record doesn't read as a
 * spurious change and trigger a needless re-bake.
 */
export function hasChanged(id, selection, baked) {
  const a = entry(id, selection);
  const b = entry(id, baked);
  if (a.tone !== b.tone) return true;
  // An untoned chapter's params are meaningless -- a passthrough is a
  // passthrough whatever the sliders say.
  if (a.tone === 'none') return false;
  return stableJson(a.params) !== stableJson(b.params);
}

function stableJson(obj) {
  if (!obj || typeof obj !== 'object') return JSON.stringify(obj ?? null);
  const keys = Object.keys(obj).sort();
  return JSON.stringify(keys.map((k) => [k, obj[k]]));
}

/**
 * Rebuild the working actions.
 *
 * @param workActions    current working set -- every tab's accumulated edits
 * @param sourceActions  the pristine original, never modified on disk
 * @param chapters       [{ id, atMs, endMs }]
 * @param selection      { [id]: { tone, params } } -- what the user wants now
 * @param baked          { [id]: { tone, params } } -- what is already applied
 * @param applyTone      (actions, startMs, endMs, toneId, params) => actions
 *
 * Returns { actions, rebuiltIds }. `rebuiltIds` is what the caller records as
 * the new bake state, so the record and the file cannot drift apart.
 */
export function rebuildWorkingActions({
  workActions,
  sourceActions,
  chapters,
  selection,
  baked,
  applyTone,
}) {
  const work = Array.isArray(workActions) ? workActions : [];
  const source = Array.isArray(sourceActions) ? sourceActions : [];
  const list = [...(chapters ?? [])].sort((a, b) => a.atMs - b.atMs);
  if (!list.length || !work.length) return { actions: work, rebuiltIds: [] };

  const rebuiltIds = [];
  const out = [];
  let i = 0; // cursor into `work`

  for (const ch of list) {
    // Everything before this chapter comes from the work file untouched.
    while (i < work.length && work[i].at < ch.atMs) out.push(work[i++]);
    const rangeStart = i;
    while (i < work.length && work[i].at <= ch.endMs) i += 1;

    if (!hasChanged(ch.id, selection, baked)) {
      // Untouched: keep whatever is in the work file for this range,
      // including other tabs' edits.
      for (let k = rangeStart; k < i; k += 1) out.push(work[k]);
      continue;
    }

    // Changed: this range is rebuilt from the ORIGINAL at the new settings.
    // `applyTone` with 'none' is a passthrough, which is exactly the undo.
    const { tone, params } = entry(ch.id, selection);
    out.push(...applyTone(source, ch.atMs, ch.endMs, tone, params));
    rebuiltIds.push(ch.id);
  }

  while (i < work.length) out.push(work[i++]);
  return { actions: out, rebuiltIds };
}

/**
 * The bake record to persist after a rebuild: the previous record with each
 * rebuilt chapter updated to what was just applied.
 *
 * Chapters rebuilt to Untoned are REMOVED rather than stored as
 * `tone: 'none'`. An absent entry and an untoned entry mean the same thing,
 * and keeping only one spelling means `hasChanged` can't see a difference
 * where there is none.
 */
export function nextBakeRecord(baked, selection, rebuiltIds) {
  const next = { ...(baked ?? {}) };
  for (const id of rebuiltIds ?? []) {
    const { tone, params } = entry(id, selection);
    if (tone === 'none') delete next[id];
    else next[id] = { tone, params: { ...params } };
  }
  return next;
}

/**
 * The selection to bake, given which chapters the user has accepted.
 *
 * Acceptance is still the commit gate: picking a tone shows a preview, and
 * only Accept commits it. So a chapter the user has not accepted must never
 * be rebuilt -- including not being UNDONE. An un-accepted chapter therefore
 * reports whatever is already baked for it, which `hasChanged` then reads as
 * "no change".
 *
 * Without this, accepting chapter 1 would also bake a tone the user had
 * merely been auditioning on chapter 3.
 */
export function buildSelection({ chapters, acceptedIds, tones, params, baked }) {
  const accepted = acceptedIds instanceof Set ? acceptedIds : new Set(acceptedIds ?? []);
  const out = {};
  for (const ch of chapters ?? []) {
    if (accepted.has(ch.id)) {
      const tone = tones?.[ch.id] ?? 'none';
      out[ch.id] = { tone, params: params?.[ch.id]?.[tone] ?? {} };
    } else if (baked?.[ch.id]) {
      // Already baked but not part of this walk -- leave it exactly as it is.
      out[ch.id] = baked[ch.id];
    }
  }
  return out;
}
