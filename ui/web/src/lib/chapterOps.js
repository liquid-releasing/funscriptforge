// Pure helpers for chapter list mutations (split / join) and the
// post-mutation renumber / remap machinery. Kept side-effect free so
// the trickiest part of the Chapters tab (off-by-one bugs in the
// posToOldIdx mapping would silently scramble tones across chapters)
// is covered by chapterOps.test.js without needing React, Tauri, or
// any of the FunscriptForge tone vocabulary.
//
// JS mirror of the Rust CHAPTER_PALETTE in commands.rs — both sides
// must agree or split/join would shift colors away from the analyzer-
// assigned palette.
export const CHAPTER_PALETTE = [
  '#4a90d9', '#56e0a0', '#f39c12', '#9b59b6',
  '#e74c3c', '#2ecc71', '#5a8eff', '#ff8c47',
];

// Sequential chapter IDs (`ch1`, `ch2`, ...) + deterministic palette
// colors, applied after any split/join mutation so labels and the
// ribbon's swatches stay aligned with the chapter's position in the
// list.
export function renumberChapters(chapters) {
  return chapters.map((c, i) => ({
    ...c,
    id: `ch${i + 1}`,
    color: CHAPTER_PALETTE[i % CHAPTER_PALETTE.length],
  }));
}

// Display label for a chapter — index + style eyebrow (`01 · DRIVING`).
// Name is dropped per 2026-05-25 decision: index identifies position,
// content_type identifies content.
export function chapterDisplayLabel(chapter, idx) {
  const num = String(idx + 1).padStart(2, '0');
  const style = chapter?.content_type
    ? String(chapter.content_type).toUpperCase()
    : '';
  return style ? `${num} · ${style}` : num;
}

// Build a Map<newId, oldId> describing which old chapter each new
// chapter inherits state from. `posToOldIdx(newIdx)` is the per-op
// rule (see splitAt / joinAt below). Returns `null` for any new
// index that doesn't map back to a valid old chapter — caller can
// fall back to defaults.
export function computeRemap(oldChapters, newChapters, posToOldIdx) {
  const remap = new Map();
  newChapters.forEach((c, idx) => {
    const oldIdx = posToOldIdx(idx);
    if (oldIdx == null || oldIdx < 0 || oldIdx >= oldChapters.length) {
      remap.set(c.id, null);
      return;
    }
    remap.set(c.id, oldChapters[oldIdx].id);
  });
  return remap;
}

// Split a chapter at a given absolute timestamp. Both halves inherit
// the parent's content_type / intent / confidence / etc. via spread —
// the caller's remap then carries tone / params / accept-state across.
//
// Validation: ≥500ms clearance from each boundary by default. Splits
// closer than that produce slices the analyzer can't usefully tone
// or the user can't usefully scrub through. Override via opts for
// tests / experiments.
//
// Returns one of:
//   { ok: true, chapters, remap, newActiveIdx }
//   { ok: false, reason: 'not-found' | 'no-clearance' }
//
// `newActiveIdx` points at the second half (the playhead is at the
// split point, which is the start of that chapter — "split here,
// continue editing" reads naturally).
export function splitAt(chapters, chapterId, splitMs, opts = {}) {
  const { minClearanceMs = 500 } = opts;
  const i = chapters.findIndex((c) => c.id === chapterId);
  if (i < 0) return { ok: false, reason: 'not-found' };
  const target = chapters[i];
  const cut = Math.round(splitMs);
  if (cut - target.atMs < minClearanceMs
      || target.endMs - cut < minClearanceMs) {
    return { ok: false, reason: 'no-clearance' };
  }
  const firstHalf = { ...target, endMs: cut };
  const secondHalf = { ...target, atMs: cut };
  const raw = [
    ...chapters.slice(0, i),
    firstHalf,
    secondHalf,
    ...chapters.slice(i + 1),
  ];
  const newChapters = renumberChapters(raw);
  const posToOldIdx = (newIdx) => {
    if (newIdx < i) return newIdx;
    if (newIdx === i || newIdx === i + 1) return i;
    return newIdx - 1;
  };
  const remap = computeRemap(chapters, newChapters, posToOldIdx);
  return { ok: true, chapters: newChapters, remap, newActiveIdx: i + 1 };
}

// Merge a chapter with its previous or next neighbour. The earlier
// chapter's content_type / intent / palette index / etc. win — the
// later chapter's state is dropped. Accept the ambiguity for v1
// (the user re-classifies if the merged span needs a different tone).
//
// Returns one of:
//   { ok: true, chapters, remap, newActiveIdx }
//   { ok: false, reason: 'not-found' | 'no-neighbor' }
//
// `newActiveIdx` points at the merged chapter (the earlier index in
// the original list).
export function joinAt(chapters, chapterId, direction) {
  const i = chapters.findIndex((c) => c.id === chapterId);
  if (i < 0) return { ok: false, reason: 'not-found' };
  const earlierIdx = direction === 'prev' ? i - 1 : i;
  const laterIdx = direction === 'prev' ? i : i + 1;
  if (earlierIdx < 0 || laterIdx >= chapters.length) {
    return { ok: false, reason: 'no-neighbor' };
  }
  const earlier = chapters[earlierIdx];
  const later = chapters[laterIdx];
  const merged = { ...earlier, endMs: later.endMs };
  const raw = [
    ...chapters.slice(0, earlierIdx),
    merged,
    ...chapters.slice(laterIdx + 1),
  ];
  const newChapters = renumberChapters(raw);
  const posToOldIdx = (newIdx) => {
    if (newIdx < earlierIdx) return newIdx;
    if (newIdx === earlierIdx) return earlierIdx;
    return newIdx + 1;
  };
  const remap = computeRemap(chapters, newChapters, posToOldIdx);
  return { ok: true, chapters: newChapters, remap, newActiveIdx: earlierIdx };
}
